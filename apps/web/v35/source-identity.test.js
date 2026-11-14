import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/anime-meta.js', () => ({
  searchAnimeBatch: vi.fn(async (titles) => titles.map((t) => (/one piece/i.test(t)
    ? [{ id: 21, title: 'ONE PIECE', romaji: 'ONE PIECE', native: null, synonyms: [], poster: 'https://s4.anilist.co/op.jpg', banner: null, year: 1999 }]
    : /frieren/i.test(t) ? [{ id: 182255, title: "Frieren: Beyond Journey's End Season 2", romaji: 'Sousou no Frieren 2nd Season', native: null, synonyms: [], poster: 'x', year: 2026 }] : []))),
}));
vi.mock('../lib/cinema-meta.js', () => ({
  search: vi.fn(async (q) => (/heartland/i.test(q)
    ? [{ id: 'tt39448001', type: 'movie', title: 'Heartland', year: 2025, poster: 'https://images.metahub.space/poster/small/tt39448001/img' }]
    : [])),
}));

const { identityKind, resolveSourceIdentity, withOfficialIdentity } = await import('./source-identity.js');

describe('هوية العمل الرسمية من داخل مصدر', () => {

  it('نوع البطاقة: الأفلام والمسلسلات سينما، والأنمي أنمي، والمانجا خارج المطابقة', () => {
    expect(identityKind({ type: 'movie' }, { contentTypes: ['movie', 'series'] })).toBe('cinema');
    expect(identityKind({}, { contentTypes: ['anime'] })).toBe('anime');
    expect(identityKind({}, { contentTypes: ['manga'] })).toBe(null);
    expect(identityKind({ type: 'manga' }, { contentTypes: ['anime', 'manga'] })).toBe(null);
  });

  it('أنمي بعنوان المصدر المحشو يطابق عمل AniList نفسه بغلافه الرسمي', async () => {
    const id = await resolveSourceIdentity({ title: 'One Piece الحلقة 1100 مترجمة' }, { contentTypes: ['anime'] });
    expect(id).toMatchObject({ kind: 'anime', id: 21, poster: 'https://s4.anilist.co/op.jpg' });
  });

  it('الموسم الآخر لا يُقبل هوية: موسم أول من المصدر لا يأخذ بطاقة الموسم الثاني', async () => {
    expect(await resolveSourceIdentity({ title: 'Sousou no Frieren' }, { contentTypes: ['anime'] })).toBe(null);
  });

  it('عنوان عربي فقط لا يُسأل عنه، ويبقى غلاف المصدر', async () => {
    expect(await resolveSourceIdentity({ title: 'ون بيس' }, { contentTypes: ['anime'] })).toBe(null);
  });

  it('فيلم من أكوام يطابق IMDb بسنته، وملصقه بمقاس أوضح', async () => {
    const id = await resolveSourceIdentity({ title: 'فيلم Heartland 2025 مترجم', type: 'movie' }, { contentTypes: ['movie', 'series'] });
    expect(id).toMatchObject({ kind: 'cinema', id: 'tt39448001', type: 'movie' });
    expect(id.poster).toContain('/poster/medium/');
  });

  it('بطاقة العمل الأصلية والسيرفرات من المصدر وحده (_sourceCopy باقية)', () => {
    const copy = { sourceId: 'addon|cs3|akwam', url: 'https://example.test/movie/1' };
    const work = withOfficialIdentity({ id: 'addon-x', type: 'movie', title: 'Heartland', _sourceCopy: copy }, { kind: 'cinema', id: 'tt39448001', type: 'movie', poster: 'p', card: { id: 'tt39448001', title: 'Heartland', description: 'd' } });
    expect(work).toMatchObject({ id: 'tt39448001', description: 'd', _sourceCopy: copy, _officialIdentity: true });
    const anime = withOfficialIdentity({ id: 'addon-y', title: 'x', _sourceCopy: copy }, { kind: 'anime', id: 21, title: 'ONE PIECE', poster: 'op', card: { id: 21, title: 'ONE PIECE', poster: 'op' } });
    expect(anime).toMatchObject({ id: 21, cover: 'op', _sourceCopy: copy, _officialIdentity: true });
    // مسلسل: مواسم المصدر تبقى (صفحة المصدر لموسم بعينه)، والملصق والهوية رسمية فقط
    const series = withOfficialIdentity({ id: 'addon-z', type: 'series', seasons: [{ n: 18 }], _sourceCopy: copy }, { kind: 'cinema', id: 'tt1', type: 'series', poster: 'p', card: {} });
    expect(series).toMatchObject({ id: 'addon-z', seasons: [{ n: 18 }], poster: 'p', externalIds: { imdb: 'tt1' } });
    expect(series._officialIdentity).toBeUndefined();
  });
});
