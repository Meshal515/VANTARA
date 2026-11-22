import { describe, expect, it, vi } from 'vitest';
import { coverPreview } from './covers.js';

describe('coverPreview', () => {
  it('pairs a heavy Team-X cover with its light thumbnail', () => {
    expect(coverPreview('https://olympustaff.com/images/manga/b27aa95a.webp')).toBe('https://olympustaff.com/images/manga/thumbnail_b27aa95a.webp');
    expect(coverPreview('https://olympustaff.com/images/manga/thumbnail_b27aa95a.webp')).toBeNull();
    expect(coverPreview('https://uploads.mangadex.org/covers/x/y.jpg.512.jpg')).toBeNull();
    expect(coverPreview(null)).toBeNull();
  });
});

describe('nativeCover (#311 D-004، D-020)', () => {
  it('طلب لكل (مصدر، رابط)، لا يبقى معلقًا بعد الاستقرار، والفشل لا يُحفظ والناجح من الفهرس', async () => {
    vi.resetModules();
    const cover = vi.fn(async (sourceId, url) => (sourceId === 'bad' ? Promise.reject(new Error('403')) : `file:///${sourceId}/${url.split('/').pop()}`));
    vi.doMock('../lib/extension-engine.js', () => ({ default: { isAvailable: () => true, cover } }));
    const { nativeCover, _inflightCovers } = await import('./covers.js');
    const url = 'https://site/x.jpg';
    const [a, b] = await Promise.all([nativeCover(url, 'bad'), nativeCover(url, 'good')]);
    expect(a).toBeNull();
    expect(b).toBe('file:///good/x.jpg');
    expect(cover).toHaveBeenCalledTimes(2); // مصدران لا يتشاركان نتيجة أحدهما
    expect(_inflightCovers()).toBe(0);
    await nativeCover(url, 'good');
    expect(cover).toHaveBeenCalledTimes(2); // الناجح من الفهرس
    const other = 'https://site/y.jpg';
    await nativeCover(other, 'bad'); await nativeCover(other, 'bad');
    expect(cover).toHaveBeenCalledTimes(4); // الفاشل يُعاد طلبه
    vi.doUnmock('../lib/extension-engine.js');
  });
});

describe('a cover that failed in the first batch gets one patient retry (owner: most manga extensions showed empty covers)', () => {
  it('the retry asks the engine for a longer budget, through a narrower queue, and a failure is counted with its reason', async () => {
    vi.resetModules();
    let calls = 0;
    let active = 0;
    let peak = 0;
    const cover = vi.fn(async (_sourceId, url, options) => {
      calls += 1;
      if (!options?.budgetMs) throw new Error('timeout');
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return url.includes('dead') ? Promise.reject(new Error('cover HTTP 403')) : `file:///${url.split('/').pop()}`;
    });
    vi.doMock('../lib/extension-engine.js', () => ({ default: { isAvailable: () => true, cover } }));
    const { nativeCover, PATIENT_BUDGET_MS } = await import('./covers.js');
    const { _pending } = await import('../lib/source-report.js');
    const src = 'eu.kanade.tachiyomi.extension.ar.hizomanga#77';
    const urls = Array.from({ length: 8 }, (_, i) => `https://hizo.example/c${i}.jpg`);
    const first = await Promise.all(urls.map((u) => nativeCover(u, src)));
    expect(first.every((x) => x === null)).toBe(true);
    const retried = await Promise.all(urls.map((u) => nativeCover(u, src, { patient: true })));
    expect(retried).toEqual(urls.map((u) => `file:///${u.split('/').pop()}`));
    expect(cover.mock.calls.filter((c) => c[2]?.budgetMs === PATIENT_BUDGET_MS)).toHaveLength(8);
    expect(peak).toBeLessThanOrEqual(2);
    // نجح بعد الإعادة: من الفهرس بلا طلب
    await nativeCover(urls[0], src);
    expect(calls).toBe(16);
    // والفاشل بعد الصبر سببه في التشخيص، بمعرّف يقبله الخادم
    expect(await nativeCover('https://hizo.example/dead.jpg', src, { patient: true })).toBeNull();
    expect(_pending()).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'eu.kanade.tachiyomi.extension.ar.hizomanga.77', stage: 'cover', outcome: 'timeout' }),
      expect.objectContaining({ sourceId: 'eu.kanade.tachiyomi.extension.ar.hizomanga.77', stage: 'cover_retry', outcome: 'error', reason: 'cover HTTP 403' }),
    ]));
    vi.doUnmock('../lib/extension-engine.js');
  });
});
