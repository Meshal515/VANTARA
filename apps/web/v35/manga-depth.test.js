import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEPTH_SPECS, depthMotion, layerValue } from './depth.js';
import { MANGA_LOOKS } from './manga-work.js';

// عمق تمرير المانجا (قرار المالك، 12 نوفمبر): «المعرض» وحده، ومن جدول depth.js كبقية الأقسام.
// المحرك اليدوي (mountMangaScrollDepth و--mw-scroll-depth) حُذف: كان يكتب متغيرًا بجافاسكربت كل إطار.
describe('manga scroll depth lives in the shared depth table', () => {
  it('only «المعرض» has a depth row; every other manga look scrolls flat', () => {
    expect(Object.keys(DEPTH_SPECS.manga)).toEqual(['gallery']);
    for (const look of MANGA_LOOKS.filter((l) => l !== 'gallery')) {
      expect(depthMotion('manga', look, { hero: null, dims: { span: 500, vh: 844 }, scope: '.x' }).layers).toEqual([]);
    }
  });
  it('«المعرض» keeps its numbers: the cover leans back 13° and recedes 175px over 380px on a phone', () => {
    const [cover] = DEPTH_SPECS.manga.gallery;
    expect(layerValue(cover, 0, 0).transform).toBe('perspective(1000px) translate3d(0px, 0.0px, 0.0px) rotateX(0.00deg) rotateY(0.00deg) scale(1.0000)');
    expect(layerValue(cover, 1, 0).transform).toBe('perspective(1000px) translate3d(0px, -22.0px, -175.0px) rotateX(13.00deg) rotateY(0.00deg) scale(1.0000)');
    expect(layerValue(cover, 1, 0).opacity).toBe(1);
    const css = depthMotion('manga', 'gallery', { hero: null, dims: { span: 500, vh: 844 }, scope: ".v35 #detail[data-look='gallery']", prefix: 'mw' }).css();
    expect(css).toContain('animation-range:0px 380px');
    expect(css).toContain(".v35 #detail[data-look='gallery'] .mw-stage > .mw-lift{animation:mw-gallery-0 linear both;animation-timeline:scroll(root block)");
    // إعداد «إيقاف الحركة» داخل التطبيق وإعداد النظام يوقفانه
    expect(css).toContain("html:not([data-motion='off'])");
    expect(css).toContain('prefers-reduced-motion: no-preference');
  });
  it('the depth layer is not the element that carries the entry animation', () => {
    const css = readFileSync(new URL('./manga.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\[data-look='gallery'\] \.mw-cover \{ animation: mw-d-gallery/);
    expect(DEPTH_SPECS.manga.gallery[0].sel).toBe('.mw-stage > .mw-lift');
    expect(css).not.toContain('--mw-scroll-depth');
    expect(css).not.toContain('data-scroll-depth');
  });
});
