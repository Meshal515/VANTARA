import { describe, expect, it, vi } from 'vitest';
import { bridgeConfig, clearBridge, contentRoute, fetchBase, setBridge, testBridge } from './endpoint.js';
import { createFetcher, NEEDS_BRIDGE } from './fetcher.js';

// قرار المالك (20 نوفمبر): لا محتوى عبر خادم فانتارا في الويب؛ جسر المستخدم في حسابه، أو مباشر
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const KEY = 'k'.repeat(30);

describe('content route on the web', () => {
  it('defaults to direct: no VANTARA server is used for content', () => {
    const s = mem();
    expect(contentRoute(s)).toEqual({ mode: 'direct' });
    expect(fetchBase(s)).toBeNull();
  });
  it('your own bridge wins when saved; a bad url or short key is refused with an Arabic reason', () => {
    const s = mem();
    expect(() => setBridge({ url: 'http://x.example', key: KEY }, s)).toThrow('https');
    expect(() => setBridge({ url: 'https://b.example', key: 'short' }, s)).toThrow('قصير');
    setBridge({ url: 'https://mine.workers.dev/', key: KEY }, s);
    expect(contentRoute(s)).toEqual({ mode: 'bridge', base: 'https://mine.workers.dev', key: KEY });
    clearBridge(s);
    expect(bridgeConfig(s)).toBeNull();
  });
});

describe('fetcher by route', () => {
  it('bridge: sends the bridge key, not the account token, to the bridge', async () => {
    const s = mem();
    setBridge({ url: 'https://mine.workers.dev', key: KEY }, s);
    const fetchImpl = vi.fn(async () => new Response('<html>x</html>', { status: 200, headers: { 'x-vf-status': '200' } }));
    const f = createFetcher({ auth: { header: () => 'Bearer ACCOUNT' }, storage: s, fetchImpl });
    expect((await f.text('https://site.example/')).text).toContain('x');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://mine.workers.dev/v1/fetch');
    expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
  });
  it('bridge: a wrong key says so clearly instead of retrying with the account', async () => {
    const s = mem();
    setBridge({ url: 'https://mine.workers.dev', key: KEY }, s);
    const refresh = vi.fn();
    const f = createFetcher({ auth: { header: () => 'Bearer A', refresh }, storage: s, fetchImpl: async () => new Response('{}', { status: 401 }) });
    await expect(f.text('https://site.example/')).rejects.toMatchObject({ code: 'bridge_key' });
    expect(refresh).not.toHaveBeenCalled();
  });
  it('direct: requests the source itself without forbidden headers; a CORS refusal says what it needs', async () => {
    const s = mem();
    const fetchImpl = vi.fn(async (url, init) => {
      if (url.includes('blocked')) throw new TypeError('Failed to fetch');
      return new Response('ok-direct', { status: 200 });
    });
    const f = createFetcher({ auth: { header: () => null }, storage: s, fetchImpl });
    const out = await f.text('https://open.example/api', { referer: 'https://x/', headers: { accept: 'text/html' } });
    expect(out).toMatchObject({ status: 200, text: 'ok-direct', challenge: 'none' });
    const init = fetchImpl.mock.calls[0][1];
    expect(init.headers).toEqual({ accept: 'text/html' });
    expect(init.credentials).toBe('omit');
    await expect(f.text('https://blocked.example/')).rejects.toMatchObject({ code: 'needs_bridge', message: NEEDS_BRIDGE });
    expect(await f.ensureGrant()).toBeNull();
    expect(f.mediaUrl('https://img.example/a.jpg')).toBe('https://img.example/a.jpg');
  });
});

describe('bridge test before saving', () => {
  it('checks health, that it is a bridge with a key, and that the key matches', async () => {
    const make = (health, grantStatus) => vi.fn(async (url) => (url.endsWith('/health') ? new Response(JSON.stringify(health), { status: 200 }) : new Response('{}', { status: grantStatus })));
    expect(await testBridge({ url: 'https://b.example', key: KEY }, make({ ok: true, bridge: true }, 200))).toEqual({ ok: true, reason: null });
    expect((await testBridge({ url: 'https://b.example', key: KEY }, make({ ok: true, bridge: false }, 200))).reason).toContain('VANTARA_BRIDGE_KEY');
    expect((await testBridge({ url: 'https://b.example', key: KEY }, make({ ok: true, bridge: true }, 401))).reason).toContain('لا يطابق');
    expect((await testBridge({ url: 'https://b.example', key: KEY }, vi.fn(async () => { throw new TypeError('x'); }))).ok).toBe(false);
  });
});

// ملف «جسرك الخاص» المنشور للتنزيل نسخة مبنية من services/web-fetcher: لا يتأخر عن الكود أبدًا
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
describe('published bridge file', () => {
  it('is built from the current fetcher code', () => {
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    expect(execFileSync('node', ['tools/build-bridge.mjs', '--check'], { cwd: root, encoding: 'utf8' })).toContain('up to date');
  });
});
