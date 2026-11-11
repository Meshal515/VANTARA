import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindTabMotion, finishPageMotion, handoffSurface, pageIn, pageOut } from './page-motion.js';

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


describe('work exit lifecycle', () => {
  it('invokes the same exit completion exactly once after interruption', () => {
    const work = page();
    const done = vi.fn();
    pageOut(work, { doc: doc(), onComplete: done });
    expect(done).not.toHaveBeenCalled();
    finishPageMotion();
    expect(done).toHaveBeenCalledTimes(1);
    finishPageMotion();
    expect(done).toHaveBeenCalledTimes(1);
  });
  it('completes immediately with reduced motion', () => {
    const work = page();
    const done = vi.fn();
    pageOut(work, { doc: doc('off'), onComplete: done });
    expect(done).toHaveBeenCalledTimes(1);
    expect(work.animate).not.toHaveBeenCalled();
  });
});

describe('cinema detail jump regression', () => {
  it('Dexter and marquee use an in-place fade, never a temporary fixed viewport or scroll restore', () => {
    const movie = page({top: 0, left: 0, width: 390, height: 2400});
    movie.id = 'cinema';
    const spacer = {style:{}, setAttribute:vi.fn(), remove:vi.fn()};
    movie.before = vi.fn();
    pageIn(movie, {depth:true,doc:{...doc(),createElement:()=>spacer}});
    expect(movie.anims[0].frames).toEqual([{opacity:0},{opacity:1}]);
    expect(movie.before).not.toHaveBeenCalled();
    expect(movie.style.position).toBeUndefined();
    expect(movie.classes.has('page-depth')).toBe(false);
    finishPageMotion();
    expect(movie.style.position).toBeUndefined();
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

describe('work/unified handoff uses the existing 400ms page motion', () => {
  it('cinema exits with exactly the same in-place fade as entrance', () => {
    const cinema=page({top:0,left:0,width:390,height:2600});
    cinema.id='cinema';
    pageIn(cinema,{depth:true,doc:doc()});
    finishPageMotion();
    pageOut(cinema,{depth:true,doc:doc()});
    expect(cinema.anims[0].frames).toEqual([{opacity:0},{opacity:1}]);
    expect(cinema.anims[1].frames).toEqual([{opacity:1},{opacity:0}]);
    expect(cinema.classes.has('page-depth')).toBe(false);
  });
  it('holds outgoing work until the saved modal finishes fading in, not a separate timer', () => {
    const work=page({top:0,left:0,width:390,height:2500});
    const release=pageOut(work,{depth:true,hold:true,doc:doc()});
    expect(work.classes.has('page-out')).toBe(true);
    expect(work.classes.has('page-held')).toBe(true);
    expect(work.animate).not.toHaveBeenCalled();
    const origin=page();
    const onComplete=vi.fn(() => release());
    handoffSurface(origin,{enter:true,onComplete,doc:doc()});
    expect(origin.anims[0].frames).toEqual([{opacity:0},{opacity:1}]);
    expect(origin.anims[0].opts.duration).toBe(400);
    expect(origin.style.opacity).toBe('0');
    expect(origin.style.transition).toBe('none'); // CSS fade must not race WAAPI
    expect(work.classes.has('page-out')).toBe(true);
    finishPageMotion();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(origin.style.opacity).toBe('');
    expect(origin.style.transition).toBe('');
    expect(work.classes.has('page-out')).toBe(false);
    expect(work.classes.has('page-held')).toBe(false);
    release(); // idempotent after interrupted/finished transitions
  });
  it('keeps the outgoing work visible beyond 400ms if the modal completion is delayed', () => {
    vi.useFakeTimers();
    try {
      const work=page({top:0,left:0,width:390,height:2500});
      const release=pageOut(work,{hold:true,doc:doc()});
      vi.advanceTimersByTime(1200);
      expect(work.classes.has('page-out')).toBe(true);
      release();
      expect(work.classes.has('page-out')).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {vi.useRealTimers();}
  });
  it('keeps a non-active outgoing page painted via the base page CSS', async () => {
    const {readFileSync}=await import('node:fs');
    const css=readFileSync(new URL('./core.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.v35 \.page\.page-out\s*\{[^}]*display:\s*block/);
    expect(css).toMatch(/\.v35 \.page\.page-out\s*\{[^}]*z-index:\s*5/);
    expect(css).toMatch(/\.v35 \.page\.page-out\.page-held\s*\{[^}]*background:\s*var\(--bg/);
  });
  it('outgoing modal uses the existing fade and interrupts cleanly', () => {
    const modal=page();
    const onComplete=vi.fn();
    handoffSurface(modal,{doc:doc(),onComplete});
    expect(modal.anims[0].frames).toEqual([{opacity:1},{opacity:0}]);
    expect(modal.anims[0].opts.duration).toBe(400);
    handoffSurface(modal,{enter:true,doc:doc()});
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(modal.anims[0].cancel).toHaveBeenCalledOnce();
  });
});

describe('outgoing work visuals stay mounted and unchanged', () => {
  it('keeps all four manga scroll depth looks active throughout page-out', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('./manga.css', import.meta.url), 'utf8');
    const selector = "#detail.mw:is(.active,.page-out)[data-scroll-depth='on']";
    expect(css.split(selector).length - 1).toBeGreaterThanOrEqual(8);
    expect(css).not.toContain("#detail.mw.active[data-scroll-depth='on']");
    const depth = readFileSync(new URL('./manga-work.js', import.meta.url), 'utf8');
    expect(depth).toContain("if (page.classList.contains('page-out')) return;");
  });

  it('keeps the cinema bar fixed and invalidates stale metadata before Back', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('./cinema.css', import.meta.url), 'utf8');
    const shell = readFileSync(new URL('./shell.js', import.meta.url), 'utf8');
    const cinema = readFileSync(new URL('./cinema.js', import.meta.url), 'utf8');
    expect(css).toContain("#cinema:is(.active,.page-out) .cn-detail-bar");
    expect(shell).toContain("if (from === 'cinema' && id !== 'cinema') cinema.leaveDetail()");
    expect(cinema).toContain("leaveDetail: () => { state.token++; }");
  });

  it('leaves hidden manga detail alone and paints Home only after exit', async () => {
    const { readFileSync } = await import('node:fs');
    const shell = readFileSync(new URL('./shell.js', import.meta.url), 'utf8');
    const core = readFileSync(new URL('./core.css', import.meta.url), 'utf8');
    expect(shell).toContain("if (state.current?.id !== work.id || currentPage() !== 'detail') return;");
    expect(shell).toContain("const deferHomePaint = id === 'home'");
    expect(shell).toContain('scrollTop: sourceScroll, onComplete: onWorkExit');
    expect(shell).toContain("if (id === 'detail') q('detailTop').classList.remove('collapsed')");
    expect(core).toContain("#detail.page-out, #anime.page-out, #cinema.page-out, .uv-page");
  });
});

describe('cinema wide-strip-only pixel-stable Back', () => {
  it('freezes the marquee image matrix and compensates its actual viewport delta', () => {
    const movie = page({top:0,left:0,width:390,height:2500});
    movie.id = 'cinema';
    const img = {};
    const props = new Map();
    const art = {
      getBoundingClientRect: () => ({top: movie.style.position === 'fixed' ? 144 : 92}),
      querySelector: () => img,
    };
    const fades = [];
    const detail = {
      style: {
        top: '',
        getPropertyValue: (k) => props.get(k) || '',
        setProperty: (k,v) => props.set(k,v),
        removeProperty: (k) => props.delete(k),
      },
      querySelector: () => art,
      animate: vi.fn((frames, opts) => {
        const animation = {frames,opts,cancel:vi.fn(),finished:new Promise(()=>{})};
        fades.push(animation);
        return animation;
      }),
    };
    movie.querySelector = () => detail;
    movie.querySelectorAll = () => [];
    vi.stubGlobal('getComputedStyle', () => ({transform:'matrix(1, 0, 0, 1, 0, 18)'}));
    const release = pageOut(movie,{hold:true,marqueeExit:true,doc:doc()});
    expect(detail.style.top).toBe('-52px');
    expect(props.get('--cn-exit-img-transform')).toBe('matrix(1, 0, 0, 1, 0, 18)');
    expect(fades[0].frames).toEqual([
      {opacity:1,offset:0},{opacity:0,offset:0.38},{opacity:0,offset:1},
    ]);
    expect(movie.animate).not.toHaveBeenCalled();
    release();
    expect(detail.style.top).toBe('');
    expect(props.has('--cn-exit-img-transform')).toBe(false);
    expect(fades[0].cancel).toHaveBeenCalledTimes(1);
  });

  it('does not use the marquee exit for another cinema work style', () => {
    const movie=page({top:0,left:0,width:390,height:2200});
    movie.id='cinema';
    movie.querySelector=() => null;
    pageOut(movie,{marqueeExit:true,doc:doc()});
    expect(movie.anims[0].frames).toEqual([{opacity:1},{opacity:0}]);
  });

  it('does not reveal the unified update grid while marquee is still visible', () => {
    const origin=page();
    handoffSurface(origin,{enter:true,throughBlack:true,doc:doc()});
    expect(origin.anims[0].frames).toEqual([
      {opacity:0,offset:0},{opacity:0,offset:0.38},{opacity:1,offset:1},
    ]);
    const home=page();
    pageIn(home,{throughBlack:true,doc:doc()});
    expect(home.anims[0].frames).toEqual(origin.anims[0].frames);
  });

  it('keeps the existing cinema wide-strip size and scopes the freeze to page-out', async () => {
    const {readFileSync}=await import('node:fs');
    const css=readFileSync(new URL('./cinema.css',import.meta.url),'utf8');
    expect(css).toMatch(/\.cn-detail\[data-style='marquee'\] \.cn-detail-art\s*\{\s*aspect-ratio:\s*2\.39\s*\/\s*1/);
    expect(css).toContain("#cinema.page-out .cn-detail[data-style='marquee'] .cn-detail-art > .cn-img");
    const shell=readFileSync(new URL('./shell.js',import.meta.url),'utf8');
    expect(shell).toContain("const marqueeExit = from === 'cinema'");
    expect(shell).toContain("throughBlack: marqueeReturn");
  });
});
