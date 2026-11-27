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

function createCloudflareBridge({ solve, cookies, request, userAgent, isChallenge = () => false, onChallenge = () => {}, now = Date.now, maxTimeoutMs = MAX_TIMEOUT_MS }) {
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
    const post = cmd === 'request.post';
    // الصفحة من جلسة Chromium نفسها (كوكي التحقق المحفوظ + بصمة المتصفح)
    const viaBrowser = () => request({ url: target.href, method: post ? 'POST' : 'GET', body: post ? String(input?.postData ?? '') : null,
      headers: post ? { 'content-type': 'application/x-www-form-urlencoded' } : {}, limit: TEXT_LIMIT, timeout }).catch(() => null);
    const challenged = (res) => !res || isChallenge({ status: res.status, headers: res.headers ?? {}, text: Buffer.from(res.body ?? []).subarray(0, 64 * 1024).toString('utf8') });
    // الصور والوسائط لا تُسلَّم نصًا (Suwayomi لا يقبلها ردًا): لها الكوكي وحده كما كان
    const textual = (res) => !/^(image|video|audio)\//i.test(String(res?.headers?.['content-type'] ?? ''));
    const jarNow = async () => (await Promise.resolve(cookies(target.href)).catch(() => [])) ?? [];
    const done = (jar, message, res) => [200, {
      status: 'ok', message, startTimestamp: started, endTimestamp: now(), version: 'vantara-1',
      solution: { url: res?.url ?? target.href, status: res?.status ?? 200, headers: {}, cookies: jar.map(shape), userAgent,
        // جذر حلقة «تحقق ← يدور ← يطلب التحقق مجددًا» (بلاغ المالك 27 نوفمبر): Cloudflare يربط كوكي التحقق ببصمة المتصفح،
        // فطلب Java بالكوكي وحده يُرفض ويعود التحدي. الصفحة نفسها من Chromium تُسلَّم دائمًا (flareSolverrAsResponseFallback)
        ...(res && !input?.returnOnlyCookies ? { response: Buffer.from(res.body ?? []).toString('utf8') } : {}) },
    }];
    // مسار سريع بلا نافذة: جلسة محقَّقة من قبل (محفوظة على القرص) تجلب الصفحة مباشرة. «not detected» مع الصفحة
    // يجعل Suwayomi يستعمل الصفحة نفسها بدل إعادة الطلب بـJava (وهي ما يرفضه الموقع)
    const direct = await viaBrowser();
    if (!challenged(direct) && textual(direct)) return done(await jarNow(), 'Challenge not detected!', direct);
    // صفحة GET نفسها، وإلا أصل الموقع: التحقق للمضيف كله
    const passed = await withTimeout(Promise.resolve(solve(post ? `${target.origin}/` : target.href)).catch(() => false), timeout);
    if (!passed) {
      onChallenge(target.hostname.toLowerCase());
      return [NOT_SOLVED_STATUS, { status: 'error', message: 'Challenge not solved: needs a person' }];
    }
    const jar = await jarNow();
    const res = await viaBrowser();
    if (res && !challenged(res) && textual(res)) return done(jar, 'Challenge not detected!', res);
    if (res && !challenged(res)) return done(jar, 'Challenge solved!', null);
    // تعذّر جلب الصفحة عبر المتصفح (شبكة): الاحتياط القديم، الكوكي وحده
    if (!res) return done(jar, jar.some((c) => c.name === 'cf_clearance') ? 'Challenge solved!' : 'Challenge not detected!', null);
    // المتصفح المخفي مرّ لكن الطلب نفسه ما زال يُتحدّى: يحتاج إنسانًا، لا «تم» كاذبة
    onChallenge(target.hostname.toLowerCase());
    return [NOT_SOLVED_STATUS, { status: 'error', message: 'Challenge not solved: needs a person' }];
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
