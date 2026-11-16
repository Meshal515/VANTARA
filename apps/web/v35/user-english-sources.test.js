/**
 * UE10 (تدقيق Stable 0.0.222، §15): إضافة Mihon غير عربية ثبّتها المستخدم تُعلَّم «تكملة»، فكان عمل كل نسخه منها
 * لا يظهر أبدًا ولا حتى في البحث، وحساب بإضافات إنجليزية فقط يرى قائمة فارغة.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/extension-engine.js', () => ({
  default: { sources: vi.fn(), popular: vi.fn(), catalogue: vi.fn(), chapters: vi.fn(), search: vi.fn(), series: vi.fn(), latest: vi.fn(), isAvailable: () => true },
}));

import engine from '../lib/extension-engine.js';
import { browse, resetSources } from './works.js';

const EN = 'eu.kanade.tachiyomi.extension.en.mangasee@en';
const AR = 'eu.kanade.tachiyomi.extension.ar.teamx';
const page = (titles) => ({ mangas: titles.map((t, i) => ({ title: t, url: `/m/${i}-${t}`, thumbnailUrl: `https://img/${i}.jpg` })), hasNextPage: false });

beforeEach(() => {
  resetSources();
  vi.mocked(engine.search).mockReset();
  vi.mocked(engine.popular).mockReset();
  vi.mocked(engine.catalogue).mockReset();
});

describe('user-installed non-Arabic extensions', () => {
  it('a work found only in an English extension appears in search', async () => {
    vi.mocked(engine.sources).mockResolvedValue([
      { id: AR, label: 'Team X', lang: 'ar' },
      { id: EN, label: 'MangaSee', lang: 'en', filler: true, user: true },
    ]);
    vi.mocked(engine.search).mockImplementation(async (id) => (id === EN ? page(['Vagabond']) : page([])));
    const { items } = await browse({ query: 'Vagabond' });
    expect(items.map((w) => w.title?.english ?? w.title)).toContain('Vagabond');
  });

  it('an account with English extensions only still gets a catalogue', async () => {
    vi.mocked(engine.sources).mockResolvedValue([{ id: EN, label: 'MangaSee', lang: 'en', filler: true, user: true }]);
    vi.mocked(engine.popular).mockResolvedValue(page(['Berserk', 'Monster']));
    vi.mocked(engine.catalogue).mockResolvedValue(page(['Berserk', 'Monster']));
    const { items } = await browse({ kind: 'popular' });
    expect(items.length).toBe(2);
  });

  it('owner decision: English works appear in the popular list too, labelled; Arabic works carry no label', async () => {
    vi.mocked(engine.sources).mockResolvedValue([
      { id: AR, label: 'Team X', lang: 'ar' },
      { id: EN, label: 'MangaSee', lang: 'en', filler: true, user: true },
    ]);
    vi.mocked(engine.popular).mockImplementation(async (id) => (id === EN ? page(['Monster']) : page(['Solo Leveling'])));
    const { items } = await browse({ kind: 'popular' });
    const byTitle = new Map(items.map((w) => [w.title?.english ?? w.title, w]));
    expect(byTitle.get('Solo Leveling').foreignLang).toBeNull();
    expect(byTitle.get('Monster').foreignLang).toBe('إنجليزي');
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
