'use strict';
// جسر Cloudflare لمحرك ويندوز: واجهة FlareSolverr التي يطلبها Suwayomi (CloudflareInterceptor/CFClearance)، محلية ومغلقة.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCloudflareBridge, NOT_SOLVED_STATUS } = require('./cf-bridge.cjs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0';
const CLEARANCE = { name: 'cf_clearance', value: 'ok', domain: '.site.example', path: '/', expirationDate: 1800000000.25, httpOnly: true, secure: true, sameSite: 'no_restriction' };

function bridge(options = {}) {
  const calls = { solve: [], challenge: [], request: [] };
  const b = createCloudflareBridge({
    userAgent: UA,
    solve: async (url) => { calls.solve.push(url); return options.solved ?? true; },
    cookies: async () => options.cookies ?? [CLEARANCE],
    request: async (args) => { calls.request.push(args); return options.page ?? null; },
    onChallenge: (host) => calls.challenge.push(host),
  });
  return { b, calls };
}
const ask = async (base, body, init = {}) => {
  const r = await fetch(`${base}/v1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...init });
  return { status: r.status, body: await r.json() };
};

test('a solved challenge answers in FlareSolverr shape with cf_clearance and the browser identity', async () => {
  const { b, calls } = bridge();
  const base = await b.start();
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{48}$/);
  const out = await ask(base, { cmd: 'request.get', url: 'https://site.example/series/', maxTimeout: 60000, session: 'suwayomi', session_ttl_minutes: 15, cookies: [], returnOnlyCookies: false });
  assert.equal(out.status, 200);
  assert.equal(out.body.status, 'ok');
  assert.doesNotMatch(out.body.message, /not detected/i, 'Suwayomi treats "not detected" as no challenge');
  for (const key of ['startTimestamp', 'endTimestamp', 'version']) assert.ok(key in out.body, key);
  assert.equal(out.body.solution.userAgent, UA);
  assert.equal(out.body.solution.status, 200);
  assert.deepEqual(out.body.solution.cookies[0], { name: 'cf_clearance', value: 'ok', domain: '.site.example', path: '/', expires: 1800000000.25, httpOnly: true, secure: true, session: false, sameSite: 'None' });
  assert.deepEqual(calls.solve, ['https://site.example/series/']);
  await b.close();
});

test('a challenge that needs a person is reported (never a visible window) and answered with the status the engine maps', async () => {
  const { b, calls } = bridge({ solved: false });
  const base = await b.start();
  const out = await ask(base, { cmd: 'request.post', url: 'https://Site.example/api/search', postData: 'q=x' });
  assert.equal(out.status, NOT_SOLVED_STATUS);
  assert.deepEqual(calls.solve, ['https://site.example/'], 'POST: the whole host is verified');
  assert.deepEqual(calls.challenge, ['site.example']);
  await b.close();
});

test('passed without a clearance cookie: the page itself from the browser session (FlareSolverr response fallback)', async () => {
  const { b, calls } = bridge({ cookies: [], page: { status: 200, url: 'https://site.example/series/', body: Buffer.from('<html>real</html>') } });
  const base = await b.start();
  const out = await ask(base, { cmd: 'request.get', url: 'https://site.example/series/', returnOnlyCookies: false });
  assert.equal(out.status, 200);
  assert.match(out.body.message, /not detected/i);
  assert.equal(out.body.solution.response, '<html>real</html>');
  assert.equal(calls.request[0].method, 'GET');
  const only = await ask(base, { cmd: 'request.get', url: 'https://site.example/series/', returnOnlyCookies: true });
  assert.equal(only.body.solution.response, undefined);
  await b.close();
});

test('closed to everything else: other paths, hosts, methods, bodies, commands and private addresses', async () => {
  const { b, calls } = bridge();
  const base = await b.start();
  const origin = new URL(base).origin;
  assert.equal((await fetch(`${origin}/v1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404, 'no token');
  assert.equal((await fetch(`${base}/v1`, { method: 'GET' })).status, 404);
  assert.equal((await fetch(`${base}/v1`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(`${base}/v1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(300 * 1024) }).catch(() => ({ status: 413 }))).status, 413);
  assert.equal((await ask(base, { cmd: 'sessions.create', url: 'https://site.example/' })).status, 400);
  for (const url of ['http://127.0.0.1:4567/api/graphql', 'http://192.168.1.1/', 'http://localhost/', 'file:///etc/passwd', 'https://user:pw@site.example/'])
    assert.equal((await ask(base, { cmd: 'request.get', url })).status, 400, url);
  assert.equal(calls.solve.length, 0);
  // مضيف الطلب غير العنوان نفسه (DNS rebinding)
  const http = require('node:http');
  const status = await new Promise((resolve) => {
    const u = new URL(`${base}/v1`);
    const req = http.request({ host: '127.0.0.1', port: u.port, path: u.pathname, method: 'POST', headers: { host: `evil.example:${u.port}`, 'content-type': 'application/json' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.end('{"cmd":"request.get","url":"https://site.example/"}');
  });
  assert.equal(status, 404);
  await b.close();
});

// جذر حلقة «تحقق ← يدور ← يطلب التحقق مجددًا» في ويندوز (بلاغ المالك 27 نوفمبر): الكوكي وحده يُرفض من Java لأن
// Cloudflare يربطه ببصمة المتصفح؛ الصفحة نفسها من Chromium تُسلَّم، وبلا نافذة إن كانت الجلسة محقَّقة من قبل.
test('a verified browser session answers with the page itself, without opening a solver window', async () => {
  const { b, calls } = bridge({ page: { status: 200, url: 'https://site.example/series/', body: Buffer.from('<html>chapters</html>') } });
  const base = await b.start();
  const out = await ask(base, { cmd: 'request.get', url: 'https://site.example/series/', returnOnlyCookies: false });
  assert.equal(out.status, 200);
  assert.match(out.body.message, /not detected/i, 'Suwayomi then uses the page instead of retrying with Java');
  assert.equal(out.body.solution.response, '<html>chapters</html>');
  assert.equal(calls.solve.length, 0, 'no hidden window when the saved session already works');
  await b.close();
});
test('the hidden solver passed but the request itself is still challenged: a person is needed, never a false success', async () => {
  const challenge = { status: 403, url: 'https://site.example/', headers: {}, body: Buffer.from('<title>Just a moment...</title>') };
  const calls = { challenge: [], solve: [] };
  const b = createCloudflareBridge({
    userAgent: UA, solve: async (u) => { calls.solve.push(u); return true; }, cookies: async () => [CLEARANCE], request: async () => challenge,
    isChallenge: ({ text }) => /Just a moment/.test(text), onChallenge: (h) => calls.challenge.push(h),
  });
  const base = await b.start();
  const out = await ask(base, { cmd: 'request.get', url: 'https://site.example/series/' });
  assert.equal(out.status, NOT_SOLVED_STATUS);
  assert.deepEqual(calls.challenge, ['site.example']);
  await b.close();
});
