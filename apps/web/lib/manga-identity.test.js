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
import { aliasEvidence, canonicalIndex, mirrorFamily, normalizeTitle, slugName, titleTwins } from './catalog.js';
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
  it('a name the site cut short («Mach…») is not a name', () => {
    expect(splitNames('The Regressed Mercenary’s Mach…')).toEqual([]);
    expect(splitNames('Solo Lev..., Na Honjaman Level Up')).toEqual(['Na Honjaman Level Up']);
  });
});

// ───── الحالة الحقيقية (2026-10): عمل واحد في أربع بطاقات ─────
// «The Regressed Mercenary’s Machinations» (Mangalek وعائلته بفاصلة منحنية، MangaSwat
// بمستقيمة)، و«…Machination» بلا s عند Team X، و«المرتزق العائد لديه خطة» عند مانجا
// تايم (رابطه the-regressed-mercenarys-machinations)، و«Hoegwihan Yongbyeong-eun Da
// Gyehoek-i Itda» عند MangaDex (أسماؤه البديلة في القائمة نفسها، ولا فصل عربي متاح).
const ar = (slug, title, extra = {}) => ({ sourceId: `eu.kanade.tachiyomi.extension.ar.${slug}`, label: slug, manga: { title, ...extra } });
const dexEntry = (title, id, altNames) => ({ sourceId: 'eu.kanade.tachiyomi.extension.all.mangadex', label: 'mangadex', manga: { title, url: `/manga/${id}`, altNames } });
const MERCENARY = [
  ar('mangalek', 'The Regressed Mercenary’s Machinations', { url: '130829', memo: '{"path":"/manga/the-regressed-mercenarys-machinations/"}' }),
  ar('mangastarz', 'The Regressed Mercenary’s Machinations', { url: '130829' }),
  ar('mangaswat', "The Regressed Mercenary's Machinations", { url: '1702288' }),
  ar('teamx', "The Regressed Mercenary's Machination", { url: '/series/the-regressed-mercenarys-mach' }),
  ar('mangatime', 'المرتزق العائد لديه خطة', { url: '/manhwa/the-regressed-mercenarys-machinations#6aaea1e97ecb87d76e4bf76b' }),
  dexEntry('Hoegwihan Yongbyeong-eun Da Gyehoek-i Itda', '53f1ec5e-058b-4d18-a23b-2a7dbca5669f', [
    '회귀한 용병은 다 계획이 있다',
    'The Regressed Mercenary Has a Plan',
    "The Regressed Mercenary's Machinations",
    'Every Returned Mercenary Has a Plan',
    '逆行傭兵は全て計画済み',
  ]),
];
const permutations = (list) => (list.length <= 1 ? [list] : list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p])));
const MERCENARY_KEY = normalizeTitle('The Regressed Mercenary’s Machinations');

describe('The Regressed Mercenary: four cards become one', () => {
  it("curly ’ and straight ' are the same name", () => {
    expect(normalizeTitle('The Regressed Mercenary’s Machinations')).toBe(normalizeTitle("The Regressed Mercenary's Machinations"));
  });

  it('all six editions are one work, in every arrival order', () => {
    const keys = new Set();
    // 720 ترتيبًا: النتيجة لا تتبع أيّ مصدر ردّ أولًا
    for (const order of permutations(MERCENARY)) {
      const index = build(order);
      const works = index.list();
      expect(works).toHaveLength(1);
      expect(works[0].editions).toHaveLength(6);
      expect(index.rejected).toEqual([]);
      keys.add(works[0].key);
    }
    // مفتاح ثابت: الاسم الذي تحمله المصادر وتشير إليه البقية، لا الروماجي
    expect([...keys]).toEqual([MERCENARY_KEY]);
  });

  it('each variant joins on its own evidence', () => {
    const [lek, , , teamx, mangatime, mangadex] = MERCENARY;
    expect(build([lek, teamx]).list()).toHaveLength(1); // مفرد/جمع في عنوان طويل
    expect(build([lek, mangatime]).list()).toHaveLength(1); // رابط مانجا تايم
    expect(build([lek, mangadex]).list()).toHaveLength(1); // أسماء MangaDex البديلة
    expect(build([teamx, mangadex]).list()).toHaveLength(1);
    expect(build([mangatime, teamx]).list()).toHaveLength(1);
  });

  it('the old reference of a merged card reads with the canonical one', () => {
    const index = build(MERCENARY);
    expect(index.canonicalOf('المرتزق العائد لديه خطة')).toBe(MERCENARY_KEY);
    expect(index.canonicalOf('Hoegwihan Yongbyeong-eun Da Gyehoek-i Itda')).toBe(MERCENARY_KEY);
    expect(index.canonicalOf("The Regressed Mercenary's Machination")).toBe(MERCENARY_KEY);
  });
});

describe('looser matching never merges namesakes', () => {
  it('singular/plural needs a long Latin title (three distinctive words)', () => {
    expect(titleTwins('The Witch', 'The Witches')).toBe(false);
    expect(titleTwins('Solo Leveling', 'Solo Levelings')).toBe(false);
    expect(titleTwins('The Regressed Mercenary’s Machinations', "The Regressed Mercenary's Machination")).toBe(true);
    expect(build([entry('mangalek', 'The Witch'), entry('teamx', 'The Witches')]).list()).toHaveLength(2);
  });

  it('season and part numbers keep works apart', () => {
    expect(titleTwins('Tower of God Season 2', 'Tower of God Season 3')).toBe(false);
    expect(build([entry('mangalek', 'Tower of God Season 2'), entry('teamx', 'Tower of God Season 3')]).list()).toHaveLength(2);
    expect(build([entry('mangalek', 'Solo Leveling'), entry('teamx', 'Solo Leveling: Ragnarok')]).list()).toHaveLength(2);
  });

  it('a source listing both names as two works means two works', () => {
    const index = build([
      entry('teamx', 'The Regressed Mercenary’s Machinations'),
      entry('teamx', "The Regressed Mercenary's Machination"),
      entry('mangaswat', 'The Regressed Mercenary Machinations'),
    ]);
    expect(index.list()).toHaveLength(2);
    expect(index.rejected.length).toBeGreaterThan(0);
  });

  it('a link slug is evidence only when whole, specific, and for a non-Latin title', () => {
    expect(slugName({ title: 'المرتزق العائد لديه خطة', url: '/manhwa/the-regressed-mercenarys-machinations#6aae' })).toBe('the regressed mercenarys machinations');
    expect(slugName({ title: 'سولو ليفلنج', url: '/manhwa/solo-leveling#1' })).toBeNull(); // كلمتان: عام
    expect(slugName({ title: 'The Regressed', url: '/series/the-regressed-mercenarys-mach' })).toBeNull(); // عنوان لاتيني
    expect(slugName({ title: 'مانجا', url: '/manga/53f1ec5e-058b-4d18-a23b-2a7dbca5669f' })).toBeNull(); // معرّف لا اسم
    // رابط يكمل اسمًا آخر لا يُقبل داخله: Ragnarok ليس Solo Leveling
    const index = build([entry('mangalek', 'Solo Leveling'), ar('mangatime', 'سولو ليفلنج راغناروك', { url: '/manhwa/solo-leveling-ragnarok#9' })]);
    expect(index.list()).toHaveLength(2);
  });

  it('a source edition pointing at two different works is ambiguous: rejected', () => {
    const dex = dexEntry('Na Honjaman Level Up', 'x', ['Solo Leveling', 'Solo Leveling: Ragnarok']);
    const index = build([entry('mangalek', 'Solo Leveling'), entry('teamx', 'Solo Leveling: Ragnarok'), dex]);
    expect(index.list()).toHaveLength(3);
    expect(index.rejected).toHaveLength(1);
  });

  it('two works of one source claiming the same name stay apart', () => {
    const name = ['Return of the Iron Blooded Hound'];
    const index = build([entry('mangalek', 'Return of the Iron Blooded Hound'), dexEntry('Cheolhyeolgeomga Sanyanggaeui Hoegwi', 'a', name), dexEntry('Some Other Romanization', 'b', name)]);
    // الأول ينضم؛ الثاني من المصدر نفسه بمفتاح آخر: عملان عند MangaDex فلا يُدمج
    expect(index.list()).toHaveLength(2);
  });

  it('one common word in a source name merges nothing', () => {
    expect(build([entry('mangalek', 'Monster'), dexEntry('Kaibutsu', 'y', ['Monster'])]).list()).toHaveLength(2);
  });
});

describe('شاشة المالك 2026-10-10: عملان بأسماء إنجليزية مختلفة', () => {
  it('World Extinction War = World Destruction War بعنوانهما الكوري الأصلي «세계멸망전»', () => {
    const index = canonicalIndex({ aliases: new Map([['world destruction war', ['세계멸망전', 'حرب الدمار العالمي']]]) });
    index.add({ sourceId: 'mangalek', manga: { title: 'World Destruction War', url: '/w' } });
    index.add({ sourceId: 'azora', manga: { title: 'World Destruction War', url: '/w2' } });
    index.add({ sourceId: 'mangadex', manga: { title: 'World Extinction War', url: '/manga/x', altNames: ['Segye Myeolmangjeon', '세계멸망전'] } });
    const works = index.list();
    expect(works).toHaveLength(1);
    expect(works[0].editions.map((e) => e.sourceId).sort()).toEqual(['azora', 'mangadex', 'mangalek']);
  });

  it('Magic Emperor = Demonic Emperor (اسم MangaDex البديل)', () => {
    const index = canonicalIndex();
    index.add({ sourceId: 'teamx', manga: { title: 'Demonic Emperor', url: '/d' } });
    index.add({ sourceId: 'mangadex', manga: { title: 'Magic Emperor', url: '/manga/m', altNames: ['Demonic Emperor', 'Mo Huang Da Guan Jia', '魔皇大管家'] } });
    expect(index.list()).toHaveLength(1);
  });

  it('عنوان أصلي قصير أو مختلف بحرف لا يدمج، ومصدر يعرضهما عملين يبقيان عملين', () => {
    const short = canonicalIndex();
    short.add({ sourceId: 'a', manga: { title: 'Demon King One', url: '/1', altNames: ['魔王'] } });
    short.add({ sourceId: 'b', manga: { title: 'Demon King Two', url: '/2', altNames: ['魔王'] } });
    expect(short.list()).toHaveLength(2);
    const season = canonicalIndex();
    season.add({ sourceId: 'a', manga: { title: 'Solo Leveling', url: '/1', altNames: ['나 혼자만 레벨업'] } });
    season.add({ sourceId: 'b', manga: { title: 'Solo Leveling Ragnarok', url: '/2', altNames: ['나 혼자만 레벨업: 라그나로크'] } });
    expect(season.list()).toHaveLength(2);
    const guard = canonicalIndex();
    guard.add({ sourceId: 'mangalek', manga: { title: 'Alpha Hunter Saga', url: '/a', altNames: ['세계멸망전'] } });
    guard.add({ sourceId: 'mangalek', manga: { title: 'Crimson Knight Chronicle', url: '/b', altNames: ['세계멸망전'] } });
    expect(guard.list()).toHaveLength(2);
    expect(guard.rejected.join(' ')).toContain('mangalek');
  });
});

describe('الأسماء المشحونة: حالات المالك', () => {
  it('World Destruction War (عربي) و World Extinction War (MangaDex/MangaFire) بطاقة واحدة', async () => {
    const { readFileSync } = await import('node:fs');
    const data = JSON.parse(readFileSync(new URL('../data/manga-aliases.json', import.meta.url), 'utf8'));
    const index = canonicalIndex({ aliases: new Map(Object.entries(data.aliases)) });
    for (const s of ['mangalek', 'azora', 'teamx']) index.add({ sourceId: s, manga: { title: 'World Destruction War', url: `/${s}` } });
    index.add({ sourceId: 'mangadex', manga: { title: 'World Extinction War', url: '/manga/x' } });
    index.add({ sourceId: 'mangafire', manga: { title: 'World Extinction War', url: '/x' } });
    index.add({ sourceId: 'teamx', manga: { title: 'Demonic Emperor', url: '/d' } });
    index.add({ sourceId: 'mangalek', manga: { title: 'Magic emperor', url: '/m' } });
    expect(index.list().map((w) => w.key).sort()).toEqual(['magic emperor', 'world destruction war']);
  });
});

describe('العنوان الأصلي المشترك لا يدمج الجزء الجانبي', () => {
  it('The Ravages of Time ≠ The Ravages of Time: Blue Hawk ولو تشاركا «火鳳燎原»', () => {
    const index = canonicalIndex();
    index.add({ sourceId: 'a', manga: { title: 'The Ravages of Time', url: '/1', altNames: ['火鳳燎原'] } });
    index.add({ sourceId: 'b', manga: { title: 'The Ravages of Time: Blue Hawk', url: '/2', altNames: ['火鳳燎原'] } });
    expect(index.list()).toHaveLength(2);
    expect(index.rejected.join(' ')).toContain('اسم جزء آخر');
  });
});
