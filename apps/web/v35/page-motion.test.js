import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { MOTION, WORK_READY_MS, bindTabMotion, dockIn, dockOut, finishPageMotion, handoffSurface, motionUnits, pageIn, pageOut, readyGate, settleIn, veil } from './page-motion.js';

afterEach(() => { finishPageMotion(); vi.unstubAllGlobals(); });

function page(rect = { top: -900, left: 0, width: 390, height: 3000 }) {
  const anims = [];
  const classes = new Set();
  return {
    style: {},
    classList: { add: (c) => classes.add(c), remove: (...names) => names.forEach(c => classes.delete(c)), contains: (c) => classes.has(c) },
    getBoundingClientRect: () => rect,
    animate: vi.fn((frames, opts) => { const a = { frames, opts, cancel: vi.fn(), finished: new Promise(() => {}) }; anims.push(a); return a; }),
    anims,
    classes,
  };
}
/** صفحة عمل بمحتوى وشريط ثابت معلَن: الاندفاع على المحتوى، والشريط والصفحة نفسها لا تُحوَّل. */
function work(rect = { top: 0, left: 0, width: 390, height: 2400 }) {
  const p = page(rect);
  const node = (fixed = false) => { const n = page({ top: 100, left: 0, width: 390, height: 300 }); n.fixed = fixed; n.children = []; return n; };
  const bar = node(true), hero = node(), body = node();
  p.children = [bar, hero, body];
  p.querySelectorAll = (sel) => (sel === '[data-motion-fixed]' ? [bar] : []);
  p.querySelector = () => null;
  for (const c of p.children) c.parentElement = p;
  return { p, bar, hero, body };
}
const doc = (motion) => ({ documentElement: { dataset: motion ? { motion } : {} } });

describe('page fade (MOTION.ms fade in, the leaving page fades out behind)', () => {
  it('only opacity changes, in and out, 400ms, with the new page above the old', () => {
    const a = page(); const b = page();
    pageOut(a, { doc: doc() }); pageIn(b, { doc: doc() });
    expect(a.anims[0].frames).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(b.anims[0].frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(a.anims[0].opts.duration).toBe(MOTION.ms);
    expect(b.anims[0].opts.duration).toBe(MOTION.ms);
    expect(b.classes.has('page-in')).toBe(true);
  });
  it('back is the same fade: no direction, no movement', () => {
    const a = page(); const b = page();
    pageOut(a, { back: true, doc: doc() }); pageIn(b, { back: true, doc: doc() });
    expect(JSON.stringify([a.anims[0].frames, b.anims[0].frames])).not.toMatch(/transform|translate|scale/);
  });
  it('the leaving page stays where it was on screen (scroll and side rail), then is restored', () => {
    const a = page({ top: -924, left: 260, width: 1180, height: 3000 });
    pageOut(a, { doc: doc() });
    expect(a.classes.has('page-out')).toBe(true);
    expect(a.style).toMatchObject({ top: '0px', left: '260px', width: '1180px' });
    expect(a.scrollTop).toBe(924);
    finishPageMotion();
    expect(a.classes.has('page-out')).toBe(false);
    expect(a.style).toMatchObject({ top: '', left: '', width: '' });
    expect(a.anims[0].cancel).toHaveBeenCalled();
  });
  it('reduced motion: nothing animates', () => {
    const a = page(); const b = page();
    pageOut(a, { doc: doc('off') }); pageIn(b, { doc: doc('off') });
    expect(a.animate).not.toHaveBeenCalled();
    expect(b.animate).not.toHaveBeenCalled();
  });
});

describe('tabs inside a page (one rule for all of VANTARA)', () => {
  it('fades in what follows the tab bar after the handler re-renders it; the bar itself stays still', async () => {
    const { parseHTML } = await import('linkedom');
    const { document } = parseHTML('<div id="r"><section><nav role="tablist"><button role="tab" id="t">أ</button></nav><div id="c"></div></section></div>');
    const root = document.getElementById('r');
    const animated = [];
    for (const n of root.querySelectorAll('*')) n.animate = () => { animated.push(n.id || n.tagName); return {}; };
    vi.stubGlobal('requestAnimationFrame', (fn) => fn());
    bindTabMotion(root, { doc: doc() });
    document.getElementById('t').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
    expect(animated).toEqual(['c']);
  });
  it('a screen that moves its own content (insights) opts out: nothing under its tabs is faded out and back', async () => {
    const { parseHTML } = await import('linkedom');
    const { document } = parseHTML('<div id="r"><section><nav role="tablist" data-tab-motion="self"><button role="tab" id="t">أ</button></nav><div id="c"></div></section></div>');
    const root = document.getElementById('r');
    const animated = [];
    for (const n of root.querySelectorAll('*')) n.animate = () => { animated.push(n.id || n.tagName); return {}; };
    vi.stubGlobal('requestAnimationFrame', (fn) => fn());
    bindTabMotion(root, { doc: doc() });
    document.getElementById('t').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
    expect(animated).toEqual([]);
  });
});


describe('entry never pins the page (#323: the pin caused a 60px marquee jump when released)', () => {
  it('no spacer, no fixed viewport, no transform on the page itself, for any work page', () => {
    for (const id of ['cinema', 'anime', 'detail']) {
      const { p, hero } = work(); p.id = id;
      p.before = vi.fn();
      pageIn(p, { depth: true, doc: doc() });
      expect(p.before).not.toHaveBeenCalled();
      expect(p.style.position).toBeUndefined();
      expect(p.anims[0].frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
      expect(hero.anims[0].frames[0].scale).toBe(String(MOTION.push));
      finishPageMotion();
    }
  });
});

// الأشرطة الثابتة (الرجوع، الزر العائم) قفزت عند نهاية الحركة: transform على الصفحة يجعلها مرجع position:fixed
describe('work detail depth transition: the content pushes, the page and its fixed bars never transform', () => {
  it('fades the page and pushes every content unit in and out (MOTION), never the declared fixed bar', () => {
    const a = work(), b = work();
    pageOut(a.p, { depth: true, doc: doc() }); pageIn(b.p, { depth: true, doc: doc() });
    expect(a.p.anims[0].frames).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(b.p.anims[0].frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(JSON.stringify([a.p.anims, b.p.anims].flat().map((x) => x.frames))).not.toMatch(/transform|scale/);
    for (const u of [a.hero, a.body]) expect(u.anims[0].frames.map((f) => f.scale)).toEqual(['1', String(MOTION.push)]);
    for (const u of [b.hero, b.body]) expect(u.anims[0].frames.map((f) => f.scale)).toEqual([String(MOTION.push), '1']);
    expect(a.bar.animate).not.toHaveBeenCalled();
    expect(b.bar.animate).not.toHaveBeenCalled();
    for (const x of [...a.p.anims, ...b.p.anims, ...a.hero.anims, ...b.hero.anims]) expect(x.opts.duration).toBe(MOTION.ms);
    finishPageMotion();
    expect(a.hero.anims[0].cancel).toHaveBeenCalled();
  });
  it('motionUnits: siblings of every ancestor of a fixed bar, not the ancestors nor the bars', () => {
    const { p, bar, hero, body } = work();
    expect(motionUnits(p)).toEqual([hero, body]);
    const inner = work(); const wrap = inner.p; // صفحة > غلاف > (شريط، محتوى)
    const outer = page(); outer.children = [wrap]; wrap.parentElement = outer;
    outer.querySelectorAll = () => [inner.bar];
    inner.bar.parentElement = wrap;
    expect(motionUnits(outer)).toEqual([inner.hero, inner.body]);
    expect(motionUnits(outer)).not.toContain(bar);
  });
  it('clips the outgoing document to the visible viewport while preserving the reader position', () => {
    vi.stubGlobal('innerHeight',844);
    const a=page({top:-924,left:260,width:1180,height:14000});
    a.scrollTop=0;
    pageOut(a,{depth:true,doc:doc()});
    expect(a.style).toMatchObject({position:'fixed',top:'0px',left:'260px',width:'1180px',height:'844px',overflow:'hidden'});
    expect(a.scrollTop).toBe(924);
    finishPageMotion();expect(a.scrollTop).toBe(0);expect(a.style.height).toBe('');
  });
  it('has a bounded fallback and clears its timers when navigation is interrupted repeatedly', () => {
    vi.useFakeTimers();
    try {
      const a=page();pageIn(a,{depth:true,doc:doc()});
      expect(a.classes.has('page-in')).toBe(true);
      vi.advanceTimersByTime(601);
      expect(a.classes.has('page-in')).toBe(false);
      for(let i=0;i<50;i++){pageIn(a,{depth:true,doc:doc()});finishPageMotion();}
      expect(vi.getTimerCount()).toBe(0);
    } finally {vi.useRealTimers();}
  });
});

describe('الموحد يتبع العقد نفسه: الطبقة الفرعية تخرج وتدخل كأي صفحة', () => {
  it('الرجوع إلى الطبقة: العمل يغادر بتلاشٍ وتراجع (لا يُمسَك معتمًا)، والطبقة تدخل بتلاشٍ واندفاع', () => {
    const work = page({ top: 0, left: 0, width: 390, height: 2500 });
    pageOut(work, { depth: true, doc: doc() });
    expect(work.anims[0].frames).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    const origin = page();
    const onComplete = vi.fn();
    handoffSurface(origin, { enter: true, onComplete, doc: doc() });
    expect(origin.anims[0].frames).toEqual([{ opacity: 0, scale: String(MOTION.push) }, { opacity: 1, scale: '1' }]);
    expect(origin.anims[0].opts).toMatchObject({ duration: MOTION.ms, easing: MOTION.enter });
    finishPageMotion();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(work.classes.has('page-out')).toBe(false);
  });
  it('فتح عمل من الطبقة: تخرج بتلاشٍ وتراجع، وتُقاطَع نظيفًا', () => {
    const modal = page();
    const onComplete = vi.fn();
    handoffSurface(modal, { doc: doc(), onComplete });
    expect(modal.anims[0].frames).toEqual([{ opacity: 1, scale: '1' }, { opacity: 0, scale: String(MOTION.push) }]);
    expect(modal.anims[0].opts).toMatchObject({ duration: MOTION.ms, easing: MOTION.exit });
    handoffSurface(modal, { enter: true, doc: doc() });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(modal.anims[0].cancel).toHaveBeenCalledOnce();
  });
  it('الرئيسية تحت الطبقة العائدة محجوبة طوال دخولها (لا صفحة ثالثة ظاهرة)', () => {
    const home = page();
    veil(home, { doc: doc() });
    expect(home.anims[0].frames).toEqual([{ opacity: 0 }, { opacity: 0 }]);
    expect(home.anims[0].opts.duration).toBe(MOTION.ms);
  });
});

// بوابة الجاهزية: الانتقال كله ينتظر أساس صفحة العمل أو المهلة، ثم يبدأ دفعة واحدة من إطاره الأول
describe('بوابة جاهزية صفحة العمل', () => {
  const playable = () => { const p = page(); p.animate = vi.fn((frames, opts) => { const a = { frames, opts, cancel: vi.fn(), pause: vi.fn(), play: vi.fn(), finished: new Promise(() => {}) }; p.anims.push(a); return a; }); return p; };
  it('المغادرة والداخلة متوقفتان على إطارهما الأول حتى تُعلن الجاهزية، ثم تبدآن معًا', async () => {
    const g = readyGate(10_000);
    const a = playable(), b = playable();
    pageOut(a, { gate: g.promise, doc: doc() }); pageIn(b, { gate: g.promise, doc: doc() });
    expect(a.anims[0].pause).toHaveBeenCalled(); expect(b.anims[0].pause).toHaveBeenCalled();
    expect(a.anims[0].play).not.toHaveBeenCalled(); expect(b.anims[0].play).not.toHaveBeenCalled();
    expect(g.opened).toBe(false);
    g.ready();
    await g.promise;
    await Promise.resolve();
    expect(g.opened).toBe(true);
    expect(a.anims[0].play).toHaveBeenCalled(); expect(b.anims[0].play).toHaveBeenCalled();
  });
  it('المهلة تفتح البوابة إن تأخر القسم', async () => {
    vi.useFakeTimers();
    try {
      const g = readyGate(WORK_READY_MS);
      vi.advanceTimersByTime(WORK_READY_MS);
      expect(await g.promise).toBe('deadline');
      expect(g.opened).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it('المحتوى المتأخر يظهر بتلاشٍ في مكانه لا دفعة ولا حركة موضع', () => {
    const n = page();
    settleIn(n, { doc: doc() });
    expect(n.anims[0].frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(JSON.stringify(n.anims[0].frames)).not.toMatch(/transform|translate|scale/);
  });
});

// #323: الرجوع من صفحة عمل كان يخفي الشريط السفلي طوال تلاشيها (visibility:hidden على .dock ما دامت
// الصفحة page-out) ثم يُظهره دفعة واحدة بعد ~470ms. ولا يظهر دفعة واحدة فوق المغادرة: يدخل بعقد الحركة (أدناه).
describe('Back keeps the bottom bar on screen (no hide-then-pop)', () => {
  const css = ['core.css', 'manga.css', 'anime.css', 'cinema.css', 'unified-view.css']
    .map((f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')).join('\n');
  it('no rule hides or fades the dock while a page leaves', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}');
    const offenders = rules.filter((r) => /page-out|uv-page/.test(r.split('{')[0] || '') && /\.dock\b/.test(r.split('{')[0] || '')
      && /(visibility\s*:\s*hidden|opacity\s*:\s*0|display\s*:\s*none)/.test(r.split('{')[1] || ''));
    expect(offenders.map((r) => r.trim().slice(0, 120))).toEqual([]);
  });
});

// عقد حركة واحد (#323، قرار المالك): لا قسم مستثنى بالاسم؛ السينما تندفع كالبقية
describe('one motion contract for every section', () => {
  it('400ms both ways with one curve: entry no faster than exit (owner, 13 Nov)', () => {
    expect(MOTION).toMatchObject({ ms: 400, push: 0.96 });
    expect(MOTION.enter).toBe(MOTION.exit);
  });
  it('cinema gets the same push in and out as any work page', () => {
    const a = work(); a.p.id = 'cinema';
    pageOut(a.p, { depth: true, doc: doc() });
    expect(a.hero.anims[0].frames.at(-1).scale).toBe(String(MOTION.push));
    const b = work(); b.p.id = 'cinema';
    pageIn(b.p, { depth: true, doc: doc() });
    expect(b.hero.anims[0].frames[0].scale).toBe(String(MOTION.push));
    expect(b.hero.anims[0].opts.easing).toBe(MOTION.enter);
  });
});

// ملاحظة المالك (#323): الشريط ظهر كاملًا فوق صفحة العمل وهي تغادر. يدخل ويخرج مع الصفحة بالعقد نفسه
describe('the bottom bar follows the page motion contract', () => {
  it('enters with the destination: fade + push in, same duration and curve', () => {
    const nav = page();
    dockIn(nav, { doc: doc() });
    expect(nav.anims[0].frames).toEqual([{ opacity: 0, scale: String(MOTION.push) }, { opacity: 1, scale: '1' }]);
    expect(nav.anims[0].opts).toMatchObject({ duration: MOTION.ms, easing: MOTION.enter });
    expect(JSON.stringify(nav.anims[0].frames)).not.toMatch(/transform|translate/); // translate محجوز للوحة المفاتيح
  });
  it('leaves with the page, untouchable meanwhile, and is hidden only at the end', () => {
    const nav = page(); const done = vi.fn();
    dockOut(nav, { doc: doc(), onComplete: done });
    expect(nav.anims[0].frames.at(-1)).toEqual({ opacity: 0, scale: String(MOTION.push) });
    expect(nav.anims[0].opts).toMatchObject({ duration: MOTION.ms, easing: MOTION.exit });
    expect(nav.inert).toBe(true);
    expect(done).not.toHaveBeenCalled();
    finishPageMotion(); // تنقل جديد يقاطع: ينتهي فورًا ولا يبقى الشريط معطّلًا
    expect(done).toHaveBeenCalledOnce();
    expect(nav.inert).toBe(false);
  });
  it('reduced motion: no animation, hidden at once', () => {
    const nav = page(); const done = vi.fn();
    dockIn(nav, { doc: doc('off') }); dockOut(nav, { doc: doc('off'), onComplete: done });
    expect(nav.anims).toEqual([]);
    expect(done).toHaveBeenCalledOnce();
  });
});

// #323 (13 نوفمبر): أسباب القفزات المثبتة بالإطارات، كل واحد باختبار
describe('exit freezes scroll-linked depth layers as drawn (no snap before the exit)', () => {
  it('bakes every scroll-linked layer, finished or running, then restores it', () => {
    const layer = { style: {}, isConnected: true };
    const scrollTimeline = { constructor: { name: 'ScrollTimeline' } };
    const a = page({ top: -500, left: 0, width: 390, height: 3000 });
    const finished = { effect: { target: layer }, timeline: scrollTimeline, playState: 'finished', pause: vi.fn() };
    a.getAnimations = () => [finished];
    vi.stubGlobal('getComputedStyle', (n) => (n === layer ? { transform: 'matrix(0.84, 0, 0, 0.66, 0, -40)', opacity: '0.3' } : { opacity: '1' }));
    pageOut(a, { doc: doc() });
    expect(layer.style).toMatchObject({ animation: 'none', transform: 'matrix(0.84, 0, 0, 0.66, 0, -40)', opacity: '0.3' });
    expect(finished.pause).not.toHaveBeenCalled();
    finishPageMotion();
    expect(layer.style).toMatchObject({ animation: '', transform: '', opacity: '' });
  });
});

describe('the push is measured when the motion really starts (after the gate), not when it is requested', () => {
  it('a page built while the gate waits is pushed from its final layout', async () => {
    const { p, hero } = work();
    let open;
    const gate = new Promise((r) => { open = r; });
    pageIn(p, { depth: true, gate, doc: doc() });
    expect(hero.animate).not.toHaveBeenCalled();
    open();
    await gate; await Promise.resolve();
    expect(hero.animate).toHaveBeenCalledTimes(1);
    finishPageMotion();
  });
});

describe('no page is rebuilt while it moves (afterMotion)', () => {
  it('runs at once when still, waits while playing or leaving, and runs after', async () => {
    const { afterMotion, motionActive } = await import('./page-motion.js');
    const { p } = work();
    const ran = [];
    afterMotion(p, () => ran.push('still'));
    expect(ran).toEqual(['still']);
    pageIn(p, { depth: true, doc: doc() });
    expect(motionActive(p)).toBe(true);
    afterMotion(p, () => ran.push('later'));
    expect(ran).toEqual(['still']);
    finishPageMotion();
    await Promise.resolve();
    expect(ran).toEqual(['still', 'later']);
    const leaving = page();
    pageOut(leaving, { doc: doc(), gate: new Promise(() => {}) });
    expect(motionActive(leaving)).toBe(true);
    finishPageMotion();
  });
});
