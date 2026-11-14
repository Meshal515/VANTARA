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
