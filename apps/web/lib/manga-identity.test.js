/**
 * انحدار دائم لهوية المانجا: ZERO DUPLICATE / ZERO WRONG MERGE.
 *
 * الحالات حقيقية من تدقيق الكتالوج الحيّ (tools/pwa/manga-dedup.mjs، 2026-10):
 * Manga Starz يسمّي العمل «Magic emperor» وأسماؤه البديلة نصٌّ واحد بلا فاصل
 * («امبراطور السحر الامبراطور الشيطانى ديمونك امبرور Demonic Emperor»)، وTeam X
 * وMangaSwat يسمّيانه «Demonic Emperor». و3asq يسمّي «Shingeki no Kyojin» وبديله
 * «Attack On Titan»، وعنده «Attack on Titan no Requiem» عملٌ آخر بديله
 * «Attack on Titan Requiem».
 */
import { describe, expect, it } from 'vitest';
import { aliasEvidence, canonicalIndex, mirrorFamily, normalizeTitle } from './catalog.js';
import { aliasesFromText, splitNames } from './manga-aliases.js';

const entry = (sourceId, title) => ({ sourceId: `eu.kanade.tachiyomi.extension.ar.${sourceId}`, label: sourceId, manga: { url: `/${sourceId}/${title}`, title } });
const build = (entries, aliases) => {
  const index = canonicalIndex({ aliases: new Map(Object.entries(aliases ?? {})) });
  for (const e of entries) index.add(e);
  return index;
};
const titles = (index) => index.list().map((w) => [w.title, w.editions.map((e) => e.label).sort()]);

const MAGIC = { 'magic emperor': ['Magic emperor', 'امبراطور السحر الامبراطور الشيطانى ديمونك امبرور Demonic Emperor'] };

describe('same work, different names = one card', () => {
  it('Magic Emperor = Demonic Emperor, whichever source arrives first', () => {
    const forward = build([entry('mangastarz', 'Magic emperor'), entry('teamx', 'Demonic Emperor'), entry('mangaswat', 'Demonic Emperor')], MAGIC);
    const backward = build([entry('teamx', 'Demonic Emperor'), entry('mangaswat', 'Demonic Emperor'), entry('mangastarz', 'Magic emperor')], MAGIC);
    for (const index of [forward, backward]) {
      expect(index.list()).toHaveLength(1);
      const [work] = index.list();
      expect(work.key).toBe('magic emperor');
      expect(work.title).toBe('Magic emperor');
      expect(work.aliases).toContain('Demonic Emperor');
      expect(work.editions.map((e) => e.label).sort()).toEqual(['mangastarz', 'mangaswat', 'teamx']);
    }
  });

  it('Shingeki no Kyojin = Attack on Titan; Attack on Titan no Requiem stays its own work', () => {
    const index = build(
      [entry('manga3asq', 'Shingeki no Kyojin'), entry('mangadex', 'Attack on Titan'), entry('manga3asq', 'Attack on Titan no Requiem')],
      { 'shingeki no kyojin': ['Attack On Titan', 'Shingeki no Kyojin'], 'attack on titan no requiem': ['Attack on Titan Requiem'] },
    );
    expect(titles(index)).toEqual([
      ['Shingeki no Kyojin', ['manga3asq', 'mangadex']],
      ['Attack on Titan no Requiem', ['manga3asq']],
    ]);
    expect(index.rejected).toEqual([]);
  });

  it('scanlation team tags are not part of the name', () => {
    expect(normalizeTitle('(WAN) Blue Lock')).toBe(normalizeTitle('Blue Lock'));
    expect(normalizeTitle('Hajime No Ippo (BAKI)')).toBe(normalizeTitle('Hajime No Ippo'));
    expect(normalizeTitle('Kingdom (WAN)')).toBe('kingdom');
    expect(build([entry('manga3asq', '(WAN) Blue Lock'), entry('manhatok', 'Blue Lock')]).list()).toHaveLength(1);
  });

  it('Arabic spellings of one name fold together (ى/ي، إ/ا)', () => {
    expect(normalizeTitle('الإمبراطور الشيطاني')).toBe(normalizeTitle('الامبراطور الشيطانى'));
  });
});

describe('different works, similar names = separate cards', () => {
  it('a name inside a longer name of the same script is not evidence', () => {
    expect(aliasEvidence('attack on titan', ['Attack on Titan Requiem'])).toBeNull();
    expect(aliasEvidence('solo leveling', ['Solo Leveling: Ragnarok'])).toBeNull();
    // عند حدّ أبجدية مختلفة (نص بلا فواصل) يُقبل
    expect(aliasEvidence('demonic emperor', MAGIC['magic emperor'])).toMatch(/^⊂/);
  });

  it('one common word never merges anything', () => {
    expect(aliasEvidence('magic', ['Magic Emperor'])).toBeNull();
    expect(aliasEvidence('kingdom', ['Kingdom of Ash'])).toBeNull();
  });

  it('Solo Leveling and Solo Leveling: Ragnarok stay apart', () => {
    const index = build([entry('mangalek', 'Solo Leveling'), entry('teamx', 'Solo Leveling: Ragnarok')], { 'solo leveling': ['Na Honjaman Level Up', 'I Level Up Alone'] });
    expect(titles(index)).toEqual([
      ['Solo Leveling', ['mangalek']],
      ['Solo Leveling: Ragnarok', ['teamx']],
    ]);
  });

  it('an alias claimed by two works is ambiguous: rejected, never merged', () => {
    const index = build(
      [entry('a', 'Return of the Hero'), entry('b', 'The Hero King'), entry('c', 'Hero Returns')],
      { 'return of hero': ['Hero Returns'], 'hero king': ['Hero Returns'] },
    );
    expect(index.list()).toHaveLength(3);
    expect(index.rejected).toHaveLength(1);
  });
});

describe('aliases from sources', () => {
  it('splits clean lists and drops placeholders', () => {
    expect(splitNames('Demonic Emperor, Mo Huang Da Guan Jia ، الإمبراطور الشيطاني | -')).toEqual(['Demonic Emperor', 'Mo Huang Da Guan Jia', 'الإمبراطور الشيطاني']);
    expect(splitNames('N/A')).toEqual([]);
  });
  it('APK extensions put them in the description', () => {
    expect(aliasesFromText('قصة الإمبراطور…\n\nAlternative Names: Magic Emperor, Mo Huang Da Guan Jia')).toEqual(['Magic Emperor', 'Mo Huang Da Guan Jia']);
    expect(aliasesFromText('الأسماء البديلة: الإمبراطور الشيطاني')).toEqual(['الإمبراطور الشيطاني']);
  });
  it('the five Mangalek domains are one source', () => {
    for (const s of ['mangalek', 'mangastarz', 'mangaspark', 'mangalink', 'mangalionz']) expect(mirrorFamily(`eu.kanade.tachiyomi.extension.ar.${s}`)).toBe('mangalek');
  });
});
