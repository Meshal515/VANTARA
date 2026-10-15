import { describe, expect, it } from 'vitest';
import { createFollower } from './follow.js';

// المضيف يمرّر بسرعة ثابتة: صفحة كل ثانية، تحديث كل 80ms. الخادم يختم بوقته + 300ms
// تقديمًا، وكل رسالة تصل بعد 40–120ms (اهتزاز شبكة).
function host({ until = 2000, jitter = (i) => 40 + ((i * 37) % 80) } = {}) {
  const out = [];
  for (let i = 0, t = 0; t <= until; i++, t += 80) out.push({ at: 10_000 + t + 300, pos: t / 1000, local: 50_000 + t + jitter(i) });
  return out;
}

describe('متابعة المضيف بسلاسة', () => {
  it('الحركة المعروضة مستمرة بنفس سرعة المضيف رغم اهتزاز الشبكة', () => {
    const f = createFollower();
    const msgs = host();
    let next = 0;
    const shown = [];
    for (let local = 50_000; local <= 52_100; local += 16) {
      while (next < msgs.length && msgs[next].local <= local) { const m = msgs[next++]; f.push(m.at, m.pos, m.local); }
      const p = f.position(local);
      if (p) shown.push({ local, pos: p.pos });
    }
    // بعد البداية: كل إطار يتقدم ~16ms من الحركة (0.016 صفحة) — لا وقوف ولا قفز
    const steady = shown.filter((s) => s.local > 50_400 && s.local < 51_900);
    for (let i = 1; i < steady.length; i++) {
      const step = steady[i].pos - steady[i - 1].pos;
      expect(step).toBeGreaterThan(0.012);
      expect(step).toBeLessThan(0.02);
    }
    // التأخير ثابت وصغير: ~150ms + أقل تأخير شبكة
    const mid = steady[Math.floor(steady.length / 2)];
    const hostPosNow = (mid.local - 50_000) / 1000;
    expect(hostPosNow - mid.pos).toBeGreaterThan(0.15);
    expect(hostPosNow - mid.pos).toBeLessThan(0.25);
  });

  it('يستقر على آخر موضع بالضبط حين يتوقف المضيف', () => {
    const f = createFollower();
    for (const m of host({ until: 800 })) f.push(m.at, m.pos, m.local);
    const p = f.position(60_000);
    expect(p).toEqual({ pos: 0.8, settled: true });
  });

  it('القفزة الكبيرة (فصل/تقديم بعيد) تُعرض فورًا، والرسالة القديمة تُهمل', () => {
    const f = createFollower();
    expect(f.push(1000, 2, 5000)).toBe(true);
    expect(f.push(1080, 2.1, 5080)).toBe(false);
    expect(f.push(1160, 30, 5160)).toBe(true);
    expect(f.position(5160)).toEqual({ pos: 30, settled: true });
    expect(f.push(1100, 5, 5170)).toBe(false);
    expect(f.position(9000).pos).toBe(30);
  });

  it('بعد سكون طويل تبدأ الحركة من وقتها لا بقفزة', () => {
    const f = createFollower();
    f.push(1000, 4, 5040);
    // 10 ثوانٍ سكون ثم يبدأ المضيف يمرّر
    f.push(11_000, 4.08, 15_040);
    f.push(11_080, 4.16, 15_120);
    const p = f.position(15_120);
    expect(p.pos).toBeGreaterThanOrEqual(4);
    expect(p.pos).toBeLessThan(4.1);
  });
});
