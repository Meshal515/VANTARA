import { describe, expect, it, vi } from 'vitest';
import { artRatio, createArtStore, isOfficialArt } from './art.js';

const memory = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), _m: m }; };
const dims = { 'https://s4.anilist.co/c.jpg': [460, 690], 'https://src/a.jpg': [500, 750], 'https://src/big.jpg': [900, 1350], 'https://src/a.gif': [420, 600], 'https://s4.anilist.co/ban.jpg': [1900, 400], 'https://src/small-ban.jpg': [800, 300] };
const fakeProbe = () => vi.fn(async (url) => (dims[url] ? { url, width: dims[url][0], height: dims[url][1] } : null));

describe('قرار فن العمل الواحد (lib/art.js)', () => {
  it('الرسمي أولًا ما لم يتفوق مصدر بأكثر من 30% بالبكسلات المقيسة', async () => {
    const store = createArtStore({ storage: memory(), probe: fakeProbe() });
    const a = await store.decide('w1', { official: Promise.resolve({ cover: 'https://s4.anilist.co/c.jpg' }), sources: ['https://src/a.jpg'] });
    expect(a.cover).toBe('https://s4.anilist.co/c.jpg'); // 500×750 أكبر بـ18% فقط
    const b = await store.decide('w2', { official: Promise.resolve({ cover: 'https://s4.anilist.co/c.jpg' }), sources: ['https://src/big.jpg'] });
    expect(b.cover).toBe('https://src/big.jpg');
    expect([b.w, b.h]).toEqual([900, 1350]);
  });
  it('GIF عالي الجودة يتقدم على ثابت مقارب', async () => {
    const store = createArtStore({ storage: memory(), probe: fakeProbe() });
    const d = await store.decide('g', { official: null, sources: ['https://src/a.jpg', 'https://src/a.gif'] });
    expect(d.cover).toBe('https://src/a.gif');
  });
  it('البنر عريض حقيقي فقط (≥1200 و≥1.6)، وإلا الغلاف بأبعاده', async () => {
    const store = createArtStore({ storage: memory(), probe: fakeProbe() });
    const wide = await store.decide('b1', { official: Promise.resolve({ cover: 'https://s4.anilist.co/c.jpg', banner: 'https://s4.anilist.co/ban.jpg' }) });
    expect(wide).toMatchObject({ banner: 'https://s4.anilist.co/ban.jpg', wide: true, bw: 1900, bh: 400 });
    const narrow = await store.decide('b2', { official: Promise.resolve({ cover: 'https://s4.anilist.co/c.jpg' }), wideHint: 'https://src/small-ban.jpg' });
    expect(narrow).toMatchObject({ banner: 'https://s4.anilist.co/c.jpg', wide: false, bw: 460, bh: 690 });
  });
  it('قرار واحد: البطاقة وصفحة العمل تقرآن الشيء نفسه، وحسم واحد وقياس واحد لكل رابط', async () => {
    const probe = fakeProbe();
    const store = createArtStore({ storage: memory(), probe });
    const o = { official: Promise.resolve({ cover: 'https://s4.anilist.co/c.jpg' }), sources: ['https://src/a.jpg'] };
    const [x, y] = await Promise.all([store.decide('same', o), store.decide('same', o)]);
    expect(x).toBe(y);
    expect(store.get('same')).toEqual(x);
    expect(probe.mock.calls.filter(([u]) => u === 'https://src/a.jpg')).toHaveLength(1);
    // المحفوظ يُعاد بلا شبكة
    await store.decide('same', o);
    expect(probe).toHaveBeenCalledTimes(2);
  });
  it('يبقى بعد إعادة التشغيل، ويرحّل الصيغة السابقة دون مسحها', async () => {
    const storage = memory({ 'vantara.manga.art.v2': JSON.stringify({ old: { cover: 'https://src/a.jpg', banner: null, wide: false } }) });
    const store = createArtStore({ storage, probe: fakeProbe() });
    expect(store.get('old')).toMatchObject({ cover: 'https://src/a.jpg', wide: false });
    expect(storage.getItem('vantara.manga.art.v2')).toContain('old');
  });
  it('يُعلم المستمعين بالحسم، ولا قرار بلا غلاف صالح', async () => {
    const store = createArtStore({ storage: memory(), probe: fakeProbe() });
    const seen = vi.fn();
    store.onDecided(seen);
    expect(await store.decide('none', { sources: ['https://dead/x.jpg'] })).toBeNull();
    await store.decide('ok', { sources: ['https://src/a.jpg'] });
    expect(seen).toHaveBeenCalledWith('ok', expect.objectContaining({ cover: 'https://src/a.jpg' }));
  });
  it('رابط AniList رسمي أينما جاء، والنسبة للحجز من الأبعاد', () => {
    expect(isOfficialArt('https://s4.anilist.co/file/x.jpg')).toBe(true);
    expect(isOfficialArt('https://team-x/cover.jpg')).toBe(false);
    expect(artRatio({ w: 460, h: 690 })).toBe('460 / 690');
    expect(artRatio({ w: null })).toBeNull();
    // غلاف شاذ لا يكسر التخطيط: يُحصر
    expect(artRatio({ w: 300, h: 1200 })).toBe('0.55');
    expect(artRatio({ w: 1000, h: 800 })).toBe('0.85');
  });
});
