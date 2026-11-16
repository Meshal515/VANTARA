import { describe, expect, it } from 'vitest';
import { DEPTH_SPECS, depthMotion, layerValue, lookMotion } from './depth.js';
import { rangeProgress } from './collapse-hero.js';

// العمق مع التمرير من مصدر واحد (#323 D2): CSS المؤلِّف وطبقات الانزلاق تُولَّد من الصف نفسه، فلا قفزة
// عند تسليم الانزلاق ولا نسختين يدويتين تتباعدان (كانت anime.css وanime-depth.js).
describe('depth: one table, one engine', () => {
  const dims = { span: 400, vh: 844 };
  it('«الأساسي» keeps the exact numbers it had (banner, cover, mark)', () => {
    const [banner, cover, mark] = DEPTH_SPECS.anime.core;
    expect(layerValue(banner, 1, 400).transform).toBe('perspective(900px) translate3d(0px, 168.0px, -140.0px) rotateX(34.00deg) rotateY(0.00deg) scale(1.1400)');
    expect(layerValue(banner, 1, 400).opacity).toBe(0);
    expect(layerValue(cover, 1, 400).transform).toBe('perspective(800px) translate3d(0px, -40.0px, -90.0px) rotateX(38.00deg) rotateY(0.00deg) scale(0.8400)');
    expect(layerValue(mark, 1, 400).transform).toBe('perspective(700px) translate3d(0px, -26.0px, -60.0px) rotateX(46.00deg) rotateY(0.00deg) scale(0.8600)');
    expect(cover.range).toEqual([0, 0.52]);
    expect(mark.range).toEqual([0.04, 0.6]);
  });
  it('hold: opacity stays 1 until hold, then fades linearly to 0', () => {
    const cover = DEPTH_SPECS.anime.core[1];
    expect(layerValue(cover, cover.hold, 400).opacity).toBe(1);
    expect(layerValue(cover, (1 + cover.hold) / 2, 400).opacity).toBeCloseTo(0.5, 5);
    expect(layerValue(cover, 1, 400).opacity).toBe(0);
    expect(lookMotion('core', { hero: null, dims }).css()).toContain(`${Math.round(cover.hold * 100)}%{opacity:1}`);
  });
  it('every style in every section: the CSS end keyframe is the glide layer end (no handoff jump)', () => {
    for (const [section, looks] of Object.entries(DEPTH_SPECS)) for (const look of Object.keys(looks)) {
      const m = depthMotion(section, look, { hero: null, dims, scope: `.x[data-style='${look}']` });
      const css = m.css();
      m.layers.forEach((l, i) => {
        const end = l.at(1);
        expect(css).toContain(`@keyframes wl-${look}-${i}{`);
        expect(css).toContain(`to{transform:${end.transform};opacity:${end.opacity}}`);
        const [a, b] = l.range();
        expect(css).toContain(`animation-range:${a}px ${Math.max(a + 1, b)}px`);
      });
    }
  });
  it('progress inside a range is clamped', () => {
    expect(rangeProgress(-10, [36, 540])).toBe(0);
    expect(rangeProgress(288, [36, 540])).toBe(0.5);
    expect(rangeProgress(900, [36, 540])).toBe(1);
  });
});
