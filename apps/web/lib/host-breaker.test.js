import { describe, expect, it } from 'vitest';
import { BREAKER, createHostBreaker, guardFetcher, guardTransport, HOST_COOLING, retryAfterMs } from './host-breaker.js';
import { createTransport } from '../addons/transport.js';
import { failureText } from './route-validity.js';

const clock = () => {
  let t = 1_000_000;
  return { now: () => t, advance: (ms) => (t += ms) };
};

describe('host circuit breaker (web/Windows), same rules as Android HostBreaker', () => {
  it('three consecutive 429/5xx open the host for 30s, doubling up to 6 hours', () => {
    const c = clock();
    const b = createHostBreaker({ now: c.now });
    b.record('site.test', 500);
    b.record('site.test', 502);
    expect(b.waitMs('site.test')).toBeNull();
    b.record('site.test', 429);
    expect(b.waitMs('site.test')).toBe(30_000);
    c.advance(30_001);
    expect(b.waitMs('site.test')).toBeNull();
    // نصف مفتوح: فشل واحد بعد انتهاء المهلة يعيد التوقف مضاعفًا
    b.record('site.test', 503);
    expect(b.waitMs('site.test')).toBe(60_000);
    for (let i = 0; i < 30; i += 1) {
      c.advance(BREAKER.MAX_MS + 1);
      b.record('site.test', 500);
    }
    expect(b.waitMs('site.test')).toBe(BREAKER.MAX_MS);
  });

  it('honours Retry-After on 429/503 (seconds or HTTP date), capped at 6 hours', () => {
    const c = clock();
    const b = createHostBreaker({ now: c.now });
    b.record('a.test', 429, retryAfterMs('120', c.now()));
    expect(b.waitMs('a.test')).toBe(120_000);
    b.record('b.test', 503, retryAfterMs(new Date(c.now() + 90_000).toUTCString(), c.now()));
    expect(b.waitMs('b.test')).toBeGreaterThan(88_000);
    b.record('c.test', 429, retryAfterMs('999999', c.now()));
    expect(b.waitMs('c.test')).toBe(BREAKER.MAX_MS);
    // Retry-After على 500 ليس طلب توقف: يحسب فشلًا عاديًا فقط
    b.record('d.test', 500, 60_000);
    expect(b.waitMs('d.test')).toBeNull();
    expect(retryAfterMs('-5')).toBeNull();
    expect(retryAfterMs('soon')).toBeNull();
  });

  it('a healthy reply resets the count; hosts are independent and case-insensitive', () => {
    const b = createHostBreaker();
    b.record('Site.test', 500);
    b.record('site.test', 500);
    b.record('site.test', 200);
    b.record('site.test', 500);
    b.record('site.test', 500);
    expect(b.waitMs('site.test')).toBeNull();
    b.record('site.test', 500);
    expect(b.waitMs('SITE.test')).not.toBeNull();
    expect(b.waitMs('other.test')).toBeNull();
    // 404 رد سليم من الموقع (المحتوى غائب) لا خلل فيه
    b.record('x.test', 500); b.record('x.test', 500); b.record('x.test', 404); b.record('x.test', 500);
    expect(b.waitMs('x.test')).toBeNull();
  });

  it('the cooling error is Arabic and says the fault is the site, not VANTARA', () => {
    const b = createHostBreaker();
    b.record('site.test', 429, 45_000);
    let error;
    try { b.assertAllowed('site.test'); } catch (e) { error = e; }
    expect(error.code).toBe(HOST_COOLING);
    expect(error.message).toMatch(/الموقع site\.test طلب التوقف مؤقتًا/);
    expect(error.message).toContain('الخلل من الموقع لا من VANTARA');
    expect(error.message).toContain('45 ثانية');
    expect(failureText(error.message)).toMatch(/[؀-ۿ]/);
  });
});

describe('guards around the real fetch paths', () => {
  it('after 429 + Retry-After the add-on transport sends no further request to that host', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response('slow down', { status: 429, headers: { 'retry-after': '30' } });
    };
    const c = clock();
    const breaker = createHostBreaker({ now: c.now });
    const t = guardTransport(createTransport({ fetchImpl }), breaker);
    await expect(t.json('https://addon.test/catalog.json')).rejects.toMatchObject({ status: 429 });
    await expect(t.json('https://addon.test/meta.json')).rejects.toMatchObject({ code: HOST_COOLING });
    await expect(t.text('https://addon.test/x')).rejects.toMatchObject({ code: HOST_COOLING });
    expect(calls).toBe(1);
    // مضيف آخر لا يتأثر
    await expect(t.json('https://other.test/catalog.json')).rejects.toMatchObject({ status: 429 });
    expect(calls).toBe(2);
    c.advance(30_001);
    await expect(t.json('https://addon.test/catalog.json')).rejects.toMatchObject({ status: 429 });
    expect(calls).toBe(3);
  });

  it('network errors and cancellation never open the breaker (the device is offline, not the site)', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; throw new TypeError('Failed to fetch'); };
    const breaker = createHostBreaker();
    const t = guardTransport(createTransport({ fetchImpl }), breaker);
    for (let i = 0; i < 5; i += 1) await expect(t.json('https://addon.test/a.json')).rejects.toThrow(/تعذّر الاتصال/);
    expect(calls).toBe(5);
    expect(breaker.waitMs('addon.test')).toBeNull();
  });

  it('the manga web fetcher: three 503 replies from the site stop the fourth request; fetcher-side errors do not count', async () => {
    let calls = 0;
    let mode = 'site503';
    const fetcher = {
      async text(url) {
        calls += 1;
        if (mode === 'worker429') throw Object.assign(new Error('طلبات كثيرة'), { code: 'rate_limited', status: 429 });
        return { status: 503, url, text: 'down', headers: {} };
      },
    };
    const breaker = createHostBreaker();
    const g = guardFetcher(fetcher, breaker);
    mode = 'worker429';
    for (let i = 0; i < 4; i += 1) await expect(g.text('https://manga.test/a')).rejects.toMatchObject({ code: 'rate_limited' });
    expect(breaker.waitMs('manga.test')).toBeNull();
    mode = 'site503';
    for (let i = 0; i < 3; i += 1) await expect(g.page('https://manga.test/a')).rejects.toMatchObject({ code: 'http', status: 503 });
    const before = calls;
    await expect(g.page('https://manga.test/b')).rejects.toMatchObject({ code: HOST_COOLING });
    expect(calls).toBe(before);
  });

  it('ten languages of one site share the same stop (one host, one breaker)', async () => {
    let calls = 0;
    const fetcher = { async text(url) { calls += 1; return { status: 429, url, text: '', headers: { 'Retry-After': '60' } }; } };
    const g = guardFetcher(fetcher, createHostBreaker());
    await g.text('https://cdn.site.test/ar/latest').catch(() => {});
    for (const lang of ['en', 'fr', 'es', 'de', 'it', 'pt', 'ru', 'tr', 'id'])
      await expect(g.text(`https://cdn.site.test/${lang}/latest`)).rejects.toMatchObject({ code: HOST_COOLING });
    expect(calls).toBe(1);
  });
});
