/**
 * Videa وDailymotion في نسخة الويب (نقل Videa من Wrappers.kt): الجودات من XML
 * (والمشفّر RC4)، وHLS من metadata، وسبب الحذف حين يحذف المضيف الفيديو
 * («Törölt videó!»، Dailymotion DM005) بدل «فارغ».
 */
import { describe, expect, it } from 'vitest';
import { createHostResolver, dailymotionId, dailymotionStreams, rc4, videaSources, videaToken } from './hosts.js';
import { useLinkedom } from '../../../../tools/pwa/live-fetcher.mjs';
useLinkedom();

describe('upstream removal and progressive mirrors', () => {
  it('distinguishes a deleted upstream file from an empty extractor result', async () => {
    const resolver = createHostResolver({ text: async (url) => ({ url, status: 200, text: 'File was deleted' }) });
    await expect(resolver.resolve('https://mp4upload.com/embed-x.html')).rejects.toThrow('UPSTREAM_REMOVED');
  });
  it.each([
    [404, 'Not Found', false],
    [404, 'File was deleted', true],
    [410, 'Gone', true],
  ])('mirror HTTP %s (%s) only permits origin fallback when not terminal', async (status, text, terminal) => {
    const seen = [];
    const resolver = createHostResolver({ text: async (url) => {
      seen.push(new URL(url).hostname);
      return new URL(url).hostname === 'vibuxer.com'
        ? { url, status, text }
        : { url, status: 200, text: '<video src="https://cdn.test/live.mp4"></video>' };
    } });
    const result = resolver.resolve('https://hgcloud.to/e/stale');
    if (terminal) {
      await expect(result).rejects.toThrow(status === 410 ? 'UPSTREAM_HTTP_410' : 'UPSTREAM_REMOVED');
      expect(seen).toEqual(['vibuxer.com']);
    } else {
      expect((await result)[0].url).toBe('https://cdn.test/live.mp4');
      expect(seen).toEqual(['vibuxer.com', 'hgcloud.to']);
    }
  });
  it('returns the first MegaMax mirror without waiting for a dead parallel mirror', async () => {
    let release;
    const blocked = new Promise((r) => { release = r; });
    const fetcher = { text: async (url, opts) => {
      let text;
      if (opts?.headers?.['x-inertia']) text = JSON.stringify({ props: { streams: { data: [{ label: '720p', mirrors: [{ driver: 'mp4upload', link: 'https://slow.test/embed/1' }, { driver: 'earnvids', link: 'https://fast.test/embed/1' }] }] } } });
      else if (url.includes('share4max')) text = '<script data-page>{"version":"v"}</script>';
      else if (url.includes('slow')) { await blocked; text = ''; }
      else text = '<video src="https://cdn.test/720.mp4"></video>';
      return { url, status: 200, text };
    } };
    const result = createHostResolver(fetcher).resolve('https://share4max.net/iframe/1');
    const got = await Promise.race([result, new Promise((r) => setTimeout(() => r('blocked'), 100))]);
    release();
    expect(got).not.toBe('blocked');
    expect(got[0].quality).toBe(720);
  });
});

const XML = `<?xml version="1.0" encoding="UTF-8" ?>
<videa_video><video_sources exp="1791025595">
<video_source name="1080p" mimetype="video/mp4" height="1080">//videa.hu/static/w1080p/8.1</video_source>
<video_source name="480p" mimetype="video/mp4" height="480">//videa.hu/static/w480p/8.1?a=1&amp;b=2</video_source>
</video_sources><hash_values><hash_value_1080p>AAA</hash_value_1080p><hash_value_480p>BBB</hash_value_480p></hash_values></videa_video>`;

describe('videa', () => {
  it('rc4 is its own inverse (decrypting the encrypted XML)', () => {
    const data = new TextEncoder().encode(XML);
    expect(new TextDecoder().decode(rc4(rc4(data, 'k3y-seed-xs'), 'k3y-seed-xs'))).toBe(XML);
  });
  it('signed links for every quality, highest first', () => {
    const list = videaSources(XML, 'https://videa.hu/player?v=x');
    expect(list.map((s) => s.quality)).toEqual([1080, 480]);
    expect(list[0].url).toBe('https://videa.hu/static/w1080p/8.1?md5=AAA&expires=1791025595');
    expect(list[1].url).toBe('https://videa.hu/static/w480p/8.1?a=1&b=2&md5=BBB&expires=1791025595');
    expect(list[0].referer).toBe('https://videa.hu/player?v=x');
  });
  it('token needs a full _xt nonce', () => {
    expect(videaToken('var _xt = "short";')).toBeNull();
    expect(videaToken('no nonce')).toBeNull();
    // _xt حقيقي من videa.hu (2026-10)؛ رمز تالف لا يصنع «undefined»
    expect(videaToken('_xt = "bfiFwQCAP3kY9F2e_glnT_wR34wkPWYNpmbYsIJg6f8Rchtu7ysT6iWl8yzeWjli"')).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(videaToken(`_xt = "${'x'.repeat(64)}"`)).toBeNull();
  });
});

describe('dailymotion', () => {
  it('reads the id from embed and page links', () => {
    expect(dailymotionId('https://www.dailymotion.com/embed/video/x4ee2k6')).toBe('x4ee2k6');
    expect(dailymotionId('https://www.dailymotion.com/video/x8abc12?x=1')).toBe('x8abc12');
    expect(dailymotionId('https://dai.ly/x8abc12')).toBe('x8abc12');
  });
  it('HLS auto first, then the highest mp4', () => {
    const out = dailymotionStreams({ qualities: { auto: [{ type: 'application/x-mpegURL', url: 'https://cdn/m.m3u8' }], 720: [{ type: 'video/mp4', url: 'https://cdn/720.mp4' }], 380: [{ type: 'video/mp4', url: 'https://cdn/380.mp4' }] } });
    expect(out.map((s) => [s.type, s.quality])).toEqual([['hls', null], ['mp4', 720], ['mp4', 380]]);
  });
  it('a removed video says why', () => {
    expect(() => dailymotionStreams({ error: { title: 'Content rejected.', code: 'DM005' } })).toThrow('Dailymotion: Content rejected.');
  });
});
it.each([403,429,503])('reports HTTP %s rather than an empty extraction',async status=>{const r=createHostResolver({text:async url=>({url,status,text:'Forbidden'})});await expect(r.resolve('https://video.sibnet.ru/video.php?videoid=1')).rejects.toMatchObject({code:`UPSTREAM_HTTP_${status}`});});
it('classifies a script-only verification redirect without executing it',async()=>{const r=createHostResolver({text:async url=>({url,status:200,text:"<html><head><title>Loading...</title></head><body><script>window.location.replace('https://listeamed.net/e/1?ch=1&js=token');</script></body></html>"})});await expect(r.resolve('https://listeamed.net/e/1')).rejects.toMatchObject({code:'RESOLVER_BROWSER_REQUIRED'});});
