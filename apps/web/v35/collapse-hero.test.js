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
    // العمق: الخلفية تغوص (تكبر) والشعار ينحني للخلف بمنظور
    expect(b.bg).toContain('scale(1.1200)');
    expect(b.head).toContain('perspective(800px)');
    expect(b.head).toContain('rotateX(14.00deg)');
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

describe('العمق المربوط بالتمرير في CSS', () => {
  it('لا يكتب transform على عنصر يحرّكه CSS (كانت الكتابة المتأخرة إطارًا سبب اهتزاز البنر)، ويبقى طيّ الترويسة', async () => {
    const { bindCollapsingHero } = await import('./collapse-hero.js');
    const g = globalThis;
    const saved = { window: g.window, getComputedStyle: g.getComputedStyle, requestAnimationFrame: g.requestAnimationFrame };
    const node = (anim) => ({ style: {}, isConnected: true, offsetHeight: 460, classList: { toggle() {} }, anim });
    const bg = node('aw-bg-depth'), head = node('aw-head-depth'), hero = node('none'), bar = node('none');
    const toggled = [];
    bar.offsetHeight = 60; bar.classList = { toggle: (c, on) => toggled.push([c, on]) };
    g.window = { scrollY: 400, addEventListener() {}, removeEventListener() {} };
    g.getComputedStyle = (n) => ({ animationName: n.anim });
    g.requestAnimationFrame = (f) => f();
    try {
      bindCollapsingHero({ hero, bar, bg, head, active: () => true });
      expect(bg.style.transform).toBeUndefined();
      expect(head.style.transform).toBeUndefined();
      expect(toggled.at(-1)).toEqual(['collapsed', true]);
      // محرك بلا خط زمني للتمرير: يبقى المسار القديم
      const bg2 = node('none');
      bindCollapsingHero({ hero, bar, bg: bg2, head: null, active: () => true });
      expect(bg2.style.transform).toContain('translate3d(0, 200.0px, 0)');
    } finally { Object.assign(g, saved); }
  });
});
