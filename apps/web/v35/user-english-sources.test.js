/**
 * UE10 (تدقيق Stable 0.0.222، §15) ثم سياسة المصادر (قرار المالك، 22 نوفمبر، يحلّ محل قرار 16 نوفمبر):
 * الإضافة الأجنبية الآمنة للبحث المقصود وحده (بعد حكم AniList بنظافة العمل)، لا للرئيسية ولا «آخر التحديثات».
 * والمختلطة لا تُسأل عن قائمة ولا بحث أبدًا.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/extension-engine.js', () => ({
  default: { sources: vi.fn(), popular: vi.fn(), catalogue: vi.fn(), chapters: vi.fn(), search: vi.fn(), series: vi.fn(), latest: vi.fn(), isAvailable: () => true },
}));

vi.mock('../lib/manga-meta.js', async (original) => ({
  ...(await original()),
  fetchMangaMatches: vi.fn(async (titles) => new Map(titles.map((t) => [t, { verdict: VERDICTS[t] ?? 'unknown' }]))),
}));
const VERDICTS = { Vagabond: 'clean', 'Secret Taste.Zip': 'adult' };

import engine from '../lib/extension-engine.js';
import { _resetVerdicts } from '../lib/manga-verdict.js';
import { browse, resetSources } from './works.js';

const EN = 'eu.kanade.tachiyomi.extension.en.mangasee@en';
const AR = 'eu.kanade.tachiyomi.extension.ar.teamx';
const page = (titles) => ({ mangas: titles.map((t, i) => ({ title: t, url: `/m/${i}-${t}`, thumbnailUrl: `https://img/${i}.jpg` })), hasNextPage: false });

beforeEach(() => {
  resetSources();
  _resetVerdicts();
  vi.mocked(engine.search).mockReset();
  vi.mocked(engine.popular).mockReset();
  vi.mocked(engine.catalogue).mockReset();
});

describe('user-installed non-Arabic extensions', () => {
  it('a work found only in an English extension appears in search', async () => {
    vi.mocked(engine.sources).mockResolvedValue([
      { id: AR, label: 'Team X', lang: 'ar' },
      { id: EN, label: 'MangaSee', lang: 'en', filler: true, user: true, warning: 'SAFE' },
    ]);
    vi.mocked(engine.search).mockImplementation(async (id) => (id === EN ? page(['Vagabond']) : page([])));
    const { items } = await browse({ query: 'Vagabond' });
    const vagabond = items.find((w) => (w.title?.english ?? w.title) === 'Vagabond');
    expect(vagabond).toBeTruthy();
    expect(vagabond.foreignLang).toBe('إنجليزي');
  });

  it('a foreign work AniList does not know, or rates adult, never shows in search (unknown is not shown)', async () => {
    vi.mocked(engine.sources).mockResolvedValue([{ id: EN, label: 'MangaFire', lang: 'en', user: true, warning: 'SAFE' }]);
    vi.mocked(engine.search).mockResolvedValue(page(['Secret Taste.Zip', 'Unheard Of Work']));
    const { items } = await browse({ query: 'secret' });
    expect(items).toEqual([]);
  });

  it('owner decision (22 Nov): English extensions never build the home lists, even for an English-only account', async () => {
    vi.mocked(engine.sources).mockResolvedValue([
      { id: AR, label: 'Team X', lang: 'ar' },
      { id: EN, label: 'MangaSee', lang: 'en', filler: true, user: true, warning: 'SAFE' },
    ]);
    vi.mocked(engine.popular).mockImplementation(async (id) => (id === EN ? page(['Monster']) : page(['Solo Leveling'])));
    vi.mocked(engine.catalogue).mockImplementation(async (id) => (id === EN ? page(['Monster']) : page(['Solo Leveling'])));
    const { items } = await browse({ kind: 'popular' });
    expect(items.map((w) => w.title?.english ?? w.title)).toEqual(['Solo Leveling']);
    expect(vi.mocked(engine.popular).mock.calls.some(([id]) => id === EN)).toBe(false);
  });

  it('a mixed extension (MIXED in its repository, Arabic or not) is never listed nor searched', async () => {
    const MIXED_AR = 'eu.kanade.tachiyomi.extension.ar.mixedsite';
    const MIXED_EN = 'eu.kanade.tachiyomi.extension.all.mangadex@en';
    vi.mocked(engine.sources).mockResolvedValue([
      { id: AR, label: 'Team X', lang: 'ar' },
      { id: MIXED_AR, label: 'Mixed AR', lang: 'ar', user: true, warning: 'MIXED' },
      { id: MIXED_EN, label: 'MangaDex', lang: 'en', filler: true, warning: 'MIXED' },
    ]);
    vi.mocked(engine.search).mockResolvedValue(page(['Vagabond']));
    vi.mocked(engine.popular).mockResolvedValue(page(['Solo Leveling']));
    await browse({ query: 'Vagabond' });
    await browse({ kind: 'popular' });
    const asked = [...vi.mocked(engine.search).mock.calls, ...vi.mocked(engine.popular).mock.calls].map(([id]) => id);
    expect(asked).not.toContain(MIXED_AR);
    expect(asked).not.toContain(MIXED_EN);
  });

  it('an installed extension with no declared rating is treated as mixed until its rating is known', async () => {
    vi.mocked(engine.sources).mockResolvedValue([{ id: `${EN}#1`, label: 'Unrated', lang: 'en', user: true }]);
    vi.mocked(engine.search).mockResolvedValue(page(['Vagabond']));
    const { items } = await browse({ query: 'Vagabond' });
    expect(items).toEqual([]);
    expect(vi.mocked(engine.search)).not.toHaveBeenCalled();
  });

  it('chapter rows from a foreign source say their language honestly', async () => {
    const { localizeFiller, foreignLangName } = await import('./works.js');
    const rows = localizeFiller([{ sourceId: 'eu.kanade.tachiyomi.extension.ja.rawkuma@ja', number: 3, chapter: { name: 'Ch 3' } }, { sourceId: AR, number: 2, chapter: { name: 'الفصل 2' } }]);
    expect(rows[0].langLabel).toBe('ياباني');
    expect(rows[1].langLabel).toBeUndefined();
    expect(foreignLangName('x.extension.pt-br.y@pt-br')).toBe('برازيلي');
    expect(foreignLangName(AR)).toBeNull();
  });
});
