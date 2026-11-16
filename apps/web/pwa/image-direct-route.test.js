import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

/**
 * المرحلة الثالثة (16 نوفمبر): صور المانجا في الويب مباشرة من المصدر أولًا، والجالب (Worker) احتياطي.
 * الطريق يُحفظ لكل مضيف صور، ولا يُعتمد المباشر إلا إن أعاد بايتات الجالب نفسها (لا صورة بديلة لحماية الروابط).
 */
const ORIGIN = 'https://pwa.test';
const EDGE = 'https://fetch.test';

function makeCache() {
  const entries = new Map();
  return {
    entries,
    match: async (req) => entries.get(new URL(req.url ?? req, ORIGIN).href)?.clone(),
    put: async (req, res) => { const k = new URL(req.url ?? req, ORIGIN).href; entries.delete(k); entries.set(k, res); },
    keys: async () => [...entries.keys()].map((u) => ({ url: u })),
    delete: async (req) => entries.delete(new URL(req.url ?? req, ORIGIN).href),
  };
}

/** hosts: مضيف → ما يعيده الطلب المباشر: 'same' (بايتات الأصل) أو 'placeholder' أو 'cors' (يرمي) أو 'html'. */
function worker({ hosts, now = 1_000_000_000_000, configCache = null }) {
  const handlers = new Map();
  const imageCache = makeCache();
  const config = configCache ?? makeCache();
  if (!configCache) config.entries.set(`${ORIGIN}/__pwa/config`, new Response(JSON.stringify({ fetchBase: EDGE, grant: 'g' })));
  const calls = [];
  const bytes = (u) => new Blob([`real:${u}`], { type: 'image/jpeg' });
  const img = (blob) => new Response(blob, { headers: { 'content-type': 'image/jpeg' } });
  const fetch = async (input) => {
    const u = new URL(String(input));
    if (u.origin === EDGE) {
      const src = u.searchParams.get('u');
      calls.push(['edge', src]);
      return img(bytes(src));
    }
    calls.push(['direct', u.href]);
    const mode = hosts[u.host] ?? 'cors';
    if (mode === 'cors') throw new TypeError('Failed to fetch');
    if (mode === 'html') return new Response('<html>', { headers: { 'content-type': 'text/html' } });
    if (mode === 'placeholder') return img(new Blob(['hotlink-protected'], { type: 'image/jpeg' }));
    return img(bytes(u.href));
  };
  class R extends Request { constructor(u, init) { super(new URL(String(u), ORIGIN), init); } }
  runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), {
    self: { location: { origin: ORIGIN, hostname: 'pwa.test', protocol: 'https:' }, addEventListener: (e, fn) => handlers.set(e, fn), navigator: {} },
    caches: { open: async (name) => (name === 'vantara-img-v1' ? imageCache : config), keys: async () => [] },
    fetch, URL, URLSearchParams, Request: R, Response, Blob, AbortController, Uint8Array, Promise, setTimeout, clearTimeout,
    Date: { now: () => now }, Object, Number, String, JSON, Map, Boolean, Math, TypeError,
  });
  const get = async (u, r = null) => {
    let out;
    const q = new URLSearchParams({ u });
    if (r) q.set('r', r);
    handlers.get('fetch')({ request: { url: `${ORIGIN}/__img?${q}`, method: 'GET', mode: 'no-cors' }, respondWith: (p) => { out = p; }, waitUntil() {} });
    const res = await out;
    for (let i = 0; i < 5; i++) await new Promise((res2) => setTimeout(res2, 0));
    return res;
  };
  return { get, calls, config, text: async (res) => (await res.blob()).text() };
}

it('a host that serves the same bytes directly is proven once, then every page skips the worker', async () => {
  const w = worker({ hosts: { 'cdn.ok': 'same' } });
  const first = await w.get('https://cdn.ok/c1/p1.jpg', 'https://site.ok/');
  expect(await w.text(first)).toBe('real:https://cdn.ok/c1/p1.jpg');
  expect(w.calls).toEqual([['direct', 'https://cdn.ok/c1/p1.jpg'], ['edge', 'https://cdn.ok/c1/p1.jpg']]);
  w.calls.length = 0;
  const second = await w.get('https://cdn.ok/c1/p2.jpg', 'https://site.ok/');
  expect(await w.text(second)).toBe('real:https://cdn.ok/c1/p2.jpg');
  expect(w.calls).toEqual([['direct', 'https://cdn.ok/c1/p2.jpg']]);
});

it('a hotlink placeholder (valid image, wrong bytes) is never shown and keeps the host on the worker', async () => {
  const w = worker({ hosts: { 'cdn.guard': 'placeholder' } });
  const first = await w.get('https://cdn.guard/p1.jpg', 'https://site/');
  expect(await w.text(first)).toBe('real:https://cdn.guard/p1.jpg');
  w.calls.length = 0;
  const second = await w.get('https://cdn.guard/p2.jpg', 'https://site/');
  expect(await w.text(second)).toBe('real:https://cdn.guard/p2.jpg');
  expect(w.calls).toEqual([['edge', 'https://cdn.guard/p2.jpg']]);
});

it('CORS or non-image direct answers fall back to the worker and are remembered per host', async () => {
  const w = worker({ hosts: { 'cdn.cors': 'cors', 'cdn.html': 'html' } });
  for (const host of ['cdn.cors', 'cdn.html']) {
    await w.get(`https://${host}/a.jpg`);
    w.calls.length = 0;
    const res = await w.get(`https://${host}/b.jpg`);
    expect(await w.text(res)).toBe(`real:https://${host}/b.jpg`);
    expect(w.calls).toEqual([['edge', `https://${host}/b.jpg`]]);
  }
});

it('a proven route survives a worker restart (no repeated probing after reopening the app)', async () => {
  const w1 = worker({ hosts: { 'cdn.ok': 'same' } });
  await w1.get('https://cdn.ok/1.jpg');
  const w2 = worker({ hosts: { 'cdn.ok': 'same' }, configCache: w1.config });
  await w2.get('https://cdn.ok/2.jpg');
  expect(w2.calls).toEqual([['direct', 'https://cdn.ok/2.jpg']]);
});

it('a direct host that starts failing is demoted to the worker without losing the page', async () => {
  const hosts = { 'cdn.flip': 'same' };
  const w = worker({ hosts });
  await w.get('https://cdn.flip/1.jpg');
  hosts['cdn.flip'] = 'cors';
  const res = await w.get('https://cdn.flip/2.jpg');
  expect(await w.text(res)).toBe('real:https://cdn.flip/2.jpg');
  w.calls.length = 0;
  await w.get('https://cdn.flip/3.jpg');
  expect(w.calls).toEqual([['edge', 'https://cdn.flip/3.jpg']]);
});

it('a chapter opening many pages of an unknown host probes once, not once per page', async () => {
  const w = worker({ hosts: { 'cdn.ok': 'same' } });
  const pages = await Promise.all(Array.from({ length: 6 }, (_, i) => w.get(`https://cdn.ok/p${i}.jpg`)));
  for (const [i, res] of pages.entries()) expect(await w.text(res)).toBe(`real:https://cdn.ok/p${i}.jpg`);
  expect(w.calls.filter(([via]) => via === 'edge')).toHaveLength(1);
});
