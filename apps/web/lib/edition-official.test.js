/**
 * رقم AniList للنسخة نفسها (MangaDex `links.al`، 22 نوفمبر). حالة حقيقية من مقياس الهوية: MangaDex يسمّي قصة جانبية
 * («Anastasia no Shinei Taichou»، 98409) باسم الأصل «Shoukoku no Altair» (31605)، فكان اكتشاف نسخ البطاقة يلصقها
 * بالأصل بمطابقة اسم تامة (دمج خاطئ). الرقم يفرّقهما، ويجمع نسختين باسم مشترك إن حملتا الرقم نفسه.
 */
import { describe, expect, it } from 'vitest';
import { canonicalIndex } from './catalog.js';
import { officialConflict } from './work-evidence.js';
import { withMangaDexNames } from './manga-evidence.js';
import { fetchMangaDexIdentity } from './manga-meta.js';

describe('هوية الاسم العربي من MangaDex', () => {
  const dex = (data) => async () => ({ ok: true, json: async () => ({ data }) });
  const m = (al, names, tags = []) => ({ attributes: { title: { en: names[0] }, altTitles: names.slice(1).map((n) => ({ ar: n })), links: al ? { al: String(al) } : {}, tags: tags.map((t) => ({ attributes: { name: { en: t } } })) } });
  it('one work carrying the exact Arabic name gives its AniList number and names', async () => {
    expect(await fetchMangaDexIdentity('العائد من العائلة الساقطة', { fetchImpl: dex([m(1001, ['Regressor of the Fallen Family', 'العائد من العائلة الساقطة']), m(1002, ['Other', 'العائد'])]) }))
      .toEqual({ id: 1001, names: ['Regressor of the Fallen Family', 'العائد من العائلة الساقطة'] });
  });
  it('two works with the name, no AniList link, or an adult work: no identity', async () => {
    expect(await fetchMangaDexIdentity('الوحش', { fetchImpl: dex([m(1, ['Monster', 'الوحش']), m(2, ['Beast', 'الوحش'])]) })).toBeNull();
    expect(await fetchMangaDexIdentity('الوحش', { fetchImpl: dex([m(null, ['Monster', 'الوحش'])]) })).toBeNull();
    expect(await fetchMangaDexIdentity('الوحش', { fetchImpl: dex([m(3, ['Monster', 'الوحش'], ['Ecchi', 'Harem'])]) })).toBeNull();
    expect(await fetchMangaDexIdentity('الوحش', { fetchImpl: async () => { throw new Error('offline'); } })).toBeNull();
  });
});

const P = 'eu.kanade.tachiyomi.extension';
const cardsOf = (index) => index.list().map((w) => w.editions.map((e) => `${e.sourceId.split('.').pop()}:${e.manga.title}`).sort());

describe('رقم النسخة', () => {
  it('an edition whose own AniList number differs from the title number never joins it by name', () => {
    const index = canonicalIndex({ officialIds: new Map([['shoukoku no altair', 31605]]) });
    index.add({ sourceId: `${P}.ar.manga3asq`, manga: { title: 'Shoukoku no Altair', url: '/a' } });
    index.add({ sourceId: `${P}.all.mangadex`, manga: { title: 'Shoukoku no Altair', url: '/manga/x', officialId: 98409 } });
    expect(cardsOf(index)).toHaveLength(2);
  });

  it('two editions of a shared name carrying the same number are one work; another number stays apart', () => {
    const index = canonicalIndex({ ambiguous: new Set(['monster']) });
    index.add({ sourceId: `${P}.all.mangadex`, manga: { title: 'Monster', url: '/manga/1', officialId: 30001 } });
    index.add({ sourceId: `${P}.en.mangafire`, manga: { title: 'Monster', url: '/m/1', officialId: 30001 } });
    index.add({ sourceId: `${P}.en.other`, manga: { title: 'Monster', url: '/m/2', officialId: 99999 } });
    const cards = cardsOf(index);
    expect(cards).toHaveLength(2);
    expect(cards.find((c) => c.length === 2)).toEqual(['mangadex:Monster', 'mangafire:Monster']);
  });

  it('discovery refuses a copy whose own number is another work, even when the title number would agree', () => {
    const officialOf = () => 31605;
    expect(officialConflict({ title: 'Shoukoku no Altair', officialId: 98409 }, 31605, officialOf)).toBe(true);
    expect(officialConflict({ title: 'Shoukoku no Altair', officialId: 31605 }, 31605, officialOf)).toBe(false);
    expect(officialConflict({ title: 'Shoukoku no Altair' }, 31605, officialOf)).toBe(false);
  });

  it('withMangaDexNames carries links.al from the MangaDex API onto each edition, cached for later pages', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    let calls = 0;
    const fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ data: [{ id, attributes: { title: { en: 'Shoukoku no Altair' }, altTitles: [], links: { al: '98409' } } }] }) }; };
    const page = { mangas: [{ title: 'Shoukoku no Altair', url: `/manga/${id}` }] };
    const out = await withMangaDexNames(`${P}.all.mangadex`, page, { fetchImpl });
    expect(out.mangas[0].officialId).toBe(98409);
    const again = await withMangaDexNames(`${P}.all.mangadex`, page, { fetchImpl });
    expect(again.mangas[0].officialId).toBe(98409);
    expect(calls).toBe(1);
  });
});
