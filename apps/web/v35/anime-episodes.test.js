import { describe, expect, it } from 'vitest';
import { episodeCount, episodePage, normalizeEpisodeRange, resumeEpisode } from './anime-episodes.js';

describe('shared episode pages', () => {
  it.each([12, 25, 26, 148, 400, 1000, 1180])('keeps every episode reachable with a bounded page for %i episodes', (total) => {
    for (const pageSize of [25, 50]) {
      const first = episodePage({ total, pageSize });
      const all = first.groups.flatMap(({ index }) => {
        const page = episodePage({ total, pageSize, pageIndex: index });
        expect(page.numbers.length).toBeLessThanOrEqual(pageSize);
        return page.numbers;
      });
      expect(all).toEqual(Array.from({ length: total }, (_, i) => i + 1));
      expect(first.pageCount).toBe(Math.ceil(total / pageSize));
    }
  });

  it('filters watched episodes before pagination and globally orders descending', () => {
    const opts = { total: 148, pageSize: 25, newestFirst: true, hideSeen: true, isSeen: n => n < 100 };
    const page = episodePage(opts);
    expect(page.numbers).toEqual(Array.from({ length: 25 }, (_, i) => 148 - i));
    expect(page.groups).toEqual([
      { index: 0, from: 124, to: 148, count: 25, label: '124–148' },
      { index: 1, from: 100, to: 123, count: 24, label: '100–123' },
    ]);
    expect(episodePage({ ...opts, pageIndex: 999 }).numbers).toHaveLength(24);
    expect(episodePage({ total: 148, hideSeen: true, isSeen: () => true }).groups).toEqual([]);
  });

  it('bounds broad title searches and finds an exact number in Arabic or Persian digits', () => {
    const opts = { total: 1180, titleOf: n => n === 148 ? 'A Special Meeting' : 'One Piece' };
    expect(episodePage({ ...opts, query: 'PIECE' }).numbers).toHaveLength(25);
    expect(episodePage({ ...opts, query: ' special ' }).numbers).toEqual([148]);
    for (const query of ['148', '١٤٨', '۱۴۸']) expect(episodePage({ ...opts, query }).numbers).toEqual([148]);
    expect(episodePage({ ...opts, query: '1181' }).numbers).toEqual([]);
    expect(episodePage({ ...opts, query: '148', hideSeen: true, isSeen: () => true }).numbers).toEqual([]);
  });

  it('selects the current episode group only when no explicit group was chosen', () => {
    expect(episodePage({ total: 400, currentEpisode: 148 }).pageIndex).toBe(5);
    expect(episodePage({ total: 400, currentEpisode: 148, pageIndex: 0 }).pageIndex).toBe(0);
    expect(episodePage({ total: 400, pageIndex: -1 }).pageIndex).toBe(0);
    expect(episodePage({ total: 0 }).pageIndex).toBe(0);
    expect(episodePage({ total: NaN, pageSize: 0 }).numbers).toEqual([]);
  });
});

describe('available episode counts and mark ranges', () => {
  it('excludes movies and future unaired episodes', () => {
    expect(episodeCount({ format: 'MOVIE', episodes: 1 })).toBe(0);
    expect(episodeCount({ status: 'NOT_YET_RELEASED', episodes: 24 })).toBe(0);
    expect(episodeCount({ status: 'RELEASING', episodes: 24, aired: 12 })).toBe(12);
    expect(episodeCount({ status: 'RELEASING', episodes: 24, aired: 0, next: { episode: 1 } })).toBe(0);
    expect(episodeCount({ status: 'FINISHED', episodes: 12, aired: 0 })).toBe(12);
    expect(episodeCount({ episodes: 1180 })).toBe(1180);
  });

  it('bounds and normalizes reversed mark ranges', () => {
    expect(normalizeEpisodeRange(200, -3, 148)).toEqual({ from: 1, to: 148, count: 148 });
    expect(normalizeEpisodeRange('١٢', '٥', 26)).toEqual({ from: 5, to: 12, count: 8 });
    expect(normalizeEpisodeRange(1, 12, 0)).toEqual({ from: 0, to: 0, count: 0 });
  });
});

describe('resume from actual playback', () => {
  const m = { episodes: 12, status: 'FINISHED' };
  const partial = { position: 10000, duration: 100000, at: 10, done: false };
  const done = { position: 100000, duration: 100000, at: 20, done: true };
  const manual = { position: 0, duration: 0, at: 30, done: true };

  it('resumes the explicitly last started episode despite skipped earlier episodes or newer record timestamps', () => {
    const point = resumeEpisode({ m, watch: { episode: 10, episodes: { 2: { ...partial, at: 100 }, 10: partial } } });
    expect(point).toMatchObject({ episode: 10, resume: true, completed: false, replay: false, record: partial });
  });

  it('recovers a legacy manually advanced pointer from the latest credible playback', () => {
    expect(resumeEpisode({ m, watch: { episode: 12, episodes: { 2: partial, 10: { ...partial, at: 20 }, 12: manual } } })).toMatchObject({ episode: 10, resume: true });
    expect(resumeEpisode({ m, watch: { episode: 12, episodes: { 12: manual } } })).toMatchObject({ episode: 1, resume: false });
  });

  it('continues after manually acknowledged earlier episodes without creating a playback record', () => {
    const watch=Object.freeze({episodes:Object.freeze({1:Object.freeze({...manual})})});
    expect(resumeEpisode({m,watch})).toEqual({episode:2,resume:true,completed:false,replay:false});
    expect(resumeEpisode({m,watch:{episodes:{10:manual}}})).toEqual({episode:1,resume:false,completed:false,replay:false});
  });

  it('honors playback in the initial detail shell when episode totals have not loaded', () => {
    const record = Object.freeze({ ...partial });
    const watch = Object.freeze({ episode: 10, total: 12, episodes: Object.freeze({ 10: record }) });
    const point = resumeEpisode({ m: Object.freeze({ id: 1 }), watch });
    expect(point).toMatchObject({ episode: 10, resume: true });
    expect(point.record).toBe(record);
    expect(record).toMatchObject({ position: 10000, duration: 100000, at: 10, done: false });
    expect(resumeEpisode({ m: { id: 1 }, watch: { ...watch, total: null } })).toMatchObject({ episode: 10, resume: true });
    expect(resumeEpisode({ m: { id: 1 }, watch: { episode: 12, episodes: { 2: partial, 10: { ...partial, at: 20 }, 12: manual } } })).toMatchObject({ episode: 10, resume: true });
    expect(resumeEpisode({ m: { status: 'NOT_YET_RELEASED' }, watch })).toMatchObject({ episode: 1, resume: false });
    expect(resumeEpisode({ m: { status: 'RELEASING', aired: 0 }, watch })).toMatchObject({ episode: 1, resume: false });
  });

  it('advances after a completed episode, then wraps to earlier unseen episodes only when necessary', () => {
    expect(resumeEpisode({ m, watch: { episode: 10, episodes: { 10: done, 11: manual } } })).toMatchObject({ episode: 12, resume: true });
    expect(resumeEpisode({ m, watch: { episode: 12, episodes: { 12: done } } })).toMatchObject({ episode: 1, resume: true, completed: false });
  });

  it('uses authoritative account marks, including clearing a locally completed episode', () => {
    expect(resumeEpisode({ m, watch: { episode: 10, episodes: { 10: done } }, isSeen: () => false })).toMatchObject({ episode: 10, resume: true, record: done });
    expect(resumeEpisode({ m, watch: { episode: 10, episodes: { 10: partial } }, isSeen: () => true })).toMatchObject({ episode: 1, resume: false, completed: true, replay: true });
  });

  it('makes completion an explicit replay and ignores marks outside the available episode range', () => {
    expect(resumeEpisode({ m, isSeen: () => true })).toMatchObject({ episode: 1, resume: false, completed: true, replay: true });
    expect(resumeEpisode({ m, watch: { episode: 100, episodes: { 100: done } } })).toMatchObject({ episode: 1, resume: false, completed: false });
  });

  it('does not call an airing series completed when all currently available episodes are seen', () => {
    expect(resumeEpisode({ m: { ...m, status: 'RELEASING', aired: 6, next: { episode: 7 } }, watch: { episode: 6, episodes: { 6: done } }, isSeen: () => true })).toMatchObject({ episode: 6, completed: false, replay: true, resume: false });
  });

  it('treats a movie as one playback unit without inventing an episode list', () => {
    const movie = { format: 'MOVIE', episodes: 1, status: 'FINISHED' };
    expect(resumeEpisode({ m: movie, watch: { episode: 1, episodes: { 1: partial } } })).toMatchObject({ episode: 1, resume: true });
    expect(resumeEpisode({ m: movie, watch: { episode: 1, episodes: { 1: done } } })).toMatchObject({ episode: 1, replay: true, completed: true, resume: false });
  });
});

// #323 U-02: MOVIE بعدة حلقات ليس فيلمًا واحدًا
import { isSingleMovie } from './anime-episodes.js';
describe('MOVIE format with several episodes', () => {
  it('only a one-episode (or unknown) MOVIE is a single film', () => {
    expect(isSingleMovie({ format: 'MOVIE', episodes: 1 })).toBe(true);
    expect(isSingleMovie({ format: 'MOVIE' })).toBe(true);
    expect(isSingleMovie({ format: 'MOVIE', episodes: 8 })).toBe(false);
    expect(isSingleMovie({ format: 'TV', episodes: 1 })).toBe(false);
  });
  it('a multi-episode MOVIE gets its episode list', () => {
    expect(episodeCount({ format: 'MOVIE', episodes: 8, status: 'FINISHED' })).toBe(8);
    expect(episodeCount({ format: 'MOVIE', episodes: 1, status: 'FINISHED' })).toBe(0);
  });
});
