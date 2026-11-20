import { describe, expect, it, vi } from 'vitest';
import { artRatio, createArtStore, isLocalArt, isOfficialArt } from './art.js';

const memory = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), _m: m }; };
const dims = { 'https://s4.anilist.co/c.jpg': [460, 690], 'https://src/a.jpg': [500, 750], 'https://src/big.jpg': [900, 1350], 'https://src/a.gif': [420, 600], 'https://s4.anilist.co/ban.jpg': [1900, 400], 'https://src/small-ban.jpg': [800, 300] };
const fakeProbe = () => vi.fn(async (url) => (dims[url] ? { url, width: dims[url][0], height: dims[url][1] } : null));

describe('قرار فن العمل الواحد (lib/art.js)', () => {
  // قاعدة المالك (16 نوفمبر 2026): أول غلاف مقبول يصل يفوز ولا يتبدل، إلا بحذف مصدره
  const slowProbe = (delays) => vi.fn((url) => new Promise((r) => setTimeout(() => r(dims[url] ? { url, width: dims[url][0], height: dims[url][1] } : null), delays[url] ?? 0)));
  it('أول غلاف مقبول يصل يفوز فورًا، ولا ينتظر الرسمي الأبطأ ولا الأعلى جودة', async () => {
    vi.useFakeTimers();
    try {
      const store = createArtStore({ storage: memory(), probe: slowProbe({ 'https://src/a.jpg': 50, 'https://src/big.jpg': 3000 }) });
      const slowOfficial = new Promise((r) => setTimeout(() => r({ cover: 'https://s4.anilist.co/c.jpg' }), 4000));
      const p = store.decide('w1', { official: slowOfficial, sources: ['https://src/big.jpg', 'https://src/a.jpg'] });
      await vi.advanceTimersByTimeAsync(60);
      const d = await p;
      expect(d.cover).toBe('https://src/a.jpg'); // 500×750 وصل بعد 50ms؛ 900×1350 والرسمي أبطأ
      await vi.advanceTimersByTimeAsync(7000);
      expect(store.get('w1').cover).toBe('https://src/a.jpg'); // لا يتبدل بعد وصول الأعلى جودة
    } finally { vi.useRealTimers(); }
  });
  it('المصغّر الصغير لا يفوز بالسبق، ولا مقبول في المهلة = الأفضل مما وصل', async () => {
    dims['https://src/thumb.jpg'] = [100, 130];
    vi.useFakeTimers();
    try {
      const store = createArtStore({ storage: memory(), probe: slowProbe({ 'https://src/thumb.jpg': 10, 'https://s4.anilist.co/c.jpg': 300 }) });
      const p = store.decide('t', { official: Promise.resolve({ cover: 'https://s4.anilist.co/c.jpg' }), sources: ['https://src/thumb.jpg'] });
      await vi.advanceTimersByTimeAsync(400);
      expect((await p).cover).toBe('https://s4.anilist.co/c.jpg');
    } finally { vi.useRealTimers(); }
    const only = createArtStore({ storage: memory(), probe: slowProbe({}) });
    expect((await only.decide('o', { sources: ['https://src/thumb.jpg'] })).cover).toBe('https://src/thumb.jpg');
  });
  it('البنر العريض يُكمَّل بعد الحسم والغلاف ثابت، وإلا الغلاف بأبعاده', async () => {
    const store = createArtStore({ storage: memory(), probe: fakeProbe() });
    const wide = await store.decide('b1', { official: Promise.resolve({ cover: 'https://s4.anilist.co/c.jpg', banner: 'https://s4.anilist.co/ban.jpg' }) });
    expect(wide.cover).toBe('https://s4.anilist.co/c.jpg');
    await new Promise((r) => setTimeout(r, 10));
    expect(store.get('b1')).toMatchObject({ cover: 'https://s4.anilist.co/c.jpg', banner: 'https://s4.anilist.co/ban.jpg', wide: true, bw: 1900, bh: 400 });
    await store.decide('b2', { official: Promise.resolve({ cover: 'https://s4.anilist.co/c.jpg' }), wideHint: 'https://src/small-ban.jpg' });
    await new Promise((r) => setTimeout(r, 10));
    expect(store.get('b2')).toMatchObject({ banner: 'https://s4.anilist.co/c.jpg', wide: false, bw: 460, bh: 690 });
  });
  it('حذف مصدر الغلاف وحده يعيد الحسم؛ الرسمي ومصادر مثبتة تبقى', async () => {
    const store = createArtStore({ storage: memory(), probe: fakeProbe() });
    await store.decide('s1', { sources: [{ url: 'https://src/a.jpg', sid: 'teamx' }] });
    await store.decide('s2', { sources: [{ url: 'https://src/big.jpg', sid: 'azora' }] });
    await store.decide('s3', { official: Promise.resolve({ cover: 'https://s4.anilist.co/c.jpg' }) });
    expect(store.get('s1').sid).toBe('teamx');
    store.forgetSources(new Set(['azora']));
    expect(store.get('s1')).toBeNull();
    expect(store.get('s2').cover).toBe('https://src/big.jpg');
    expect(store.get('s3').cover).toBe('https://s4.anilist.co/c.jpg');
  });
  // CV1: كان القرار يُحفظ بمسار الملف المحلي؛ يقلّمه المحرّك (MAX_COVERS) فيضيع الغلاف ويُحسم غيره
  it('القرار يُحفظ بالرابط الأصلي ولو قِيس من الملف المحلي المحفوظ', async () => {
    const local = 'http://localhost/_capacitor_file_/covers/a.jpg';
    dims[local] = [500, 750];
    const store = createArtStore({ storage: memory(), probe: fakeProbe() });
    const d = await store.decide('l', { sources: [{ url: Promise.resolve(local), origin: 'https://src/a.jpg', sid: 'x' }] });
    expect(d).toMatchObject({ cover: 'https://src/a.jpg', w: 500, h: 750, sid: 'x' });
    expect(isLocalArt(local)).toBe(true);
    expect(isLocalArt('https://src/a.jpg')).toBe(false);
  });
  // CV3: أي فشل لحظي (شبكة، 403) كان يمحو القرار فيُحسم غلاف آخر بعد العرض
  it('فشل لحظي لا يمحو القرار؛ يُنسى فقط بعد ثلاث مرات على امتداد يوم', async () => {
    const store = createArtStore({ storage: memory(), probe: fakeProbe() });
    await store.decide('f', { sources: ['https://src/a.jpg'] });
    const t0 = 1_000_000;
    expect(store.failed('f', t0)).toBe(false);
    expect(store.get('f').cover).toBe('https://src/a.jpg');
    expect(store.failed('f', t0 + 1000)).toBe(false);
    expect(store.failed('f', t0 + 2000)).toBe(false); // ثلاث في ثوانٍ: لحظي، يبقى
    expect(store.get('f').cover).toBe('https://src/a.jpg');
    store.shown('f'); // ظهر: تُصفّر
    expect(store.get('f').fail).toBeUndefined();
    store.failed('f', t0); store.failed('f', t0 + 3600_000);
    expect(store.failed('f', t0 + 25 * 3600_000)).toBe(true); // ميت فعلًا
    expect(store.get('f')).toBeNull();
  });
  it('قرار قديم مساره ملف محلي بلا أصل يُنسى عند فشله كما كان', async () => {
    const store = createArtStore({ storage: memory({ 'vantara.art.v1': JSON.stringify({ old: { cover: 'http://localhost/_capacitor_file_/c.jpg', w: 500, h: 750 } }) }), probe: fakeProbe() });
    expect(store.failed('old')).toBe(true);
    expect(store.get('old')).toBeNull();
  });
  it('المرشح وعدٌ (غلاف المحرّك المحفوظ) يدخل السباق لحظة وصوله', async () => {
    const store = createArtStore({ storage: memory(), probe: fakeProbe() });
    const d = await store.decide('p', { sources: [{ url: Promise.resolve('https://src/a.jpg'), sid: 'x' }] });
    expect(d).toMatchObject({ cover: 'https://src/a.jpg', sid: 'x' });
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
