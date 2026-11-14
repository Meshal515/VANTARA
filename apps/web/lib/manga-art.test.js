import { beforeEach, describe, expect, it } from 'vitest';
import { _resetArt, artScore, cachedArt, chooseBanner, chooseCover, rememberArt, resolveArt } from './manga-art.js';
import { matchMangaArt } from './manga-meta.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
beforeEach(() => _resetArt());

describe('غلاف المانجا وبنرها: المصدر الرئيسي أولًا ويُحسم قبل العرض', () => {
  it('الرسمي يتقدم ما لم يتفوق غلاف مصدر بوضوح', () => {
    const off = { url: 'al.jpg', width: 460, height: 690, official: true };
    expect(chooseCover([off, { url: 'src.jpg', width: 500, height: 750 }]).url).toBe('al.jpg');
    expect(chooseCover([off, { url: 'big.jpg', width: 1000, height: 1500 }]).url).toBe('big.jpg');
    expect(chooseCover([{ url: 'src.jpg', width: 300, height: 450 }]).url).toBe('src.jpg');
    expect(chooseCover([])).toBeNull();
  });
  it('المتحركة العالية الجودة تتقدم، والرديئة لا أولوية لها', () => {
    expect(artScore({ url: 'a.gif', width: 600, height: 900 })).toBe(600 * 900 * 2);
    expect(artScore({ url: 'a.gif', width: 200, height: 300 })).toBe(200 * 300 * 0.5);
    const off = { url: 'al.jpg', width: 460, height: 690, official: true };
    expect(chooseCover([off, { url: 'hq.gif', width: 600, height: 900 }]).url).toBe('hq.gif');
    expect(chooseCover([off, { url: 'lq.gif', width: 300, height: 450 }]).url).toBe('al.jpg');
  });
  it('البنر الحقيقي العريض إن كفى عرضه، وإلا أعلى غلاف جودةً', () => {
    const covers = [{ url: 'c1', width: 460, height: 690 }, { url: 'c2', width: 900, height: 1350 }];
    expect(chooseBanner({ url: 'b', width: 1900, height: 400 }, covers)).toEqual({ url: 'b', wide: true });
    expect(chooseBanner({ url: 'small', width: 900, height: 300 }, covers)).toEqual({ url: 'c2', wide: false });
    // عريض لكن ليس شريطًا (1.5:1): يشبه الغلاف ولا يُعرض بنرًا
    expect(chooseBanner({ url: 'squarish', width: 1500, height: 1000 }, covers)).toEqual({ url: 'c2', wide: false });
    expect(chooseBanner(null, covers)).toEqual({ url: 'c2', wide: false });
  });
  it('resolveArt يجلب الرسمي والمصادر معًا ويعيد قرارًا واحدًا', async () => {
    const dims = { 'al.jpg': [460, 690], 'banner.jpg': [1900, 400], 'src.jpg': [300, 450] };
    const probeImpl = async (url) => (dims[url] ? { url, width: dims[url][0], height: dims[url][1] } : null);
    const art = await resolveArt({ official: Promise.resolve({ cover: 'al.jpg', banner: 'banner.jpg' }), sources: ['src.jpg', 'dead.jpg'], probeImpl });
    expect(art).toEqual({ cover: 'al.jpg', banner: 'banner.jpg', wide: true });
    const none = await resolveArt({ official: Promise.reject(new Error('x')), sources: ['src.jpg'], probeImpl });
    expect(none).toEqual({ cover: 'src.jpg', banner: 'src.jpg', wide: false });
  });
  it('ما حُسم يُحفظ للعمل فلا يتبدل في الفتحة التالية', () => {
    const s = memory();
    rememberArt('ext:x', { cover: 'a', banner: 'b', wide: true }, s);
    _resetArt();
    expect(cachedArt('ext:x', s)).toEqual({ cover: 'a', banner: 'b', wide: true });
    expect(cachedArt('ext:y', s)).toBeNull();
  });
  it('مطابقة AniList للفن بالاسم نفسه بلا لبس، ولا فن لعمل للكبار', () => {
    const row = { id: 1, title: { english: 'Nano Machine' }, coverImage: { extraLarge: 'xl', large: 'l' }, bannerImage: 'bn', genres: [] };
    expect(matchMangaArt('Nano Machine', [row])).toEqual({ id: 1, cover: 'xl', banner: 'bn', color: null });
    expect(matchMangaArt('Nano Machine', [row, { ...row, id: 2 }])).toBeNull();
    expect(matchMangaArt('Nano Machine', [{ ...row, isAdult: true }])).toBeNull();
    expect(matchMangaArt('Other', [row])).toBeNull();
  });
});
