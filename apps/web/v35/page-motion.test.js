import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindTabMotion, finishPageMotion, pageIn, pageOut } from './page-motion.js';

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

describe('page fade (owner: nothing moves; 400ms fade in, the leaving page fades out behind)', () => {
  it('only opacity changes, in and out, 400ms, with the new page above the old', () => {
    const a = page(); const b = page();
    pageOut(a, { doc: doc() }); pageIn(b, { doc: doc() });
    expect(a.anims[0].frames).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(b.anims[0].frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(a.anims[0].opts.duration).toBe(400);
    expect(b.anims[0].opts.duration).toBe(400);
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


describe('work detail depth transition, with stationary contents', () => {
  it('zooms the whole work in and out at 400ms without translating its children', () => {
    const a=page(), b=page();
    pageOut(a,{depth:true,doc:doc()});pageIn(b,{depth:true,doc:doc()});
    expect(a.anims[0].frames).toEqual([{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(0.985)'}]);
    expect(b.anims[0].frames).toEqual([{opacity:0,transform:'scale(0.985)'},{opacity:1,transform:'scale(1)'}]);
    expect(a.anims[0].opts.duration).toBe(400);expect(b.anims[0].opts.duration).toBe(400);
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
  it('keeps fixed controls in a viewport and preserves document height for root scroll timelines', () => {
    vi.stubGlobal('innerHeight',844);
    const a=page({top:0,left:260,width:1180,height:14000});
    const spacer={style:{},setAttribute:vi.fn(),remove:vi.fn()};
    a.before=vi.fn();
    pageIn(a,{depth:true,doc:{...doc(),createElement:()=>spacer}});
    expect(a.style).toMatchObject({position:'fixed',top:'0px',left:'260px',width:'1180px',height:'844px',overflow:'auto'});
    expect(spacer.style.height).toBe('14000px');expect(a.before).toHaveBeenCalledWith(spacer);
    finishPageMotion();expect(spacer.remove).toHaveBeenCalled();expect(a.style.height).toBe('');
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
