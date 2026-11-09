import { describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';

vi.mock('../lib/follow-time.js', () => ({ flushFollowTime: async () => {} }));
vi.mock('../lib/silk.js', () => ({ createSilk: () => ({ setPalette() {} }) }));

describe('إحصائيات المتابعة: تبديل القسم لا يهدم الصفحة', () => {
  it('الصفحة والدائرة نفسها تبقى، والشرائح تتحوّل، والمجموع يتحدّث', async () => {
    const { document, window } = parseHTML('<html><body><div id="h"></div></body></html>');
    globalThis.document = document; globalThis.window = window;
    globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#8f5cff' });
    globalThis.requestAnimationFrame = (f) => { f(performance.now() + 1000); return 1; };
    globalThis.cancelAnimationFrame = () => {};
    globalThis.localStorage = { getItem: () => null, setItem() {} };
    const { createInsights } = await import('./insights.js');
    const host = document.getElementById('h');
    const data = {
      a: { timeShared: true, totalMs: 7_200_000, content: [{ section: 'manga', seriesRef: 'al:1', activeMs: 3_600_000 }, { section: 'anime', seriesRef: 'anime:2', activeMs: 3_600_000 }] },
      b: { timeShared: true, totalMs: 3_600_000, content: [{ section: 'manga', seriesRef: 'al:3', activeMs: 600_000 }, { section: 'anime', seriesRef: 'anime:4', activeMs: 3_000_000 }] },
    };
    const sync = { user: { userId: 'a' }, rows: (t) => (t === 'accounts' ? [{ user_id: 'a' }, { user_id: 'b' }] : []), insights: async (uid) => data[uid] };
    const ins = createInsights({ sync, host, mountImage: async () => {}, openWork() {}, workFromRef: (r) => ({ id: r }), toast() {} });
    await ins.show();
    const box = host.querySelector('.ins');
    const pie = host.querySelector('.ins-pie');
    const before = [...pie.querySelectorAll('circle.ins-sl')].map((c) => c.getAttribute('stroke-dasharray'));
    expect(host.querySelector('.ins-head .ins-total').textContent).toBe('3 س 00 د');
    [...host.querySelectorAll('.ins-tabs button')].find((b) => b.dataset.k === 'anime').onclick();
    expect(host.querySelector('.ins')).toBe(box);
    expect(host.querySelector('.ins-pie')).toBe(pie);
    const after = [...pie.querySelectorAll('circle.ins-sl')].map((c) => c.getAttribute('stroke-dasharray'));
    expect(after).not.toEqual(before);
    expect(host.querySelector('.ins-head .ins-total').textContent).toBe('1 س 50 د');
    expect(box.dataset.kind).toBe('anime');
  });
});
