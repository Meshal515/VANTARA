/**
 * انحدار دائم لهوية الأنمي: كل موسم/فيلم/OVA عمل مستقل في AniList، ولا تُعطى
 * حلقاته لغيره. العناوين حقيقية من Shahiid وWitAnime (بحث حيّ 2026-10).
 */
import { describe, expect, it } from 'vitest';
import { judgeAnimeCopy, pickCopies } from './anime-engine.js';

const c = (sourceId, title) => ({ sourceId, title, url: `/${sourceId}/${encodeURIComponent(title)}` });
const pick = (titles, list, criteria) => pickCopies(list, titles, criteria)?.copies.map((x) => x.title) ?? [];

const AOT = [
  c('shahiid', 'Shingeki no Kyojin'), c('shahiid', 'Shingeki no Kyojin: The Final Season'), c('shahiid', 'Shingeki no Kyojin Season 3 Part 2'),
  c('shahiid', 'Shingeki no Kyojin OVA'), c('witanime', 'Shingeki no Kyojin Season 2'), c('witanime', 'Shingeki no Kyojin Movie: Kanketsu-hen THE LAST ATTACK'),
  c('witanime', 'Shingeki no Kyojin'),
];
const KNY = [
  c('shahiid', 'Kimetsu no Yaiba'), c('shahiid', 'Kimetsu no Yaiba: Yuukaku-hen'), c('witanime', 'Kimetsu no Yaiba Yuukaku-hen'),
  c('witanime', 'Kimetsu no Yaiba Movie: Mugen Ressha-hen'), c('witanime', 'Kimetsu no Yaiba Hashira Geiko-hen'), c('witanime', 'Kimetsu no Yaiba'),
];

describe('each season, movie and OVA is its own work', () => {
  it('Attack on Titan S1 takes only S1 copies (two sources), never the OVA or later seasons', () => {
    const got = pick(['Attack on Titan', 'Shingeki no Kyojin', '進撃の巨人'], AOT);
    expect(got).toEqual(['Shingeki no Kyojin', 'Shingeki no Kyojin']);
    const ova = judgeAnimeCopy(c('shahiid', 'Shingeki no Kyojin OVA'), ['Shingeki no Kyojin']);
    expect(ova).toMatchObject({ ok: false, reason: 'sequel' });
  });

  it('Attack on Titan Season 2 takes its own season only', () => {
    expect(pick(['Attack on Titan Season 2', 'Shingeki no Kyojin Season 2'], AOT)).toEqual(['Shingeki no Kyojin Season 2']);
  });

  it('Demon Slayer S1 vs Entertainment District arc vs the Mugen Train movie', () => {
    expect(pick(['Demon Slayer: Kimetsu no Yaiba', 'Kimetsu no Yaiba'], KNY)).toEqual(['Kimetsu no Yaiba', 'Kimetsu no Yaiba']);
    expect(pick(['Demon Slayer: Kimetsu no Yaiba Entertainment District Arc', 'Kimetsu no Yaiba: Yuukaku-hen'], KNY)).toEqual(['Kimetsu no Yaiba: Yuukaku-hen', 'Kimetsu no Yaiba Yuukaku-hen']);
    expect(pick(['Demon Slayer: Kimetsu no Yaiba the Movie: Mugen Train', 'Kimetsu no Yaiba Movie: Mugen Ressha-hen'], KNY)).toEqual(['Kimetsu no Yaiba Movie: Mugen Ressha-hen']);
  });

  it('Jujutsu Kaisen: "(TV)" is the same work; "0" (the movie) and Season 2 are not', () => {
    const list = [c('shahiid', 'Jujutsu Kaisen (TV)'), c('witanime', 'JUJUTSU KAISEN'), c('witanime', 'JUJUTSU KAISEN 0'), c('witanime', 'JUJUTSU KAISEN Season 2'), c('shahiid', 'Jujutsu Kaisen 2nd Season')];
    expect(pick(['Jujutsu Kaisen', '呪術廻戦'], list)).toEqual(['Jujutsu Kaisen (TV)', 'JUJUTSU KAISEN']);
    expect(pick(['Jujutsu Kaisen Season 2', 'Jujutsu Kaisen 2nd Season'], list)).toEqual(['JUJUTSU KAISEN Season 2', 'Jujutsu Kaisen 2nd Season']);
  });

  it('One Piece the series never takes a film or an "Episode of" special', () => {
    const list = [c('witanime', 'One Piece'), c('witanime', 'One Piece Film Red'), c('witanime', 'One Piece: Stampede'), c('witanime', 'One Piece Film: Z')];
    expect(pick(['One Piece'], list)).toEqual(['One Piece']);
    expect(judgeAnimeCopy(c('w', 'One Piece Film Red'), ['One Piece'])).toMatchObject({ ok: false });
  });

  it('a different year in the source title is another work (remake vs original)', () => {
    const list = [c('a', 'Hunter x Hunter (2011)'), c('b', 'Hunter x Hunter 1999')];
    expect(pick(['Hunter x Hunter (2011)', 'Hunter x Hunter'], list, { year: 2011 })).toEqual(['Hunter x Hunter (2011)']);
    expect(judgeAnimeCopy(c('b', 'Hunter x Hunter 1999'), ['Hunter x Hunter'], { year: 2011 })).toMatchObject({ ok: false, reason: 'year' });
  });
});
