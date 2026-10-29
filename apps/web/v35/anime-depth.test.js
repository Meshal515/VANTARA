import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bannerAt, coverAt, markAt, DEPTH } from './anime-depth.js';
import { rangeProgress } from './collapse-hero.js';

const css = readFileSync(new URL('./anime.css', import.meta.url), 'utf8');
const frame = (name, at) => {
  const block = css.slice(css.indexOf(`@keyframes ${name} {`));
  const line = block.split('\n').find((l) => l.trim().startsWith(at));
  return line ?? '';
};

describe('عمق صفحة عمل الأنمي: CSS وJavaScript بنفس المعادلة (لا قفزة عند تسليم الانزلاق)', () => {
  it('نهاية البنر في CSS هي نهايته في JavaScript', () => {
    const end = frame('aw-banner-out', 'to');
    expect(end).toContain(`perspective(${DEPTH.banner.perspective}px)`);
    expect(end).toContain(`calc(var(--aw-span) * ${DEPTH.banner.y})`);
    expect(end).toContain(`${DEPTH.banner.z}px) rotateX(${DEPTH.banner.rx}deg) scale(${DEPTH.banner.scale})`);
    expect(bannerAt(1, 400).transform).toBe('perspective(900px) translate3d(0, 168.0px, -140.0px) rotateX(34.00deg) scale(1.1400)');
    expect(bannerAt(1, 400).opacity).toBe(0);
    expect(bannerAt(0, 400).transform).toBe('perspective(900px) translate3d(0, 0.0px, 0.0px) rotateX(0.00deg) scale(1.0000)');
  });
  it('الغلاف واللوقو: نفس الأرقام ونفس نقطة بدء الخفوت', () => {
    for (const [name, d, at] of [['aw-cover-out', DEPTH.cover, coverAt], ['aw-mark-out', DEPTH.mark, markAt]]) {
      const end = frame(name, '100%');
      expect(end).toContain(`perspective(${d.perspective}px) translate3d(0, ${d.y}px, ${d.z}px) rotateX(${d.rx}deg) scale(${d.scale})`);
      expect(frame(name, `${Math.round(d.hold * 100)}%`)).toContain('opacity: 1');
      expect(at(d.hold).opacity).toBe(1);
      expect(at(1).opacity).toBe(0);
      expect(at((1 + d.hold) / 2).opacity).toBeCloseTo(0.5, 5);
    }
    expect(css).toContain(`animation-range: 0 ${DEPTH.cover.range[1] * 100}svh`);
    expect(css).toContain(`animation-range: ${DEPTH.mark.range[0] * 100}svh ${DEPTH.mark.range[1] * 100}svh`);
  });
  it('النسبة داخل المدى محصورة: قبل بدايته 0 وبعد نهايته 1', () => {
    expect(rangeProgress(-10, [36, 540])).toBe(0);
    expect(rangeProgress(288, [36, 540])).toBe(0.5);
    expect(rangeProgress(900, [36, 540])).toBe(1);
  });
});
