/**
 * فحص الرابط في جسر الـPWA قبل «جاهز»: مقطع Sendvid «This video is temporarily
 * unavailable» ملف mp4 حقيقي من خمس ثوانٍ (رد 206 video/mp4)، فلا يكفي النوع.
 * الحجم الكلي من Content-Range يكشفه، فلا يصل المشغل أبدًا.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../runtime.js', () => ({ getRuntime: async () => ({}) }));
vi.mock('../../lib/capabilities.js', () => ({ supports: () => true }));

const { MIN_REAL_BYTES, probeCandidate } = await import('./anime.js');

const runtime = { ensureMedia: async () => {}, fetcher: { mediaUrl: (u) => u } };
const reply = (status, type, range) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => ({ 'content-type': type, 'content-range': range })[k.toLowerCase()] ?? null },
  body: { cancel: async () => {} },
});
const probe = (c, fetchImpl) => probeCandidate(runtime, c, { fetchImpl });

describe('probe before ready', () => {
  it('rejects the Sendvid "temporarily unavailable" clip by its size', async () => {
    const v = await probe({ url: 'https://videos2.sendvid.com/x.mp4' }, reply(206, 'video/mp4', 'bytes 0-1/412311'));
    expect(v).toMatchObject({ ok: false });
    expect(v.reason).toContain('مقطع بديل');
  });
  it('accepts a real episode or film', async () => {
    expect(await probe({ url: 'https://cdn/x.mp4' }, reply(206, 'video/mp4', `bytes 0-1/${MIN_REAL_BYTES * 40}`))).toMatchObject({ ok: true });
    expect(await probe({ url: 'https://cdn/x.mp4' }, reply(200, 'application/octet-stream', null))).toMatchObject({ ok: true });
  });
  it('an HLS-looking URL returning HTML cannot be marked playable', async () => {
    expect(await probe({ url: 'https://cdn/master.m3u8' }, reply(200, 'text/html', null))).toMatchObject({ ok: false });
  });
  it('HLS playlists are small by nature and are not judged by size', async () => {
    expect(await probe({ url: 'https://cdn/master.m3u8' }, reply(206, 'application/vnd.apple.mpegurl', 'bytes 0-1/900'))).toMatchObject({ ok: true });
  });
  it('a page or an error is not a video; a slow probe is no verdict', async () => {
    expect(await probe({ url: 'https://h/e' }, reply(200, 'text/html', null))).toMatchObject({ ok: false });
    expect(await probe({ url: 'https://h/e.mp4' }, reply(403, 'text/html', null))).toMatchObject({ ok: false, reason: 'المضيف ردّ 403' });
    expect(await probe({ url: 'https://h/e.mp4' }, async () => { throw new Error('timeout'); })).toEqual({ ok: null, reason: null });
  });
});
it('probes an addon stream directly without source grant or source fetcher allowlist',async()=>{const r={ensureMedia:async()=>{throw new Error('must not request VANTARA auth');},fetcher:{mediaUrl:()=>{throw new Error('must not proxy addon');}}};let target;const out=await probeCandidate(r,{sourceId:'addon|demo',url:'https://cdn.test/video.mp4'},{fetchImpl:async u=>{target=u;return new Response(null,{status:206,headers:{'content-type':'video/mp4','content-range':'bytes 0-1/9000000'}});}});expect(target).toBe('https://cdn.test/video.mp4');expect(out.ok).toBe(true);});
