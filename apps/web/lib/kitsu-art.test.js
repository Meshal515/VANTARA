import { beforeEach, describe, expect, it } from 'vitest';
import { _resetKitsu, kitsuArt } from './kitsu-art.js';
import { createArtStore } from './art.js';

const body = (al, kind = 'manga') => ({
  data: [{ attributes: { externalSite: `anilist/${kind}`, externalId: String(al) }, relationships: { item: { data: { id: '54139', type: kind } } } }],
  included: [{ id: '54139', type: kind, attributes: {
    posterImage: { large: 'https://k/poster-large.jpg', original: 'https://k/poster.jpg', meta: { dimensions: { large: { width: 550, height: 780 } } } },
    coverImage: { large: 'https://k/cover-large.jpg', original: 'https://k/cover.png', meta: { dimensions: { large: { width: 3360, height: 800 } } } },
  } }],
});
const fetchOf = (json, calls = []) => async (url) => { calls.push(url); return { ok: true, json: async () => json }; };
beforeEach(() => _resetKitsu());

describe('Kitsu art by confirmed AniList identity', () => {
  it('takes the light «large» poster and banner of the mapped item', async () => {
    const calls = [];
    const art = await kitsuArt(105778, { fetchImpl: fetchOf(body(105778), calls) });
    expect(art).toEqual({ cover: { url: 'https://k/poster-large.jpg', width: 550, height: 780 }, banner: { url: 'https://k/cover-large.jpg', width: 3360, height: 800 } });
    expect(calls[0]).toContain('filter[externalSite]=anilist/manga&filter[externalId]=105778');
    await kitsuArt(105778, { fetchImpl: fetchOf(body(105778), calls) });
    expect(calls).toHaveLength(1); // مرة لكل عمل في الجلسة
  });
  it('rejects a mapping for another id, and survives failures without caching them', async () => {
    expect(await kitsuArt(1, { fetchImpl: fetchOf(body(2)) })).toBeNull();
    _resetKitsu();
    const failing = async () => { throw new Error('offline'); };
    expect(await kitsuArt(5, { fetchImpl: failing })).toBeNull();
    expect(await kitsuArt(5, { fetchImpl: fetchOf(body(5)) })).not.toBeNull();
    expect(await kitsuArt(0)).toBeNull();
  });
});

describe('the one art decision weighs every official source', () => {
  it('a sharper Kitsu cover and wider Kitsu banner win over AniList; AniList stays when Kitsu is absent', async () => {
    const dims = { al: [460, 650], alb: [1900, 400], k: [550, 780], kb: [3360, 800] };
    const probe = async (url) => (dims[url] ? { url, width: dims[url][0], height: dims[url][1] } : null);
    const store = createArtStore({ storage: null, probe });
    const d = await store.decide('ext:x', { official: Promise.resolve({ cover: 'al', banner: 'alb', more: [{ cover: 'k', banner: 'kb' }] }) });
    expect(d).toMatchObject({ cover: 'k', w: 550, h: 780, banner: 'kb', wide: true, bw: 3360, bh: 800 });
    const e = await store.decide('ext:y', { official: Promise.resolve({ cover: 'al', banner: 'alb' }) });
    expect(e).toMatchObject({ cover: 'al', banner: 'alb', wide: true });
  });
});
