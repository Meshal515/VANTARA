import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { MOTION, bindTabMotion, finishPageMotion, handoffSurface, pageIn, pageOut } from './page-motion.js';

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
  it('no spacer, no fixed viewport, for cinema or any work page', () => {
    for (const id of ['cinema', 'anime', 'detail']) {
      const p = page({ top: 0, left: 0, width: 390, height: 2400 }); p.id = id;
      p.before = vi.fn();
      pageIn(p, { depth: true, doc: { ...doc(), createElement: () => ({ style: {}, setAttribute: vi.fn(), remove: vi.fn() }) } });
      expect(p.before).not.toHaveBeenCalled();
      expect(p.style.position).toBeUndefined();
      expect(p.anims[0].frames[0]).toEqual({ opacity: 0, transform: `scale(${MOTION.push})` });
      finishPageMotion();
    }
  });
});

describe('work detail depth transition, with stationary contents', () => {
  it('zooms the whole work in and out (MOTION) without translating its children', () => {
    const a=page(), b=page();
    pageOut(a,{depth:true,doc:doc()});pageIn(b,{depth:true,doc:doc()});
    expect(a.anims[0].frames).toEqual([{opacity:1,transform:'scale(1)'},{opacity:0,transform:`scale(${MOTION.push})`}]);
    expect(b.anims[0].frames).toEqual([{opacity:0,transform:`scale(${MOTION.push})`},{opacity:1,transform:'scale(1)'}]);
    expect(a.anims[0].opts.duration).toBe(MOTION.ms);expect(b.anims[0].opts.duration).toBe(MOTION.ms);
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

describe('work/unified handoff uses the same page motion', () => {
  it('holds the outgoing work opaque while fading the saved modal back in', () => {
    const work=page({top:0,left:0,width:390,height:2500});
    pageOut(work,{depth:true,hold:true,doc:doc()});
    expect(work.anims[0].frames).toEqual([{opacity:1},{opacity:1}]);
    const origin=page();
    const onComplete=vi.fn();
    handoffSurface(origin,{enter:true,onComplete,doc:doc()});
    expect(origin.anims[0].frames).toEqual([{opacity:0},{opacity:1}]);
    expect(origin.anims[0].opts.duration).toBe(MOTION.ms);
    expect(origin.style.opacity).toBe('0');
    finishPageMotion();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(origin.style.opacity).toBe('');
    expect(work.classes.has('page-out')).toBe(false);
  });
  it('outgoing modal uses the existing fade and interrupts cleanly', () => {
    const modal=page();
    const onComplete=vi.fn();
    handoffSurface(modal,{doc:doc(),onComplete});
    expect(modal.anims[0].frames).toEqual([{opacity:1},{opacity:0}]);
    expect(modal.anims[0].opts.duration).toBe(MOTION.ms);
    handoffSurface(modal,{enter:true,doc:doc()});
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(modal.anims[0].cancel).toHaveBeenCalledOnce();
  });
});

// #323: الرجوع من صفحة عمل كان يخفي الشريط السفلي طوال تلاشيها (visibility:hidden على .dock ما دامت
// الصفحة page-out) ثم يُظهره دفعة واحدة بعد ~470ms. الشريط جزء مما ترجع إليه: يبقى ظاهرًا ثابتًا.
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
  it('medium premium push: 96% in 380ms, enter and exit', () => {
    expect(MOTION).toMatchObject({ ms: 380, push: 0.96 });
  });
  it('cinema gets the same push in and out as any work page', () => {
    const p = page(); p.id = 'cinema';
    pageOut(p, { depth: true, doc: doc() });
    expect(p.anims[0].frames.at(-1)).toEqual({ opacity: 0, transform: `scale(${MOTION.push})` });
    const q = page({ top: 0, left: 0, width: 390, height: 2400 }); q.id = 'cinema';
    pageIn(q, { depth: true, doc: doc() });
    expect(q.anims.at(-1).frames[0]).toEqual({ opacity: 0, transform: `scale(${MOTION.push})` });
    expect(q.anims.at(-1).opts.easing).toBe(MOTION.enter);
  });
});
