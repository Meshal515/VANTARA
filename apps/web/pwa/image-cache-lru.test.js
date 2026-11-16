import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

/**
 * #323 U-18: كاش صور الـPWA كان يحذف الأقدم دخولًا (keys() بترتيب الإدخال، والقراءة لا تجدده)، فالغلاف الذي
 * تفتحه كل يوم يُحذف قبل غلاف رأيته مرة. كاش وهمي بترتيب إدخال Cache API: put يحذف المطابق ثم يُلحق في الآخر.
 */
const ORIGIN = 'https://pwa.test';
function worker({ now }) {
  const handlers = new Map();
  const entries = new Map(); // url → Response (ترتيب الإدخال)
  const imageCache = {
    match: async (req) => entries.get(new URL(req.url ?? req, ORIGIN).href)?.clone(),
    put: async (req, res) => { const k = new URL(req.url ?? req, ORIGIN).href; entries.delete(k); entries.set(k, res); },
    keys: async () => [...entries.keys()].map((u) => ({ url: u })),
    delete: async (req) => entries.delete(new URL(req.url ?? req, ORIGIN).href),
  };
  const configCache = { match: async () => new Response(JSON.stringify({ fetchBase: 'https://fetch.test', grant: 'g' })) };
  class R extends Request { constructor(u, init) { super(new URL(String(u), ORIGIN), init); } }
  const clock = { now };
  runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), {
    self: { location: { origin: ORIGIN, hostname: 'pwa.test', protocol: 'https:' }, addEventListener: (e, fn) => handlers.set(e, fn), navigator: {} },
    caches: { open: async (name) => (name === 'vantara-img-v1' ? imageCache : configCache), keys: async () => [] },
    fetch: async () => new Response(new Blob(['img'], { type: 'image/jpeg' }), { headers: { 'content-type': 'image/jpeg' } }),
    URL, Request: R, Response, Blob, setTimeout, clearTimeout, Date: { now: () => clock.now },
  });
  const get = async (u) => {
    let out;
    handlers.get('fetch')({ request: { url: `${ORIGIN}/__img?u=${encodeURIComponent(u)}`, method: 'GET', mode: 'no-cors' }, respondWith: (p) => { out = p; }, waitUntil() {} });
    const res = await out;
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    return res;
  };
  return { get, entries, clock };
}

it('a cover read every day survives the trim; the one seen once is evicted first', async () => {
  const w = worker({ now: 1_000_000_000_000 });
  await w.get('https://img/daily.jpg');
  for (let i = 0; i < 2499; i++) await w.entries.set(`${ORIGIN}/__img?u=${encodeURIComponent(`https://img/${i}.jpg`)}`, new Response('x', { headers: { 'content-type': 'image/jpeg' } }));
  // بعد يومين: الغلاف اليومي يُقرأ (إصابة كاش)، ثم صورة جديدة تتجاوز الحد فيُكنس الكاش
  w.clock.now += 2 * 86_400_000;
  await w.get('https://img/daily.jpg');
  await w.get('https://img/new.jpg');
  const kept = [...w.entries.keys()].map((k) => decodeURIComponent(new URL(k).searchParams.get('u')));
  expect(kept).toContain('https://img/daily.jpg');
  expect(kept).toContain('https://img/new.jpg');
  expect(kept).not.toContain('https://img/0.jpg');
  expect(kept.length).toBeLessThanOrEqual(2500);
});
