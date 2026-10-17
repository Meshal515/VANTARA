import { describe, expect, it } from 'vitest';
import { genreArtQuery, pickGenreArt } from './anime-genre-art.js';

const media = (id, cid, image = `https://img/${cid}.png`) => ({ id, characters: { nodes: [{ id: cid, name: { full: `c${cid}` }, image: { large: image } }] } });

describe('وجوه الأنواع', () => {
  it('طلب واحد بأسماء مستعارة لكل نوع', () => {
    const q = genreArtQuery(['Action', 'Slice of Life']);
    expect(q).toContain('g0: Page');
    expect(q).toContain('genre: "Slice of Life"');
  });
  it('كل نوع يأخذ شخصية لم يأخذها نوع قبله، بلا صور AniList الافتراضية', () => {
    const data = {
      g0: { media: [media(1, 10), media(2, 20)] },
      g1: { media: [media(1, 10), media(3, 30, 'https://s4.anilist.co/file/anilistcdn/character/large/default.jpg'), media(4, 40)] },
      g2: { media: [] },
    };
    const art = pickGenreArt(data, ['Action', 'Adventure', 'Music']);
    expect(art.Action.image).toBe('https://img/10.png');
    expect(art.Adventure.image).toBe('https://img/40.png');
    expect(art.Music).toBeUndefined();
  });
});
