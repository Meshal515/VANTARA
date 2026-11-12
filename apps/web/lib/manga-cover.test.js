import { describe, expect, it } from 'vitest';
import { coverCandidates, coverTier, pickCover } from './manga-cover.js';

const AL = 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx30013-x.jpg';
const AL_MED = 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/bx30013-x.jpg';
const MD = 'https://uploads.mangadex.org/covers/a1/b2.jpg';
const MD_256 = 'https://uploads.mangadex.org/covers/a1/b2.jpg.256.jpg';
const rank = (id) => ({ 'ar.mangalek': 0, 'ar.teamx': 2 })[id] ?? 9;

const shuffles = (arr) => [arr, [...arr].reverse(), [arr[1], arr[0], ...arr.slice(2)], [...arr.slice(2), ...arr.slice(0, 2)]];

describe('one cover per work', () => {
  it('AniList official cover wins at its highest resolution, whatever the order', () => {
    const c = [{ url: 'https://lek/a.jpg', sourceId: 'ar.mangalek' }, { url: MD }, { url: AL_MED }, { url: AL }];
    for (const order of shuffles(c)) expect(pickCover(order, { rank })).toBe(AL);
  });

  it('then MangaDex official, the original before its thumbnails', () => {
    const c = [{ url: MD_256 }, { url: 'https://lek/a.jpg', sourceId: 'ar.mangalek' }, { url: MD }];
    for (const order of shuffles(c)) expect(pickCover(order, { rank })).toBe(MD);
  });

  it('without an official cover: the most trusted source, then the best quality', () => {
    const c = [
      { url: 'https://teamx/full.jpg', sourceId: 'ar.teamx' },
      { url: 'https://lek/thumb_small.jpg', sourceId: 'ar.mangalek' },
      { url: 'https://lek/cover.jpg', sourceId: 'ar.mangalek' },
      { url: 'https://other/x.jpg', sourceId: 'zz' },
    ];
    for (const order of shuffles(c)) expect(pickCover(order, { rank })).toBe('https://lek/cover.jpg');
  });

  it('ignores empty and non-URL candidates; null when nothing is usable', () => {
    expect(pickCover([{ url: '' }, { url: null }, { url: 'data:x' }])).toBeNull();
    expect(pickCover([])).toBeNull();
  });

  it('a card list cover is not an official cover; an AniList meta card is', () => {
    expect(coverTier({ url: 'https://x/y.jpg', official: 'anilist' })).toBe(0);
    const sourceCard = { coverImage: { large: 'https://teamx/full.jpg' }, _work: { editions: [{ sourceId: 'ar.mangalek', manga: { thumbnailUrl: 'https://lek/cover.jpg' } }, { sourceId: 'ar.teamx', manga: { thumbnailUrl: 'https://teamx/full.jpg' } }] } };
    expect(pickCover(coverCandidates(sourceCard), { rank })).toBe('https://lek/cover.jpg');
    const metaCard = { ...sourceCard, _metaId: 30013, coverImage: { extraLarge: 'https://img.example/al.jpg' } };
    expect(pickCover(coverCandidates(metaCard), { rank })).toBe('https://img.example/al.jpg');
  });
});
