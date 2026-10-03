/**
 * مرايا موقع واحد، وسبب الفشل الحقيقي بدل «ما ردّ الآن».
 *
 * Mangalek وMangaSpark وManga Link وMangaLionz نطاقات لقاعدة بيانات واحدة
 * (نفس أرقام المنشورات والفصول). صفحة العمل تسأل الموقع مرة واحدة، والمرايا
 * بدائل إن لم يرد؛ والمصدر الذي فشل يقول لماذا: مهلة، أو خطأ برقمه، أو 404.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/extension-engine.js', () => ({
  default: { series: vi.fn(), chapters: vi.fn(), sources: vi.fn(async () => []) },
}));

import engine from '../lib/extension-engine.js';
import { collapseMirrors, detail, failureOf, mirrorFamily, resetSources } from './works.js';

const pkg = (slug) => `eu.kanade.tachiyomi.extension.ar.${slug}`;
const edition = (slug, label) => ({ sourceId: pkg(slug), label, manga: { url: '169439', title: 'Solo Leveling' } });
const ch = (n) => ({ url: `/c/${n}`, name: `الفصل ${n}`, chapter_number: n });
const work = (editions) => ({ id: 'ext:solo', _work: { key: 'solo', title: 'Solo Leveling', editions } });

beforeEach(() => {
  engine.series.mockReset();
  engine.chapters.mockReset();
  engine.sources.mockReset();
  engine.sources.mockResolvedValue([]);
  resetSources();
});

describe('mirror families', () => {
  it('the four Mangalek domains are one family; others are themselves', () => {
    for (const s of ['mangalek', 'mangaspark', 'mangalink', 'mangalionz']) expect(mirrorFamily(pkg(s))).toBe('mangalek');
    expect(mirrorFamily(pkg('teamx'))).toBe(pkg('teamx'));
  });

  it('asks the site once, not four times', async () => {
    engine.series.mockResolvedValue({ manga: { title: 'Solo Leveling' }, chapters: [ch(1), ch(2)] });
    engine.chapters.mockResolvedValue([ch(1)]);
    const out = await detail(work([edition('mangalek', 'Mangalek'), edition('mangaspark', 'MangaSpark'), edition('mangalink', 'Manga Link'), edition('mangalionz', 'MangaLionz'), edition('teamx', 'Team X')]));
    expect(engine.series).toHaveBeenCalledTimes(1);
    expect(engine.chapters).toHaveBeenCalledTimes(1);
    expect(engine.chapters.mock.calls[0][0]).toBe(pkg('teamx'));
    expect(out._failedSources).toEqual([]);
  });

  it('falls back to the next mirror when the first does not answer', async () => {
    engine.series.mockImplementation(async (sourceId) => {
      if (sourceId === pkg('mangalek')) throw new Error('لم يرد خلال 25 ثانية');
      return { manga: { title: 'Solo Leveling' }, chapters: [ch(1), ch(2), ch(3)] };
    });
    const out = await detail(work([edition('mangalek', 'Mangalek'), edition('mangaspark', 'MangaSpark')]));
    expect(engine.series).toHaveBeenCalledTimes(2);
    expect(out._chapters).toHaveLength(3);
    expect(out._failedSources).toEqual([]);
  });

  it('a failed source carries its real reason', async () => {
    engine.series.mockResolvedValue({ manga: { title: 'x' }, chapters: [ch(1)] });
    engine.chapters.mockImplementation(async (sourceId) => {
      if (sourceId === pkg('teamx')) throw new Error('HTTP 403 https://olympustaff.com/series/solo');
      throw new Error('timeout after 20000ms');
    });
    const out = await detail(work([edition('mangastarz', 'Manga Starz'), edition('teamx', 'Team X'), edition('azora', 'Azora')]));
    expect(out._failedSources).toEqual([
      { sourceId: pkg('teamx'), label: 'Team X', state: 'SOURCE_ERROR', reason: 'ردّ بخطأ 403' },
      { sourceId: pkg('azora'), label: 'Azora', state: 'SOURCE_TIMEOUT', reason: 'لم يرد في الوقت' },
    ]);
  });
});

describe('listings ask one mirror', () => {
  it('one source per family, Mangalek first', () => {
    const list = ['teamx', 'mangastarz', 'mangalionz', 'mangalek', 'azora'].map((s) => ({ id: pkg(s), label: s }));
    expect(collapseMirrors(list).map((s) => s.label)).toEqual(['teamx', 'mangalek', 'azora']);
    expect(collapseMirrors(list.filter((s) => s.label !== 'mangalek')).map((s) => s.label)).toEqual(['teamx', 'mangastarz', 'azora']);
  });

  it('details fall back to an installed mirror that was not in the listing', async () => {
    engine.sources.mockResolvedValue([{ id: pkg('mangalek'), label: 'Mangalek' }, { id: pkg('mangastarz'), label: 'Manga Starz' }]);
    engine.series.mockImplementation(async (sourceId) => {
      if (sourceId === pkg('mangalek')) throw new Error('timeout');
      return { manga: { title: 'Solo Leveling' }, chapters: [ch(1), ch(2)] };
    });
    const out = await detail(work([edition('mangalek', 'Mangalek')]));
    expect(engine.series.mock.calls.map((c) => c[0])).toEqual([pkg('mangalek'), pkg('mangastarz')]);
    expect(out._chapters).toHaveLength(2);
    expect(out._failedSources).toEqual([]);
  });
});

describe('failure reasons', () => {
  it('timeout, http status, 404, Cloudflare, anything else', () => {
    expect(failureOf(new Error('timeout'))).toEqual({ state: 'SOURCE_TIMEOUT', reason: 'لم يرد في الوقت' });
    expect(failureOf(new Error('HTTP 404 /manga/x'))).toMatchObject({ state: 'SOURCE_ERROR', reason: 'العمل غير موجود فيه (404)' });
    expect(failureOf(new Error('HTTP 503'))).toMatchObject({ reason: 'ردّ بخطأ 503' });
    expect(failureOf(new Error('Cloudflare challenge'))).toMatchObject({ reason: 'حماية Cloudflare' });
    expect(failureOf(new Error('Unexpected token < in JSON'))).toMatchObject({ state: 'SOURCE_ERROR', reason: 'Unexpected token < in JSON' });
  });
});
