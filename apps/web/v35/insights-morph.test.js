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

describe('خللا الإحصائيات (9 نوفمبر): دحمي يختفي، ومنصور المقفل بلا ساعات', () => {
  it('من تابع أقل من دقيقة يبقى ظاهرًا بشريحة وصورة بعد الكل ← السينما ← الأنمي، والدائرة والقائمة نفسها بلا هدم', async () => {
    const { document, window } = parseHTML('<html><body><div id="h"></div></body></html>');
    globalThis.document = document; globalThis.window = window;
    globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#8f5cff' });
    globalThis.requestAnimationFrame = (f) => { f(performance.now() + 1000); return 1; };
    globalThis.cancelAnimationFrame = () => {};
    globalThis.localStorage = { getItem: () => null, setItem() {} };
    const { createInsights } = await import('./insights.js');
    const host = document.getElementById('h');
    const data = {
      me: { timeShared: true, totalMs: 36e6, content: [{ section: 'anime', seriesRef: 'anime:1', activeMs: 18e6 }, { section: 'cinema', seriesRef: 'cinema:tt1', activeMs: 18e6 }] },
      dahmi: { timeShared: true, totalMs: 30000, content: [{ section: 'anime', seriesRef: 'anime:2', activeMs: 30000 }] },
      mansour: { locked: true, totalMs: 7.2e6, sections: { manga: 0, anime: 7.2e6, cinema: 0 }, content: [] },
    };
    const sync = { user: { userId: 'me' }, rows: (t) => (t === 'accounts' ? Object.keys(data).map((user_id) => ({ user_id })) : []), insights: async (uid) => data[uid] };
    const ins = createInsights({ sync, host, mountImage: async () => {}, openWork() {}, workFromRef: (r) => ({ id: r }), toast() {} });
    await ins.show();
    const tab = (k) => [...host.querySelectorAll('.ins-tabs button')].find((b) => b.dataset.k === k).onclick();
    const pie = host.querySelector('.ins-pie');
    const legendRows = () => [...host.querySelectorAll('.ins-legend li')];
    const firstRows = legendRows();
    const slice = (uid) => [...pie.querySelectorAll('circle.ins-sl')].find((c) => c.dataset.uid === uid && c.dataset.gone !== '1');
    const lenOf = (c) => Number(c?.getAttribute('stroke-dasharray')?.split(' ')[0] ?? 0);
    tab('cinema');
    expect(slice('dahmi')).toBeUndefined(); // ما تابع سينما
    tab('anime');
    expect(host.querySelector('.ins-pie')).toBe(pie);
    expect(lenOf(slice('dahmi'))).toBeGreaterThan(20); // شريحة مرئية لا صفر
    expect([...pie.querySelectorAll('.ins-pav')].some((a) => a.dataset.uid === 'dahmi' && !a.classList.contains('ins-pav--gone'))).toBe(true);
    // القائمة نفسها (العقد ذاتها، لا صور تُعاد)
    for (const li of firstRows) expect(legendRows()).toContain(li);
    // منصور المقفل: ساعاته في الأنمي ظاهرة وشريحته موجودة، وقفل صغير
    const m = legendRows().find((li) => li.dataset.uid === 'mansour');
    expect(m.querySelector('.ins-h').textContent).toBe('2 س 00 د');
    expect(lenOf(slice('mansour'))).toBeGreaterThan(20);
    expect(m.querySelector('.ins-lock').style.display).not.toBe('none');
  });
});
