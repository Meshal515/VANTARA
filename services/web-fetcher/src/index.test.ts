import { mintIdentityToken } from '@vantara/domain';
import { describe, expect, it } from 'vitest';
import { hostAllowed, parseTarget } from './allow.ts';
import { mintGrant, verifyGrant } from './grant.ts';
import { rewritePlaylist } from './hls.ts';
import { challengeOf, createHandler, overLimit, type Env } from './index.ts';

const SECRET = 'fetcher-test-identity-secret-32-chars!!';
const env: Env = { VANTARA_IDENTITY_SECRET: SECRET, ALLOWED_ORIGINS: 'https://vantara-bcf.pages.dev' };
const ORIGIN = 'https://vantara-bcf.pages.dev';

async function bearer(userId = 'u1') {
  return `Bearer ${await mintIdentityToken({ userId, deviceId: 'd1' }, SECRET)}`;
}

type Seen = { url: string; method: string; headers: Headers; body: unknown };

function fakeUpstream(routes: Record<string, (seen: Seen) => Response>) {
  const seen: Seen[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const entry: Seen = { url, method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: init?.body };
    seen.push(entry);
    const route = routes[url];
    if (!route) return new Response('nope', { status: 404 });
    return route(entry);
  }) as typeof fetch;
  return { impl, seen };
}

function fetchReq(body: unknown, auth?: string) {
  return new Request('https://vantara-fetch.example/v1/fetch', {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
}

describe('allowlist and SSRF guard', () => {
  it('matches a listed site and its subdomains only', () => {
    const list = { hosts: ['myseed.pics', 'ok.ru'] };
    expect(hostAllowed('m.myseed.pics', list)).toBe(true);
    expect(hostAllowed('myseed.pics', list)).toBe(true);
    expect(hostAllowed('evilmyseed.pics', list)).toBe(false);
    expect(hostAllowed('ok.ru.evil.com', list)).toBe(false);
  });

  it('refuses IPs, private names, odd ports, credentials and non-http schemes', () => {
    for (const bad of ['http://127.0.0.1/', 'https://[::1]/', 'http://localhost/', 'https://box.local/', 'https://a.com:8443/', 'ftp://a.com/', 'https://u:p@a.com/', 'file:///etc/passwd', 'javascript:alert(1)']) {
      expect(parseTarget(bad), bad).toBeNull();
    }
    expect(parseTarget('https://m.myseed.pics/find/?word=x')?.hostname).toBe('m.myseed.pics');
  });
});

describe('/v1/fetch', () => {
  it('accepts verified resolver aliases only within their own host family', async () => {
    for (const [from, to] of [['share4max.com', 'share4max.net'], ['uqload.is', 'uqload.vc'], ['vidmoly.net', 'vidmoly.biz'], ['vidmoly.net', 'vmpx.online'], ['vmpx.online', 'vidmoly.net'], ['lulustream.com', 'lolololu.website']]) {
      const { impl } = fakeUpstream({
        [`https://${from}/embed/1`]: () => new Response(null, { status: 302, headers: { location: `https://${to}/embed/1` } }),
        [`https://${to}/embed/1`]: () => new Response('verified player'),
      });
      const res = await createHandler(impl)(fetchReq({ url: `https://${from}/embed/1` }, await bearer()), env);
      expect(res.status, `${from} -> ${to}`).toBe(200);
      expect(res.headers.get('x-vf-url')).toBe(`https://${to}/embed/1`);
    }
  });
  it('an unrelated allowed source cannot redirect into a newly trusted resolver alias', async () => {
    const { impl, seen } = fakeUpstream({
      'https://m.myseed.pics/a': () => new Response(null, { status: 302, headers: { location: 'https://uqload.vc/embed/1' } }),
      'https://uqload.vc/embed/1': () => new Response('must not be fetched'),
    });
    const res = await createHandler(impl)(fetchReq({ url: 'https://m.myseed.pics/a' }, await bearer()), env);
    expect(res.status).toBe(403);
    expect(seen).toHaveLength(1);
  });
  it('a trusted new alias cannot redirect outward into another resolver family', async () => {
    const { impl, seen } = fakeUpstream({
      'https://uqload.vc/embed/1': () => new Response(null, { status: 302, headers: { location: 'https://share4max.com/iframe/1' } }),
      'https://share4max.com/iframe/1': () => new Response('unrelated family'),
    });
    const res = await createHandler(impl)(fetchReq({ url: 'https://uqload.vc/embed/1' }, await bearer()), env);
    expect(res.status).toBe(403);
    expect(seen).toHaveLength(1);
  });
  it.each([
    ['uqload.is', 'uqload.vc', 'share4max.com'],
    ['vidmoly.biz', 'vmpx.online', 'mixdrop.top'],
  ])('rejects %s → %s → %s at the actual second hop', async (start, alias, unrelated) => {
    const { impl, seen } = fakeUpstream({
      [`https://${start}/embed/1`]: () => new Response(null, { status: 302, headers: { location: `https://${alias}/embed/1` } }),
      [`https://${alias}/embed/1`]: () => new Response(null, { status: 302, headers: { location: `https://${unrelated}/embed/1` } }),
      [`https://${unrelated}/embed/1`]: () => new Response('must not be fetched'),
    });
    const res = await createHandler(impl)(fetchReq({ url: `https://${start}/embed/1` }, await bearer()), env);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'foreign_redirect', detail: unrelated });
    expect(seen.map((s) => s.url)).toEqual([`https://${start}/embed/1`, `https://${alias}/embed/1`]);
  });
  it('rejects a request without a valid sign-in token', async () => {
    const handle = createHandler(fakeUpstream({}).impl);
    expect((await handle(fetchReq({ url: 'https://3asq.online/' }), env)).status).toBe(401);
    expect((await handle(fetchReq({ url: 'https://3asq.online/' }, 'Bearer forged.token'), env)).status).toBe(401);
  });

  it('never fetches a host outside the allowlist', async () => {
    const { impl, seen } = fakeUpstream({});
    const res = await createHandler(impl)(fetchReq({ url: 'https://example.com/' }, await bearer()), env);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'host_not_allowed', host: 'example.com' });
    expect(seen).toHaveLength(0);
  });

  it('forwards only the safe headers and reports status, final url and cookies', async () => {
    const { impl, seen } = fakeUpstream({
      'https://m.myseed.pics/get__quality__servers/': () =>
        new Response('{"type":"success"}', { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'sid=abc; Path=/; HttpOnly' } }),
    });
    const res = await createHandler(impl)(
      fetchReq(
        {
          url: 'https://m.myseed.pics/get__quality__servers/',
          method: 'POST',
          body: 'post_id=1&quality=720',
          cookies: 'cf=1',
          headers: { referer: 'https://m.myseed.pics/x/', 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest', host: 'evil', authorization: 'leak' },
        },
        await bearer(),
      ),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-vf-status')).toBe('200');
    expect(res.headers.get('x-vf-url')).toBe('https://m.myseed.pics/get__quality__servers/');
    expect(JSON.parse(decodeURIComponent(res.headers.get('x-vf-set-cookie')!))).toEqual(['sid=abc']);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(await res.text()).toBe('{"type":"success"}');
    const sent = seen[0]!;
    expect(sent.method).toBe('POST');
    expect(sent.body).toBe('post_id=1&quality=720');
    expect(sent.headers.get('referer')).toBe('https://m.myseed.pics/x/');
    expect(sent.headers.get('cookie')).toBe('cf=1');
    expect(sent.headers.get('authorization')).toBeNull();
    expect(sent.headers.get('host')).toBeNull();
    expect(sent.headers.get('user-agent')).toMatch(/Mozilla/);
  });

  it('follows redirects inside the allowlist and stops at a foreign one', async () => {
    const { impl } = fakeUpstream({
      'https://m.asd.myseed.pics/a': () => new Response(null, { status: 302, headers: { location: 'https://m.myseed.pics/b' } }),
      'https://m.myseed.pics/b': () => new Response('ok', { status: 200, headers: { 'content-type': 'text/html' } }),
      'https://w1.anime4up.rest/': () => new Response(null, { status: 301, headers: { location: 'https://4u.571jrqh.shop/' } }),
    });
    const handle = createHandler(impl);
    const ok = await handle(fetchReq({ url: 'https://m.asd.myseed.pics/a' }, await bearer()), env);
    expect(ok.headers.get('x-vf-url')).toBe('https://m.myseed.pics/b');
    expect(await ok.text()).toBe('ok');
    const foreign = await handle(fetchReq({ url: 'https://w1.anime4up.rest/' }, await bearer()), env);
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ error: 'foreign_redirect', detail: '4u.571jrqh.shop' });
  });

  it('can stop at a redirect and report where it points (gates that hand off to a player)', async () => {
    const { impl, seen } = fakeUpstream({
      'https://witanime.site/watch/stream-gate/abc': () => new Response(null, { status: 302, headers: { location: 'https://ok.ru/videoembed/1' } }),
    });
    const res = await createHandler(impl)(fetchReq({ url: 'https://witanime.site/watch/stream-gate/abc', follow: false, headers: { 'x-csrf-token': 't0k' } }, await bearer()), env);
    expect(res.headers.get('x-vf-status')).toBe('302');
    expect(res.headers.get('x-vf-location')).toBe('https://ok.ru/videoembed/1');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers.get('x-csrf-token')).toBe('t0k');
  });

  it('labels a Cloudflare challenge instead of passing it off as a page', async () => {
    const { impl } = fakeUpstream({
      'https://w1.anime4up.rest/': () => new Response('<title>Just a moment...</title>', { status: 403, headers: { 'content-type': 'text/html' } }),
    });
    const res = await createHandler(impl)(fetchReq({ url: 'https://w1.anime4up.rest/' }, await bearer()), env);
    expect(res.headers.get('x-vf-status')).toBe('403');
    expect(res.headers.get('x-vf-challenge')).toBe('js');
    expect(challengeOf(403, '<div class="cf-turnstile">')).toBe('interactive');
    expect(challengeOf(200, 'Just a moment')).toBe('none');
  });

  it('a page from a foreign origin gets no CORS grant', async () => {
    const { impl } = fakeUpstream({ 'https://3asq.online/': () => new Response('x') });
    const req = new Request('https://vantara-fetch.example/v1/fetch', {
      method: 'POST',
      headers: { origin: 'https://evil.example', authorization: await bearer(), 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://3asq.online/' }),
    });
    const res = await createHandler(impl)(req, env);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('/v1/media and grants', () => {
  it('a grant is bound to its secret and expires', async () => {
    const { grant, expiresAt } = await mintGrant('u1', SECRET, 1_000);
    expect(await verifyGrant(grant, SECRET, 2_000)).toBe('u1');
    expect(await verifyGrant(grant, SECRET, expiresAt)).toBeNull();
    expect(await verifyGrant(grant, 'another-secret-another-secret-123', 2_000)).toBeNull();
    // توكن الدخول ليس إذنًا
    expect(await verifyGrant((await bearer()).slice(7), SECRET)).toBeNull();
  });

  it('streams an image with the referer the host demands', async () => {
    const { impl, seen } = fakeUpstream({
      'https://img.3asq.online/p/1.webp': () => new Response('IMG', { status: 200, headers: { 'content-type': 'image/webp' } }),
    });
    const { grant } = await mintGrant('u1', SECRET);
    const url = `https://vantara-fetch.example/v1/media?u=${encodeURIComponent('https://img.3asq.online/p/1.webp')}&r=${encodeURIComponent('https://3asq.online/')}&g=${grant}`;
    const res = await createHandler(impl)(new Request(url, { headers: { origin: ORIGIN } }), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('IMG');
    expect(res.headers.get('cache-control')).toMatch(/max-age=604800/);
    expect(seen[0]!.headers.get('referer')).toBe('https://3asq.online/');
  });

  it('rewrites an HLS playlist so every segment and key comes back through the fetcher', async () => {
    const playlist = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nseg-1.ts\n#EXTINF:4,\nhttps://cdn.okcdn.ru/seg-2.ts\n';
    const { impl } = fakeUpstream({
      'https://vd1.mycdn.me/v/master.m3u8': () => new Response(playlist, { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } }),
    });
    const { grant } = await mintGrant('u1', SECRET);
    const url = `https://vantara-fetch.example/v1/media?u=${encodeURIComponent('https://vd1.mycdn.me/v/master.m3u8')}&r=${encodeURIComponent('https://ok.ru/')}&g=${grant}`;
    const text = await (await createHandler(impl)(new Request(url), env)).text();
    const lines = text.split('\n');
    expect(lines[1]).toContain(`URI="https://vantara-fetch.example/v1/media?u=${encodeURIComponent('https://vd1.mycdn.me/v/key.bin')}`);
    expect(lines[3]).toBe(`https://vantara-fetch.example/v1/media?u=${encodeURIComponent('https://vd1.mycdn.me/v/seg-1.ts')}&r=${encodeURIComponent('https://ok.ru/')}&g=${grant}`);
    expect(lines[5]).toContain(encodeURIComponent('https://cdn.okcdn.ru/seg-2.ts'));
  });

  it('passes media from any public CDN but never a page, and never a private address', async () => {
    const { impl } = fakeUpstream({
      'https://s3.unlisted-cdn.example/v.mp4': () => new Response('MP4', { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-2/3' } }),
      'https://unlisted.example/page': () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      'https://evil.example/hop': () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }),
    });
    const { grant } = await mintGrant('u1', SECRET);
    const media = (u: string) => new Request(`https://vantara-fetch.example/v1/media?u=${encodeURIComponent(u)}&g=${grant}`, { headers: { range: 'bytes=0-2' } });
    const handle = createHandler(impl);
    const video = await handle(media('https://s3.unlisted-cdn.example/v.mp4'), env);
    expect(video.status).toBe(206);
    expect(video.headers.get('content-range')).toBe('bytes 0-2/3');
    expect((await handle(media('https://unlisted.example/page'), env)).status).toBe(415);
    expect((await handle(media('https://evil.example/hop'), env)).status).toBe(403);
    expect((await handle(media('http://10.0.0.1/x.mp4'), env)).status).toBe(403);
  });

  it('refuses media without a grant', async () => {
    const res = await createHandler(fakeUpstream({}).impl)(new Request('https://vantara-fetch.example/v1/media?u=https%3A%2F%2Fok.ru%2F'), env);
    expect(res.status).toBe(401);
  });

  it('the playlist rewriter leaves comments and blank lines alone', () => {
    expect(rewritePlaylist('#EXTM3U\n\n#EXT-X-ENDLIST', 'https://a.com/x.m3u8', (u) => `W(${u})`)).toBe('#EXTM3U\n\n#EXT-X-ENDLIST');
  });
});

describe('limits', () => {
  it('caps one user per minute without touching others', () => {
    const now = 60_000 * 1000;
    let tripped = false;
    for (let i = 0; i < 1000; i += 1) tripped = overLimit('heavy', now) || tripped;
    expect(tripped).toBe(true);
    expect(overLimit('light', now)).toBe(false);
    expect(overLimit('heavy', now + 60_000)).toBe(false);
  });
});
