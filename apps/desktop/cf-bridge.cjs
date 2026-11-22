'use strict';
/**
 * جسر Cloudflare لإضافات Mihon في ويندوز: محرك Suwayomi يحل صفحات Cloudflare عبر FlareSolverr فقط (أو KCEF الثقيل
 * المعطّل عندنا). هنا VANTARA نفسها تجيب بواجهة FlareSolverr (POST {url}/v1) وتحل التحقق بمتصفحها المخفي الموجود
 * (source-browser.cjs، نظير WebView الـAPK)، فيأخذ المحرك كوكي cf_clearance وهوية المتصفح نفسها ويكمل طلبه.
 *
 * - 127.0.0.1 فقط، بمنفذ عشوائي ورمز عشوائي في المسار لكل تشغيل؛ مضيف الطلب يجب أن يكون العنوان نفسه (لا DNS rebinding).
 * - POST بجسم JSON صغير فقط؛ الرابط المطلوب موقع عام (لا شبكة المستخدم المحلية)، والأوامر request.get/request.post فقط.
 * - لا يفتح نافذة ظاهرة أبدًا: تحقق يطلب إنسانًا يُبلَّغ (onChallenge) فيظهر المصدر في «تحتاج تحقق» وزره، كالـAPK.
 * - رد بلا كوكي cf_clearance (حماية تمنع بصمة Java وحدها): نص الصفحة من جلسة المتصفح نفسها (احتياط FlareSolverr).
 */
const http = require('node:http');
const crypto = require('node:crypto');
const { publicHttpUrl } = require('./source-browser.cjs');

const BODY_LIMIT = 256 * 1024;
const MAX_TIMEOUT_MS = 90_000;
const TEXT_LIMIT = 8 * 1024 * 1024;
/** رد الجسر حين لا يمر التحقق: رقم لا تستعمله Cloudflare ولا FlareSolverr، فيعرفه المحرك (suwayomi-engine) سببًا. */
const NOT_SOLVED_STATUS = 409;

function createCloudflareBridge({ solve, cookies, request, userAgent, onChallenge = () => {}, now = Date.now, maxTimeoutMs = MAX_TIMEOUT_MS }) {
  const token = crypto.randomBytes(24).toString('hex');
  let server = null, listening = null, port = 0;

  const reply = (res, status, body) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' });
    res.end(text);
  };
  const withTimeout = (promise, ms) => Promise.race([promise, new Promise((resolve) => { const t = setTimeout(() => resolve(false), ms); t.unref?.(); })]);

  /** كوكيز Chromium بشكل FlareSolverr (expires بالثواني). */
  const shape = (c) => ({
    name: c.name, value: c.value, domain: c.domain ?? '', path: c.path ?? '/',
    expires: typeof c.expirationDate === 'number' ? c.expirationDate : -1, httpOnly: Boolean(c.httpOnly), secure: Boolean(c.secure),
    session: Boolean(c.session), sameSite: c.sameSite === 'no_restriction' ? 'None' : c.sameSite === 'strict' ? 'Strict' : 'Lax',
  });

  async function handle(input) {
    const started = now();
    const cmd = String(input?.cmd ?? '');
    if (cmd !== 'request.get' && cmd !== 'request.post') return [400, { status: 'error', message: 'unsupported command' }];
    const target = publicHttpUrl(input?.url);
    if (!target) return [400, { status: 'error', message: 'url not allowed' }];
    const timeout = Math.min(Math.max(Number(input?.maxTimeout) || 60_000, 5_000), maxTimeoutMs);
    // صفحة GET نفسها، وإلا أصل الموقع: التحقق للمضيف كله
    const passed = await withTimeout(Promise.resolve(solve(cmd === 'request.get' ? target.href : `${target.origin}/`)).catch(() => false), timeout);
    if (!passed) {
      onChallenge(target.hostname.toLowerCase());
      return [NOT_SOLVED_STATUS, { status: 'error', message: 'Challenge not solved: needs a person' }];
    }
    const jar = (await Promise.resolve(cookies(target.href)).catch(() => [])) ?? [];
    const done = (message, extra = {}) => [200, {
      status: 'ok', message, startTimestamp: started, endTimestamp: now(), version: 'vantara-1',
      solution: { url: target.href, status: 200, headers: {}, cookies: jar.map(shape), userAgent, ...extra },
    }];
    if (jar.some((c) => c.name === 'cf_clearance')) return done('Challenge solved!');
    if (input?.returnOnlyCookies) return done('Challenge not detected!');
    // مرّ المتصفح بلا كوكي تحقق (الحماية تمنع بصمة Java وحدها): الرد نفسه من جلسة المتصفح، نصًا فقط
    const res = await request({ url: target.href, method: cmd === 'request.post' ? 'POST' : 'GET', body: cmd === 'request.post' ? String(input?.postData ?? '') : null,
      headers: cmd === 'request.post' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}, limit: TEXT_LIMIT, timeout }).catch(() => null);
    if (!res) return done('Challenge not detected!');
    return done('Challenge not detected!', { url: res.url ?? target.href, status: res.status, response: Buffer.from(res.body ?? []).toString('utf8') });
  }

  function onRequest(req, res) {
    const expectedHost = `127.0.0.1:${port}`;
    if (req.headers.host !== expectedHost || req.method !== 'POST' || req.url !== `/${token}/v1`) return reply(res, 404, { status: 'error', message: 'not found' });
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) return reply(res, 415, { status: 'error', message: 'json only' });
    const parts = []; let size = 0, aborted = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) { aborted = true; reply(res, 413, { status: 'error', message: 'too large' }); req.destroy(); return; }
      parts.push(chunk);
    });
    req.on('end', async () => {
      if (aborted) return;
      let input;
      try { input = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { return reply(res, 400, { status: 'error', message: 'bad json' }); }
      try { const [status, body] = await handle(input); reply(res, status, body); }
      catch { reply(res, 500, { status: 'error', message: 'bridge failure' }); }
    });
  }

  /** يبدأ مرة (كسول) ويعيد العنوان الذي يُعطى للمحرك flareSolverrUrl. */
  function start() {
    if (listening) return listening;
    listening = new Promise((resolve, reject) => {
      server = http.createServer(onRequest);
      server.requestTimeout = MAX_TIMEOUT_MS + 30_000;
      server.once('error', (error) => { listening = null; reject(error); });
      server.listen(0, '127.0.0.1', () => { port = server.address().port; server.unref(); resolve(`http://127.0.0.1:${port}/${token}`); });
    });
    return listening;
  }
  async function close() {
    const s = server; server = null; listening = null;
    if (s) await new Promise((resolve) => s.close(() => resolve()));
  }
  return { start, close };
}

module.exports = { createCloudflareBridge, NOT_SOLVED_STATUS };
