'use strict';
/**
 * متصفح المصادر المخفي في ويندوز: نظير CloudflareInterceptor في الـAPK.
 *
 * طلبات المصادر تمر بخدمات ويندوز (Node: DoH وتجزئة SNI لتجاوز حجب المزوّد). حين يرد موقع بصفحة تحقق (Cloudflare
 * «Just a moment»، أو «One moment, please» من حمايات الاستضافة) كان ويندوز يتوقف بـ«المصدر يطلب تحققًا من المتصفح»
 * أو يرى قائمة فارغة، والـAPK يحلها بـWebView مخفي. هنا: Chromium نفسه الذي في Electron يفتح الصفحة مخفيًا حتى يمر
 * التحقق، ثم يُكمل الطلب من الجلسة نفسها (كوكي التحقق وبصمة المتصفح معًا)، ويبقى المضيف على هذا المسار نصف ساعة.
 *
 * معزول عن الجهاز والتطبيق: جلسة مستقلة (persist:vantara-sources) لا تشارك واجهة VANTARA ولا حساباتها، بلا Node ولا
 * preload، sandbox، لا أذونات (كاميرا، إشعارات…)، لا تنزيلات، لا نوافذ جديدة، تنقل HTTP(S) فقط إلى مضيفات عامة.
 */

const SOLVE_MS = 25_000;
const POLL_MS = 500;
const MAX_WINDOWS = 2;
const VERIFY_MS = 3 * 60_000; // مهلة صفحة التحقق الظاهرة: وقت يكفي لحل لغز بيد المستخدم

/** مضيف عام: لا اسم محلي ولا عنوان خاص/حلقة رجوع (لا وصول لشبكة المستخدم عبر تحويل). */
function publicHttpUrl(value) {
  let u;
  try { u = new URL(String(value)); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host.includes('.') && !host.includes(':')) return null;
  if (/(?:^|\.)(?:localhost|local|internal|lan|home|invalid)$/.test(host)) return null;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return null;
  }
  if (host.includes(':')) return null; // IPv6 حرفي: لا حاجة لمصدر به، والخاص منه كثير
  return u;
}

function createSourceBrowser({ BrowserWindow, session, net, userAgent, isChallenge, partition = 'persist:vantara-sources', solveMs = SOLVE_MS }) {
  const ses = session.fromPartition(partition);
  ses.setUserAgent(userAgent);
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (event) => event.preventDefault());

  const solving = new Map();
  let open = 0;
  const waiting = [];
  const acquire = () => new Promise((resolve) => { if (open < MAX_WINDOWS) { open++; resolve(); } else waiting.push(resolve); });
  const release = () => { const next = waiting.shift(); if (next) next(); else open--; };

  /** يفتح الصفحة مخفيًا حتى تزول صفحة التحقق. true = مرّ. صفحة تطلب إنسانًا (مربع اختيار) تنتهي بمهلتها. */
  function solve(url) {
    const origin = new URL(url).origin;
    if (solving.has(origin)) return solving.get(origin);
    const job = (async () => {
      await acquire();
      const win = new BrowserWindow({
        show: false, width: 1280, height: 900,
        webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
      });
      try {
        win.webContents.setAudioMuted(true);
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.on('will-navigate', (event, next) => { if (!publicHttpUrl(next)) event.preventDefault(); });
        win.webContents.on('will-redirect', (event, next) => { if (!publicHttpUrl(next)) event.preventDefault(); });
        await win.loadURL(url, { userAgent }).catch(() => {});
        const deadline = Date.now() + solveMs;
        while (Date.now() < deadline && !win.isDestroyed()) {
          const page = await win.webContents.executeJavaScript(
            '({title: document.title, html: document.documentElement ? document.documentElement.outerHTML.slice(0, 6000) : ""})', true,
          ).catch(() => null);
          if (page && page.html && !isChallenge({ status: 200, headers: {}, text: `<title>${page.title}</title>${page.html}` })) return true;
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        return false;
      } finally {
        if (!win.isDestroyed()) win.destroy();
        release();
      }
    })().finally(() => solving.delete(origin));
    solving.set(origin, job);
    return job;
  }

  /**
   * صفحة التحقق الظاهرة: نظير صفحة التحقق في الـAPK. حين يطلب الموقع إنسانًا (مربع اختيار أو لغز) لا يقدر عليه
   * المتصفح المخفي، فتُفتح الصفحة نفسها للمستخدم في نافذة صغيرة على الجلسة نفسها (persist:vantara-sources): يحلها مرة
   * فيُحفظ كوكي التحقق على القرص، وتُغلق النافذة وحدها لحظة زوال صفحة التحقق. القيود نفسها: sandbox بلا Node، لا
   * أذونات ولا تنزيلات ولا نوافذ جديدة، وتنقل إلى مضيفات عامة فقط.
   * النتيجة بشكل نتيجة الـAPK: { host, state: 'verified' | 'cancelled' | 'failed', reason }.
   */
  const verifying = new Map();
  function verify({ url, parent = null, verifyMs = VERIFY_MS } = {}) {
    const start = publicHttpUrl(url);
    if (!start) return Promise.resolve({ host: null, state: 'failed', reason: 'invalid_endpoint' });
    const host = start.hostname.toLowerCase();
    if (verifying.has(host)) return verifying.get(host);
    const job = new Promise((resolve) => {
      let win;
      try {
        win = new BrowserWindow({
          show: false, width: 520, height: 720, parent: parent && !parent.isDestroyed?.() ? parent : undefined,
          title: 'تحقق من المصدر', autoHideMenuBar: true, backgroundColor: '#0b0a10',
          webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
        });
      } catch { resolve({ host, state: 'failed', reason: 'launch_failed' }); return; }
      let done = false;
      let poll = null;
      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(poll);
        if (!win.isDestroyed()) win.destroy();
        resolve({ host, ...result });
      };
      const timer = setTimeout(() => finish({ state: 'failed', reason: 'timeout' }), verifyMs);
      win.removeMenu?.();
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const guard = (event, next) => { if (!publicHttpUrl(next)) event.preventDefault(); };
      win.webContents.on('will-navigate', guard);
      win.webContents.on('will-redirect', guard);
      win.webContents.on('render-process-gone', () => finish({ state: 'failed', reason: 'renderer_gone' }));
      win.on('closed', () => finish({ state: 'cancelled', reason: 'user_cancelled' }));
      win.once('ready-to-show', () => { if (!done) win.show(); });
      win.loadURL(start.href, { userAgent }).catch(() => {});
      // يظهر حتى لو لم يصل ready-to-show (صفحة بطيئة)، فلا ينتظر المستخدم نافذة لا يراها
      setTimeout(() => { if (!done && !win.isDestroyed() && !win.isVisible()) win.show(); }, 1500);
      poll = setInterval(async () => {
        if (done || win.isDestroyed()) return;
        // الصفحة الحقيقية للمضيف نفسه وقد اكتمل تحميلها، لا صفحة فارغة بين تحويلين
        const page = await win.webContents.executeJavaScript(
          '({host: location.hostname, ready: document.readyState, title: document.title, text: document.body ? document.body.innerText.length : 0, html: document.documentElement ? document.documentElement.outerHTML.slice(0, 6000) : ""})', true,
        ).catch(() => null);
        if (!page || page.ready === 'loading' || !page.html || page.text < 1) return;
        const same = String(page.host).toLowerCase() === host || String(page.host).toLowerCase().endsWith(`.${host}`) || host.endsWith(`.${page.host}`);
        if (!same) return;
        if (!isChallenge({ status: 200, headers: {}, text: `<title>${page.title}</title>${page.html}` })) finish({ state: 'verified' });
      }, POLL_MS);
    }).finally(() => verifying.delete(host));
    verifying.set(host, job);
    return job;
  }

  /** طلب من جلسة Chromium نفسها (كوكي التحقق وبصمة المتصفح)، كل تحويل يُفحص قبل اتباعه. */
  function request({ url, method = 'GET', headers = {}, body = null, limit, timeout = 20_000 }) {
    return new Promise((resolve, reject) => {
      const start = publicHttpUrl(url);
      if (!start) return reject(new Error('رابط المصدر غير مسموح'));
      let current = start.href;
      const req = net.request({ method, url: current, session: ses, useSessionCookies: true, redirect: 'manual' });
      const timer = setTimeout(() => { req.abort(); reject(new Error('انتهت مهلة متصفح المصادر')); }, timeout);
      for (const [name, value] of Object.entries(headers)) {
        if (/^(?:host|cookie|content-length|connection)$/i.test(name)) continue;
        try { req.setHeader(name, value); } catch { /* ترويسة يمنعها Chromium */ }
      }
      req.setHeader('User-Agent', userAgent);
      req.on('redirect', (_status, _method, next) => {
        const target = publicHttpUrl(next);
        if (!target) { clearTimeout(timer); req.abort(); return reject(new Error('تحويل المصدر لمضيف غير مسموح')); }
        current = target.href;
        req.followRedirect();
      });
      req.on('response', (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > limit) { clearTimeout(timer); req.abort(); reject(new Error('حجم المورد أكبر من الحد')); return; }
          chunks.push(chunk);
        });
        response.on('end', () => {
          clearTimeout(timer);
          const flat = Object.fromEntries(Object.entries(response.headers ?? {}).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(', ') : String(v)]));
          resolve({ status: response.statusCode, url: current, headers: flat, body: Buffer.concat(chunks) });
        });
        response.on('error', (error) => { clearTimeout(timer); reject(error); });
      });
      req.on('error', (error) => { clearTimeout(timer); reject(error); });
      if (body != null) req.write(body);
      req.end();
    });
  }

  /** نفس شكل رد requestResource (نص أو صورة base64). */
  async function fetchResource({ url, method = 'GET', headers = {}, body = null, binary = false, limit = 4 * 1024 * 1024, timeout = 20_000 }) {
    const call = () => request({ url, method, headers, body, limit, timeout });
    let res = await call();
    const preview = (r) => ({ status: r.status, headers: r.headers, text: r.body.subarray(0, 64 * 1024).toString('utf8') });
    const isImage = (r) => /^image\/(png|jpeg|webp|gif|avif)$/.test(String(r.headers['content-type'] ?? '').split(';')[0]);
    if (!(binary && isImage(res)) && isChallenge(preview(res))) {
      // الصفحة نفسها إن كانت GET، وإلا أصل الموقع: التحقق للمضيف كله
      if (await solve(method === 'GET' ? url : new URL(url).origin + '/')) res = await call();
    }
    const kept = Object.fromEntries(['content-type', 'x-videa-xs', 'location'].filter((k) => typeof res.headers[k] === 'string').map((k) => [k, res.headers[k]]));
    if (binary) {
      const type = String(kept['content-type'] ?? '').split(';')[0];
      if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(type)) throw new Error('المورد ليس صورة مدعومة');
      return { base64: res.body.toString('base64'), contentType: type, status: res.status, url: res.url, headers: kept, viaBrowser: true };
    }
    return { text: res.body.toString('utf8'), status: res.status, url: res.url, headers: kept, location: null, viaBrowser: true };
  }

  /** كوكيز الجلسة لرابط (جسر Cloudflare لمحرك ويندوز: cf-bridge.cjs). */
  const cookies = (url) => (publicHttpUrl(url) ? ses.cookies.get({ url: String(url) }) : Promise.resolve([]));
  return { userAgent, fetch: fetchResource, solve, verify, cookies, request };
}

/** هوية Chrome على ويندوز بإصدار Chromium الذي في Electron نفسه: هي ما يرسله المتصفح المخفي، فالطلبات كلها هوية واحدة. */
function chromeUserAgent(chromeVersion) {
  const major = String(chromeVersion ?? '').split('.')[0] || '131';
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

module.exports = { createSourceBrowser, chromeUserAgent, publicHttpUrl };
