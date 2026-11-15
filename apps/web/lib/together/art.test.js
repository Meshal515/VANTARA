import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aniZipArt, episodeLine, imdbFromCinemeta, logoOfImdb, mediaKind, resolveArt } from './art.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

describe('room art', () => {
  beforeEach(() => { globalThis.localStorage = memory(); });

  it('names the kind correctly (series are not anime, manga is not a recommendation)', () => {
    expect(mediaKind({ kind: 'anime' })).toBe('أنمي');
    expect(mediaKind({ kind: 'manga' })).toBe('مانجا');
    expect(mediaKind({ kind: 'cinema', format: 'series', season: 2, episode: 3 })).toBe('مسلسل');
    expect(mediaKind({ kind: 'cinema', format: 'movie' })).toBe('فيلم');
    expect(mediaKind({ kind: 'cinema', episode: -1 })).toBe('فيلم');
    expect(episodeLine({ kind: 'cinema', format: 'series', season: 2, episode: 3 })).toBe('م2 · الحلقة 3');
    expect(episodeLine({ kind: 'anime', episode: 5 })).toBe('الحلقة 5');
    expect(episodeLine({ kind: 'cinema', format: 'movie' })).toBe('فيلم');
  });

  it('fills anime logo, episode still and title from ani.zip once', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ mappings: { imdb_id: 'tt22248376' }, episodes: { 5: { image: 'https://img/5.jpg', title: { en: 'Phantoms of the Dead' } } } }) }; };
    const media = { kind: 'anime', seriesRef: 'anime:154587', episode: 5, title: 'Frieren', cover: 'https://img/cover.jpg' };
    const a = await resolveArt(media, { fetchImpl });
    // بلا fanart: الخلفية صورة الحلقة احتياطًا، وصورة الحلقة نفسها لزر «البدء»
    expect(a).toEqual({ banner: 'https://img/5.jpg', episodeImage: 'https://img/5.jpg', logo: logoOfImdb('tt22248376'), title: 'Frieren', episodeTitle: 'Phantoms of the Dead' });
    await resolveArt(media, { fetchImpl });
    expect(calls).toBe(1);
  });

  it('room background is the series art (16:9 fanart); the episode still goes to the Start button', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ mappings: { imdb_id: 'tt0434665' }, images: [{ coverType: 'Fanart', url: 'https://img/fanart.jpg' }], episodes: { 1: { image: 'https://img/ep1.jpg', title: { en: 'A Shinigami is Born!' } } } }) });
    const a = await resolveArt({ kind: 'anime', seriesRef: 'anime:269', episode: 1, title: 'Bleach', banner: 'https://img/ep1-from-page.jpg' }, { fetchImpl });
    expect(a.banner).toBe('https://img/fanart.jpg');
    expect(a.episodeImage).toBe('https://img/ep1.jpg');
  });

  it('keeps what the invite sent and never guesses without data', async () => {
    const offline = async () => { throw new TypeError('offline'); };
    const a = await resolveArt({ kind: 'anime', seriesRef: 'anime:1', episode: 2, title: 'X', cover: 'c.jpg' }, { fetchImpl: offline });
    expect(a).toEqual({ banner: 'c.jpg', episodeImage: null, logo: null, title: 'X', episodeTitle: null });
    const b = await resolveArt({ kind: 'cinema', seriesRef: 'cinema:tt0903747:2', banner: 'b.jpg', logo: 'l.png', title: 'Breaking Bad' }, { fetchImpl: offline });
    expect(b.logo).toBe('l.png');
    const c = await resolveArt({ kind: 'cinema', seriesRef: 'cinema:tt0903747:2', title: 'Breaking Bad' }, { fetchImpl: offline });
    expect(c.logo).toBe(logoOfImdb('tt0903747'));
  });

  it('a new anime without IMDb in ani.zip: IMDb from Cinemeta by exact name + year, and the TVDB key art', async () => {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      if (url.startsWith('https://api.ani.zip/')) {
        return { ok: true, json: async () => ({
          titles: { en: 'A Tale of the Secret Saint', 'x-jat': 'Tensei Shita Daiseijo wa' },
          episodes: { 1: { airDate: '2026-10-03' } },
          images: [{ coverType: 'Fanart', url: 'https://artworks.thetvdb.com/fan.jpg' }, { coverType: 'Clearlogo', url: 'https://artworks.thetvdb.com/icon.png' }],
          mappings: { thetvdb_id: 461059 },
        }) };
      }
      return { ok: true, json: async () => ({ metas: [
        { id: 'tt36926665', name: 'The Bakersfield 3: A Tale of Murder', releaseInfo: '2025' },
        { id: 'tt38939893', name: 'A Tale of the Secret Saint', releaseInfo: '2026-' },
      ] }) };
    };
    const z = await aniZipArt(187402, { fetchImpl });
    expect(z.imdb).toBe('tt38939893');
    expect(z.fanart).toBe('https://artworks.thetvdb.com/fan.jpg');
    // «Clearlogo» في TVDB قد يكون أيقونة مربعة: لا يُعتمد
    expect(z.clearlogo).toBeUndefined();
    expect(urls).toContain('https://v3-cinemeta.strem.io/catalog/series/top/search=A%20Tale%20of%20the%20Secret%20Saint.json');
  });

  it('Cinemeta: no exact name and year → nothing (never the closest result)', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ metas: [
      { id: 'tt1', name: 'A Tale of the Secret Saint', releaseInfo: '2019' },
      { id: 'tt2', name: 'A Tale of the Secret Saints', releaseInfo: '2026' },
    ] }) });
    expect(await imdbFromCinemeta({ names: ['A Tale of the Secret Saint'], year: 2026 }, fetchImpl)).toBeNull();
  });

  const anilist = (media) => ({ ok: true, json: async () => ({ data: { Media: media } }) });
  const cinemeta = (metas) => ({ ok: true, json: async () => ({ metas }) });

  it('not in ani.zip at all (404): name and year from AniList, IMDb from Cinemeta', async () => {
    const fetchImpl = async (url) => {
      if (url.startsWith('https://api.ani.zip/')) return { ok: false, json: async () => ({}) };
      if (url.startsWith('https://graphql.anilist.co')) return anilist({ title: { english: 'Fool Night', romaji: 'Fool Night' }, format: 'TV', startDate: { year: 2026 }, relations: { edges: [] } });
      return cinemeta([{ id: 'tt43613803', name: 'Fool Night', releaseInfo: '2026-' }]);
    };
    const z = await aniZipArt(213457, { fetchImpl });
    expect(z.imdb).toBe('tt43613803');
  });

  it('a later season without IMDb takes its series art through the PREQUEL chain', async () => {
    const fetchImpl = async (url, init) => {
      if (url === 'https://api.ani.zip/mappings?anilist_id=900') return { ok: true, json: async () => ({ titles: { en: 'Gachiakuta Season 2' }, mappings: {}, episodes: {} }) };
      if (url === 'https://api.ani.zip/mappings?anilist_id=800') return { ok: true, json: async () => ({ mappings: { imdb_id: 'tt33092113' }, images: [{ coverType: 'Fanart', url: 'https://artworks.thetvdb.com/s1.jpg' }], episodes: {} }) };
      if (url.startsWith('https://graphql.anilist.co')) {
        const id = JSON.parse(init.body).variables.id;
        return anilist({ title: { english: 'Gachiakuta Season 2' }, format: 'TV', startDate: { year: 2026 }, relations: { edges: id === 900 ? [{ relationType: 'SEQUEL', node: { id: 901, type: 'ANIME' } }, { relationType: 'PREQUEL', node: { id: 800, type: 'ANIME' } }] : [] } });
      }
      return cinemeta([]);
    };
    const z = await aniZipArt(900, { fetchImpl });
    expect(z.imdb).toBe('tt33092113');
    expect(z.fanart).toBe('https://artworks.thetvdb.com/s1.jpg');
  });
});


describe('art request deadlines', () => {
  beforeEach(() => { globalThis.localStorage = memory(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('settles a stalled mapping request and retries rather than remembering missing art', async () => {
    let signal;
    let result;
    const pending = aniZipArt(98765001, { timeoutMs: 30, fetchImpl: (_url, opts) => {
      signal = opts?.signal;
      return new Promise(() => {});
    } });
    void pending.then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(35);
    expect(result).toBeNull();
    expect(signal?.aborted).toBe(true);
    const retry = await aniZipArt(98765001, { fetchImpl: async () => ({ ok: true, json: async () => ({ mappings: { imdb_id: 'tt123' }, episodes: {} }) }) });
    expect(retry?.imdb).toBe('tt123');
  });

  it('includes a stalled response body in the total art deadline', async () => {
    let result;
    void aniZipArt(98765002, { timeoutMs: 30, fetchImpl: async () => ({ ok: true, json: () => new Promise(() => {}) }) }).then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(35);
    expect(result).toBeNull();
    expect(globalThis.localStorage.getItem('vantara.tgart.az4-98765002')).toBeNull();
  });

  it('cancels every active parent/search request and never stores a cancelled mapping', async () => {
    const ctrl = new AbortController();
    const signals = [];
    const fetchImpl = async (url, opts) => {
      signals.push(opts?.signal);
      if (url.endsWith('anilist_id=98765003')) return { ok: true, json: async () => ({ titles: { en: 'Audit Show' }, mappings: {}, episodes: {} }) };
      if (url === 'https://graphql.anilist.co') return { ok: true, json: async () => ({ data: { Media: { title: { english: 'Audit Show' }, format: 'TV', startDate: { year: 2026 }, relations: { edges: [{ relationType: 'PREQUEL', node: { id: 98765004, type: 'ANIME' } }] } } } }) };
      return new Promise(() => {});
    };
    const result = aniZipArt(98765003, { fetchImpl, signal: ctrl.signal });
    await vi.advanceTimersByTimeAsync(1);
    expect(signals.length).toBeGreaterThan(3);
    ctrl.abort();
    expect(await result).toBeNull();
    expect(signals.every(signal => signal?.aborted)).toBe(true);
    expect(globalThis.localStorage.getItem('vantara.tgart.az4-98765003')).toBeNull();
  });
});

describe('independent subscribers of shared artwork', () => {
  beforeEach(() => { globalThis.localStorage = memory(); });
  const mapping = imdb => ({ ok: true, json: async () => ({ mappings: { imdb_id: imdb }, episodes: {} }) });

  it('cancelling the first subscriber leaves another subscriber and its network request alive', async () => {
    const first = new AbortController(), second = new AbortController();
    let reply, network;
    const fetchImpl = (_url, opts) => { network = opts.signal; return new Promise(resolve => { reply = resolve; }); };
    const a = aniZipArt(98765101, { fetchImpl, signal: first.signal });
    const b = aniZipArt(98765101, { fetchImpl, signal: second.signal });
    first.abort();
    expect(await a).toBeNull();
    expect(network.aborted).toBe(false);
    reply(mapping('tt98765101'));
    expect((await b)?.imdb).toBe('tt98765101');
  });

  it('honors a later subscriber cancellation without cancelling the first subscriber', async () => {
    const later = new AbortController();
    let reply, network;
    const fetchImpl = (_url, opts) => { network = opts.signal; return new Promise(resolve => { reply = resolve; }); };
    const a = aniZipArt(98765102, { fetchImpl });
    const b = aniZipArt(98765102, { fetchImpl, signal: later.signal });
    let cancelled;
    void b.then(value => { cancelled = value; });
    later.abort();
    await Promise.resolve();
    expect(cancelled).toBeNull();
    expect(network.aborted).toBe(false);
    reply(mapping('tt98765102'));
    expect((await a)?.imdb).toBe('tt98765102');
  });

  it('aborts shared network work only when every subscriber has cancelled, then allows retry', async () => {
    const first = new AbortController(), second = new AbortController();
    let network;
    const fetchImpl = (_url, opts) => { network = opts.signal; return new Promise(() => {}); };
    const a = aniZipArt(98765103, { fetchImpl, signal: first.signal });
    const b = aniZipArt(98765103, { fetchImpl, signal: second.signal });
    second.abort(); first.abort();
    expect(await a).toBeNull(); expect(await b).toBeNull();
    expect(network.aborted).toBe(true);
    expect((await aniZipArt(98765103, { fetchImpl: async () => mapping('tt98765103') }))?.imdb).toBe('tt98765103');
  });
});

it('an independently subscribed parent lookup survives cancellation of the detail graph that started it', async () => {
  globalThis.localStorage = memory();
  const ctrl = new AbortController();
  let parentReply, parentSignal;
  const fetchImpl = async (url, opts) => {
    if (url.endsWith('anilist_id=98765104')) return { ok: true, json: async () => ({ titles: { en: 'Audit sequel' }, mappings: {}, episodes: {} }) };
    if (url.endsWith('anilist_id=98765105')) {
      parentSignal = opts.signal;
      return new Promise(resolve => { parentReply = resolve; });
    }
    if (url === 'https://graphql.anilist.co') return { ok: true, json: async () => ({ data: { Media: { title: { english: 'Audit sequel' }, format: 'TV', startDate: { year: 2026 }, relations: { edges: [{ relationType: 'PREQUEL', node: { id: 98765105, type: 'ANIME' } }] } } } }) };
    return new Promise(() => {});
  };
  const detail = aniZipArt(98765104, { fetchImpl, signal: ctrl.signal });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(parentReply).toBeTypeOf('function');
  const room = aniZipArt(98765105, { fetchImpl });
  ctrl.abort();
  expect(await detail).toBeNull();
  expect(parentSignal.aborted).toBe(false);
  parentReply({ ok: true, json: async () => ({ mappings: { imdb_id: 'tt98765105' }, episodes: {} }) });
  expect((await room)?.imdb).toBe('tt98765105');
});
