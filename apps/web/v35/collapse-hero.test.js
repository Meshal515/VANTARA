import { describe, expect, it } from 'vitest';
import { collapseProgress, heroFrame } from './collapse-hero.js';

describe('البطل وهو ينطوي', () => {
  it('النسبة من 0 إلى 1 حتى يبلغ البطل الترويسة', () => {
    expect(collapseProgress(0, 460, 60)).toBe(0);
    expect(collapseProgress(200, 460, 60)).toBe(0.5);
    expect(collapseProgress(900, 460, 60)).toBe(1);
    expect(collapseProgress(-40, 460, 60)).toBe(0);
  });
  it('طبقتان بسرعتين: الخلفية أبطأ من الصفحة، والشعار يسبقها ويخفت، والترويسة تُطوى قرب النهاية', () => {
    const a = heroFrame(100, 0.2);
    expect(a.bg).toContain('translate3d(0, 50.0px, 0)');
    expect(a.head).toContain('translate3d(0, -18.0px, 0)');
    expect(a.headOpacity).toBe(1);
    expect(a.collapsed).toBe(false);
    const b = heroFrame(400, 1);
    expect(b.headOpacity).toBe(0);
    expect(b.collapsed).toBe(true);
  });
  it('تقليل الحركة: الطيّ وحده بلا انزلاق', () => {
    const f = heroFrame(400, 1, { still: true });
    expect(f.bg).toBeNull();
    expect(f.head).toBeNull();
    expect(f.collapsed).toBe(true);
  });
});
