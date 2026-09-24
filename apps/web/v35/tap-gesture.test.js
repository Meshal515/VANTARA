import { describe, expect, it } from 'vitest';
import { TAP, createTapRecognizer } from './tap-gesture.js';

/** مؤقّت يدوي: الوقت يتقدم بأمرنا لا بالساعة. */
function harness({ doubleTap = false } = {}) {
  let now = 0;
  let scroll = 0;
  const timers = [];
  const taps = [];
  const doubles = [];
  const r = createTapRecognizer({
    onTap: (p) => taps.push(p),
    onDoubleTap: (p) => doubles.push(p),
    doubleTap: () => doubleTap,
    scrollPos: () => scroll,
    setTimer: (fn, ms) => {
      const t = { at: now + ms, fn, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      if (t) t.live = false;
    },
  });
  const advance = (ms) => {
    now += ms;
    for (const t of timers) {
      if (t.live && t.at <= now) {
        t.live = false;
        t.fn();
      }
    }
  };
  const tap = (x = 200, y = 400, hold = 80) => {
    r.down({ id: 1, x, y, t: now });
    advance(hold);
    r.up({ id: 1, x, y, t: now });
  };
  return {
    r,
    taps,
    doubles,
    tap,
    advance,
    get now() {
      return now;
    },
    scrollTo(v) {
      scroll = v;
      r.scrolled(now);
    },
  };
}

describe('reader taps: only a deliberate tap shows the bars (Android GestureDetector rules)', () => {
  it('a quick, still tap is confirmed after the double-tap window', () => {
    const h = harness();
    h.tap();
    expect(h.taps).toHaveLength(0);
    h.advance(TAP.CONFIRM + 1);
    expect(h.taps).toHaveLength(1);
  });

  it('touching the page to stop a fling is not a tap', () => {
    const h = harness();
    h.scrollTo(500);
    h.advance(120); // المحتوى ما زال يندفع قبل لحظة
    h.tap();
    h.advance(TAP.CONFIRM + 1);
    expect(h.taps).toHaveLength(0);
    // بعد أن هدأ التمرير: ضغطة عادية
    h.advance(TAP.FLING_GUARD);
    h.tap();
    h.advance(TAP.CONFIRM + 1);
    expect(h.taps).toHaveLength(1);
  });

  it('a finger that moved past the slop, or content that moved under it, is a scroll', () => {
    const h = harness();
    h.r.down({ id: 1, x: 200, y: 400, t: 0 });
    h.r.move({ id: 1, x: 200, y: 400 + TAP.SLOP + 1 });
    h.r.up({ id: 1, x: 200, y: 400, t: 60 });
    h.advance(1000);
    expect(h.taps).toHaveLength(0);

    const g = harness();
    g.advance(1000);
    g.r.down({ id: 1, x: 200, y: 400, t: g.now });
    g.scrollTo(3); // المحتوى تحرك قليلًا تحت الإصبع
    g.advance(60);
    g.r.up({ id: 1, x: 200, y: 402, t: g.now });
    g.advance(1000);
    expect(g.taps).toHaveLength(0);
  });

  it('a slow press, a second finger, or a browser cancel is never a tap', () => {
    const h = harness();
    h.tap(200, 400, TAP.MAX_PRESS + 50);
    h.r.down({ id: 1, x: 200, y: 400, t: h.now });
    h.r.down({ id: 2, x: 260, y: 420, t: h.now });
    h.r.up({ id: 1, x: 200, y: 400, t: h.now + 50 });
    h.r.up({ id: 2, x: 260, y: 420, t: h.now + 60 });
    h.r.down({ id: 3, x: 200, y: 400, t: h.now + 100 });
    h.r.cancel({ id: 3 });
    h.r.up({ id: 3, x: 200, y: 400, t: h.now + 150 });
    h.advance(1000);
    expect(h.taps).toHaveLength(0);
  });

  it('a tap that turns out to start a scroll is dropped before it is confirmed', () => {
    const h = harness();
    h.advance(1000);
    h.tap();
    h.advance(100);
    h.scrollTo(80);
    h.advance(TAP.CONFIRM);
    expect(h.taps).toHaveLength(0);
  });

  it('with double-tap zoom on: two quick taps zoom and do not toggle the bars', () => {
    const h = harness({ doubleTap: true });
    h.advance(1000);
    h.tap(200, 400);
    h.advance(120);
    h.tap(210, 405);
    h.advance(1000);
    expect(h.doubles).toHaveLength(1);
    expect(h.taps).toHaveLength(0);
  });
});
