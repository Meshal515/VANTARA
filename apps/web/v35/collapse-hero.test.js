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

  it('بعد رفع الإصبع يتسلّم المسار الانزلاق بنفس قيم CSS ثم يعيده (WebView يحبس الانزلاق مع حركة مربوطة بالتمرير)', async () => {
    const { bindCollapsingHero } = await import('./collapse-hero.js');
    const g = globalThis;
    const saved = { window: g.window, getComputedStyle: g.getComputedStyle, requestAnimationFrame: g.requestAnimationFrame };
    const props = {};
    const node = (anim, h = 460) => ({ style: { setProperty: (k, v) => (props[k] = v) }, isConnected: true, offsetHeight: h, classList: { toggle() {} }, anim });
    const bg = node('aw-bg-depth'), head = node('aw-head-depth'), hero = node('none'), bar = node('none', 60);
    const on = {};
    g.window = { scrollY: 0, addEventListener: (k, f) => (on[k] = f), removeEventListener: (k) => delete on[k] };
    g.getComputedStyle = (n) => ({ animationName: n.anim });
    g.requestAnimationFrame = (f) => f();
    try {
      const unbind = bindCollapsingHero({ hero, bar, bg, head, active: () => true, flingHold: true });
      expect(props['--hero-span']).toBe('400px');
      // لمسة بلا تمرير: لا تسليم
      on.touchstart(); on.touchend();
      expect(bg.style.animation).toBeUndefined();
      on.touchstart();
      g.window.scrollY = 500; on.scroll();
      expect(bg.style.transform).toBeUndefined();
      on.touchend();
      expect(bg.style.animation).toBe('none');
      expect(head.style.animation).toBe('none');
      // يثبت عند نهاية المدى كما يثبت CSS
      expect(bg.style.transform).toContain('translate3d(0, 200.0px, 0) scale(1.1200)');
      expect(head.style.opacity).toBe('0');
      on.scrollend();
      expect(bg.style.animation).toBe('');
      expect(bg.style.transform).toBe('');
      expect(head.style.opacity).toBe('');
      unbind();
      expect(Object.keys(on)).toEqual([]);
      // زحلقة سريعة: حدث scroll يصل بعد رفع الإصبع، والتسليم يحدث بحركة الإصبع وحدها
      const bg3 = node('aw-bg-depth');
      bindCollapsingHero({ hero, bar, bg: bg3, head: null, active: () => true, flingHold: true });
      on.touchstart({ touches: [{ clientY: 700 }] });
      on.touchend({ changedTouches: [{ clientY: 520 }] });
      expect(bg3.style.animation).toBe('none');
    } finally { Object.assign(g, saved); }
  });
});

describe('طبقات العمق الإضافية (الغلاف واللوقو) تدخل التسليم نفسه', () => {
  it('لا تُكتب مع الإصبع، وبعد رفعه تُكتب بقيم معادلتها ثم تعود لـCSS', async () => {
    const { bindCollapsingHero } = await import('./collapse-hero.js');
    const g = globalThis;
    const saved = { window: g.window, getComputedStyle: g.getComputedStyle, requestAnimationFrame: g.requestAnimationFrame, innerHeight: g.innerHeight };
    const node = (anim, h = 460) => ({ style: { setProperty() {} }, isConnected: true, offsetHeight: h, classList: { toggle() {} }, anim });
    const hero = node('none'), bar = node('none', 60), cover = node('aw-cover-out');
    const on = {};
    g.window = { scrollY: 0, addEventListener: (k, f) => (on[k] = f), removeEventListener: (k) => delete on[k] };
    g.innerHeight = 1000;
    g.getComputedStyle = (n) => ({ animationName: n.anim });
    g.requestAnimationFrame = (f) => f();
    try {
      const layer = { node: cover, range: (_, vh) => [0, vh * 0.5], at: (t) => ({ transform: `t=${t}`, opacity: 1 - t }) };
      const unbind = bindCollapsingHero({ hero, bar, layers: [layer], active: () => true, flingHold: true });
      on.touchstart();
      g.window.scrollY = 250; on.scroll();
      expect(cover.style.transform).toBeUndefined();
      on.touchend();
      expect(cover.style.animation).toBe('none');
      expect(cover.style.transform).toBe('t=0.5');
      expect(cover.style.opacity).toBe('0.5');
      unbind();
      expect(cover.style.animation).toBe('');
    } finally { Object.assign(g, saved); }
  });
});

describe('التسليم لـJavaScript في WebView وحده، وعند حد الإطار', () => {
  const setup = () => {
    const g = globalThis;
    const saved = { window: g.window, getComputedStyle: g.getComputedStyle, requestAnimationFrame: g.requestAnimationFrame, innerHeight: g.innerHeight };
    const node = (anim, h = 460) => ({ style: { setProperty() {} }, isConnected: true, offsetHeight: h, classList: { toggle() {} }, anim });
    const on = {};
    const frames = [];
    g.window = { scrollY: 0, addEventListener: (k, f) => (on[k] = f), removeEventListener: (k) => delete on[k] };
    g.innerHeight = 1000;
    g.getComputedStyle = (n) => ({ animationName: n.anim });
    g.requestAnimationFrame = (f) => { frames.push(f); return frames.length; };
    const flush = () => { while (frames.length) frames.shift()(); };
    return { g, saved, node, on, flush };
  };
  it('يعرف WebView من علامته، وتطبيق أندرويد الأصلي، ولا يعدّ Chrome نفسه منها', async () => {
    const { flingHoldRisk } = await import('./collapse-hero.js');
    expect(flingHoldRisk('Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/155.0.8000.10 Mobile Safari/537.36', null)).toBe(true);
    expect(flingHoldRisk('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8000.10 Mobile Safari/537.36', null)).toBe(false);
    expect(flingHoldRisk('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/155.0', { isNativePlatform: () => true, getPlatform: () => 'android' })).toBe(true);
    expect(flingHoldRisk('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/155.0', { isNativePlatform: () => true, getPlatform: () => 'electron' })).toBe(false);
  });
  it('خارج WebView لا يُسجَّل مستمع لمس ولا يُكتب شيء على طبقة يحرّكها CSS مهما مرّر المستخدم', async () => {
    const { bindCollapsingHero } = await import('./collapse-hero.js');
    const { g, saved, node, on, flush } = setup();
    try {
      const cover = node('mw-webtoon-0');
      const layer = { node: cover, range: () => [0, 500], at: (t) => ({ transform: `t=${t}`, opacity: 1 }) };
      bindCollapsingHero({ hero: node('none'), layers: [layer], active: () => true, flingHold: false });
      flush();
      expect(on.touchstart).toBeUndefined();
      expect(on.touchend).toBeUndefined();
      for (const y of [120, 300, 80]) { g.window.scrollY = y; on.scroll(); flush(); }
      expect(cover.style.transform).toBeUndefined();
      expect(cover.style.animation).toBeUndefined();
    } finally { Object.assign(g, saved); }
  });
  it('في WebView: القيمة المكتوبة عند التسلّم هي موضع الإطار التالي لا موضع حدث الرفع المتأخر', async () => {
    const { bindCollapsingHero } = await import('./collapse-hero.js');
    const { g, saved, node, on, flush } = setup();
    try {
      const cover = node('mw-webtoon-0');
      const layer = { node: cover, range: () => [0, 500], at: (t) => ({ transform: `t=${t}`, opacity: 1 }) };
      bindCollapsingHero({ hero: node('none'), layers: [layer], active: () => true, flingHold: true });
      flush();
      on.touchstart({ touches: [{ clientY: 700 }] });
      g.window.scrollY = 200; // ما يعرفه الخيط الرئيسي لحظة الرفع
      on.touchend({ changedTouches: [{ clientY: 300 }] });
      expect(cover.style.animation).toBeUndefined(); // لا فصل قبل حد الإطار
      g.window.scrollY = 250; // تزامن مع المؤلِّف في بداية الإطار
      flush();
      expect(cover.style.animation).toBe('none');
      expect(cover.style.transform).toBe('t=0.5');
      // لمسة جديدة قبل الإطار تلغي التسلّم المعلّق
      on.scrollend(); flush();
      on.touchstart({ touches: [{ clientY: 700 }] });
      on.touchend({ changedTouches: [{ clientY: 300 }] });
      on.touchstart({ touches: [{ clientY: 300 }] });
      flush();
      expect(cover.style.animation).toBe('');
    } finally { Object.assign(g, saved); }
  });
});
