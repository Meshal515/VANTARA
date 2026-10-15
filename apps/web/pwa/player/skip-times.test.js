import { beforeEach, describe, expect, it } from 'vitest';
import { activeSegment, loadSkipTimes, parseTimings } from './skip-times.js';

// نفس حالات IntroSkipTest.kt في الـAPK: السلوك متطابق.
const body = '{"found":true,"results":[{"skipType":"ed","interval":{"startTime":1300,"endTime":1380},"episodeLength":1440},{"skipType":"op","interval":{"startTime":90,"endTime":180},"episodeLength":1440}]}';

const memory = () => {
  const m = new Map();
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

describe('skip timings match the APK', () => {
  beforeEach(() => { globalThis.localStorage = memory(); });

  it('only offers the opening within the actual episode duration', () => {
    const { opening } = parseTimings(body, 1_440_000);
    expect(opening).toEqual({ startMs: 90_000, endMs: 180_000 });
    expect(activeSegment({ opening }, 89_999)).toBeNull();
    expect(activeSegment({ opening }, 90_000)?.opening).toBe(true);
    expect(activeSegment({ opening }, 179_000)).toBeNull();
  });

  it('a different cut or missing timing never skips guessed footage', () => {
    expect(parseTimings(body, 1_200_000).opening).toBeNull();
    expect(parseTimings('{"found":false,"results":[]}', 1_440_000).opening).toBeNull();
    expect(parseTimings('{"found":true,"results":[{"skipType":"op","interval":{"startTime":0,"endTime":1500}}]}', 1_440_000).opening).toBeNull();
    expect(parseTimings('not json', 1_440_000).opening).toBeNull();
    expect(parseTimings(body, 0).ending).toBeNull();
  });

  it('ending keeps post-credit scenes and mixed segments are supported', () => {
    const t = parseTimings(body.replace('"op"', '"mixed-op"').replace('"ed"', '"mixed-ed"'), 1_440_000);
    expect(t.opening).toEqual({ startMs: 90_000, endMs: 180_000 });
    expect(t.ending).toEqual({ startMs: 1_300_000, endMs: 1_380_000 });
    expect(activeSegment(t, 1_310_000).opening).toBe(false);
    expect(activeSegment(t, 1_380_000)).toBeNull();
    expect(activeSegment(t, 500_000)).toBeNull();
  });

  it('malformed fields never throw', () => {
    expect(parseTimings('{"found":{},"results":[]}', 1_440_000)).toEqual({ opening: null, ending: null });
    expect(parseTimings('{"found":true,"results":[null,{},{"skipType":"ed","episodeLength":{},"interval":{}}]}', 1_440_000)).toEqual({ opening: null, ending: null });
  });

  it('fetches v2 with mixed types, then caches', async () => {
    const urls = [];
    const fetchImpl = async (url) => { urls.push(url); return { status: 200, text: async () => body }; };
    const a = await loadSkipTimes({ malId: 16498, episode: 1, durationMs: 1_440_000, fetchImpl });
    expect(a.status).toBe('READY');
    expect(urls[0]).toContain('/v2/skip-times/16498/1?');
    expect(urls[0]).toContain('mixed-op');
    expect(urls[0]).toContain('episodeLength=1440');
    const b = await loadSkipTimes({ malId: 16498, episode: 1, durationMs: 1_440_000, fetchImpl });
    expect(b.cached).toBe(true);
    expect(urls).toHaveLength(1);
  });

  it('maps AniList to MAL through ani.zip, and reports honest failures', async () => {
    const fetchImpl = async (url) => url.includes('ani.zip')
      ? { status: 200, text: async () => '{"mappings":{"anilist_id":21,"mal_id":21}}' }
      : { status: 404, text: async () => '' };
    expect((await loadSkipTimes({ anilistId: 21, episode: 3, durationMs: 1_440_000, fetchImpl })).status).toBe('NOT_FOUND');
    expect((await loadSkipTimes({ episode: 3, durationMs: 1_440_000, fetchImpl })).status).toBe('MISSING_ID');
    expect((await loadSkipTimes({ malId: 5, episode: 3.5, durationMs: 1_440_000, fetchImpl })).status).toBe('SPECIAL');
    const down = async () => { throw new TypeError('offline'); };
    expect((await loadSkipTimes({ malId: 5, episode: 3, durationMs: 1_440_000, fetchImpl: down })).status).toBe('FAILED');
  });
});
