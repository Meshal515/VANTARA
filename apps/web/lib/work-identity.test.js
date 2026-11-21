import { describe, expect, it } from 'vitest';
import { RANK, createIdentityGraph, editionKey, identityIdOf } from './work-identity.js';

// الخطة ب: هوية واحدة ثابتة لكل عمل. الشروط الثلاثة: تكرار 0، دمج خاطئ 0، وكل نسخة في عملها.
const graphWith = (officials = {}) => createIdentityGraph({ officialOf: (ref) => officials[ref] ?? null, now: () => 1000 });

describe('one work, one identity everyone can compute', () => {
  it('every reference of a work gives the same vw id, and another device with the same evidence gives the same id', () => {
    const a = graphWith();
    a.propose('ext:demonic emperor', 'ext:magic emperor');
    a.propose('ext:mo huang da guan jia', 'ext:magic emperor');
    const ids = ['ext:demonic emperor', 'ext:magic emperor', 'ext:mo huang da guan jia'].map(a.identity);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/^vw:[0-9a-f]{16}$/);
    expect(ids[0]).toBe(identityIdOf('ext:demonic emperor')); // أصغر مرجع: قاعدة لا ترتيب
    // جهاز آخر وصلته الأدلة بترتيب آخر
    const b = graphWith();
    b.propose('ext:mo huang da guan jia', 'ext:demonic emperor');
    b.propose('ext:magic emperor', 'ext:mo huang da guan jia');
    expect(b.identity('ext:magic emperor')).toBe(ids[0]);
    // عمل لا دمج له: هويته من مرجعه نفسه
    expect(a.identity('ext:solo leveling')).toBe(identityIdOf('ext:solo leveling'));
  });

  it('reads every reference of the work, the reference itself first', () => {
    const g = graphWith();
    g.propose('ext:first title', 'ext:second title');
    g.propose('ext:second title', 'ext:third title');
    expect(g.classOf('ext:third title')).toEqual(['ext:third title', 'ext:second title', 'ext:first title']);
    expect(g.classOf('ext:alone')).toEqual(['ext:alone']);
  });
});

describe('zero wrong merges: a contradiction blocks, and an old wrong merge heals itself', () => {
  it('two different official ids are never one work, whatever the title evidence says', () => {
    const g = graphWith({ 'ext:one piece': 30013, 'ext:one piece zoro': 187943 });
    expect(g.propose('ext:one piece zoro', 'ext:one piece', { rank: RANK.TITLE })).toBe(false);
    expect(g.propose('ext:one piece zoro', 'ext:one piece', { rank: RANK.SOURCE })).toBe(false);
    expect(g.classOf('ext:one piece zoro')).toEqual(['ext:one piece zoro']);
    expect(g.log().at(-1)).toMatchObject({ type: 'refused', why: expect.stringContaining('30013') });
    // ولا عبر وسيط: عمل ثالث بلا معرّف يُدمج بأحدهما ثم لا يجسر إلى الآخر
    expect(g.propose('ext:ون بيس', 'ext:one piece')).toBe(true);
    expect(g.propose('ext:ون بيس', 'ext:one piece zoro')).toBe(false);
    // المستخدم وحده فوق المعرّف الرسمي
    expect(g.propose('ext:one piece zoro', 'ext:one piece', { rank: RANK.USER })).toBe(true);
  });

  it('the owner’s case: an old record that merged the Zoro spin-off into One Piece is cut on load, and nothing is deleted', () => {
    const g = graphWith({ 'ext:one piece': 30013, 'ext:roronoa zoro umi ni chiru': 187943 });
    const healed = g.load({ refAliases: { 'ext:one piece': ['ext:ون بيس', 'ext:roronoa zoro umi ni chiru'] } });
    expect(healed).toHaveLength(1);
    expect(g.classOf('ext:roronoa zoro umi ni chiru')).toEqual(['ext:roronoa zoro umi ni chiru']);
    expect(g.classOf('ext:one piece')).toEqual(['ext:one piece', 'ext:ون بيس']);
    // القطع مسجَّل بسببه، والحافة باقية
    expect(g.edges().find((e) => e.a === 'ext:roronoa zoro umi ni chiru')).toMatchObject({ rank: RANK.LEGACY, cut: { by: 'official' } });
    // الحفظ: الشكل القديم بلا المقطوع (إصدار أقدم يقرؤه سليمًا)، والمقطوع في meta
    const saved = g.dump();
    expect(saved.refAliases).toEqual({ 'ext:one piece': ['ext:ون بيس'] });
    const again = graphWith({ 'ext:one piece': 30013, 'ext:roronoa zoro umi ni chiru': 187943 });
    again.load(saved);
    expect(again.classOf('ext:one piece')).toEqual(['ext:one piece', 'ext:ون بيس']);
    expect(again.edges()).toHaveLength(2);
  });

  it('healing cuts the weakest link on the path between the contradiction, the newest among equals, never the user’s', () => {
    const officials = { 'ext:a': 1, 'ext:d': 2 };
    const g = graphWith(officials);
    // a —SOURCE— b —TITLE— c —USER— d : التعارض بين a وd يقطع b–c (الأضعف)
    g.propose('ext:a', 'ext:b', { rank: RANK.SOURCE, at: 1 });
    officials['ext:d'] = undefined;
    g.propose('ext:b', 'ext:c', { rank: RANK.TITLE, at: 2 });
    g.propose('ext:c', 'ext:d', { rank: RANK.USER, at: 3 });
    officials['ext:d'] = 2;
    g.invalidate();
    const cuts = g.heal();
    expect(cuts.map((e) => [e.a, e.b])).toEqual([['ext:b', 'ext:c']]);
    expect(g.classOf('ext:a')).toEqual(['ext:a', 'ext:b']);
    expect(g.classOf('ext:d')).toEqual(['ext:d', 'ext:c']);
  });

  it('a contradiction joined only by the user stays as the user decided', () => {
    const officials = { 'ext:a': 1 };
    const g = graphWith(officials);
    g.propose('ext:a', 'ext:b', { rank: RANK.USER });
    officials['ext:b'] = 2;
    g.invalidate();
    expect(g.heal()).toEqual([]);
    expect(g.sameClass('ext:a', 'ext:b')).toBe(true);
    expect(g.log().at(-1).type).toBe('unhealed');
  });
});

describe('the user split (ID4) is an event, not a deletion', () => {
  it('splits through a middle reference, refuses the same evidence again, and unsplit restores exactly what it cut', () => {
    const g = graphWith();
    g.propose('ext:ragnarok arise', 'ext:sl middle');
    g.propose('ext:sl middle', 'ext:solo leveling');
    expect(g.split('ext:ragnarok arise', 'ext:solo leveling')).toBe(true);
    expect(g.sameClass('ext:ragnarok arise', 'ext:solo leveling')).toBe(false);
    expect(g.propose('ext:ragnarok arise', 'ext:solo leveling')).toBe(false);
    expect(g.propose('ext:ragnarok arise', 'ext:solo leveling', { rank: RANK.OFFICIAL })).toBe(false);
    expect(g.unsplit('ext:ragnarok arise', 'ext:solo leveling')).toBe(true);
    expect(g.classOf('ext:solo leveling')).toEqual(['ext:solo leveling', 'ext:sl middle', 'ext:ragnarok arise']);
  });

  it('a split saved by the previous version still separates after migration', () => {
    const g = graphWith();
    g.load({ refAliases: { 'ext:solo leveling': ['ext:ragnarok arise'] }, splits: [['ext:ragnarok arise', 'ext:solo leveling', 5]] });
    expect(g.classOf('ext:solo leveling')).toEqual(['ext:solo leveling']);
    expect(g.isSplit('ext:solo leveling', 'ext:ragnarok arise')).toBe(true);
  });
});

describe('every source edition belongs to exactly one work', () => {
  const ed = editionKey('eu.kanade.tachiyomi.extension.ar.mangalek', '/manga/one-piece/');

  it('the key ignores the site domain and a trailing slash', () => {
    expect(editionKey('fam', 'https://old.example/manga/x/')).toBe('fam|/manga/x');
    expect(editionKey('fam', 'https://new.example/manga/x')).toBe('fam|/manga/x');
    expect(editionKey('fam', '/series?id=7')).toBe('fam|/series?id=7');
    expect(editionKey('fam', '')).toBeNull();
    expect(editionKey('', '/x')).toBeNull();
  });

  it('weak evidence never links an edition; verified evidence does, once', () => {
    const g = graphWith();
    expect(g.linkEdition(ed, 'ext:one piece', { rank: RANK.TITLE })).toMatchObject({ ok: false });
    expect(g.editionRef(ed)).toBeNull();
    expect(g.linkEdition(ed, 'ext:one piece', { rank: RANK.SOURCE })).toEqual({ ok: true });
    expect(g.editionRef(ed)).toBe('ext:one piece');
  });

  it('an edition of One Piece is not taken by the spin-off: contradiction refuses, and the edition stays', () => {
    const g = graphWith({ 'ext:one piece': 30013, 'ext:zoro': 187943 });
    g.linkEdition(ed, 'ext:one piece', { rank: RANK.SOURCE });
    expect(g.linkEdition(ed, 'ext:zoro', { rank: RANK.SOURCE })).toEqual({ ok: false, reason: 'النسخة لعمل آخر' });
    expect(g.editionRef(ed)).toBe('ext:one piece');
    expect(g.sameClass('ext:zoro', 'ext:one piece')).toBe(false);
  });

  it('one edition verified for two cards of the same work joins them (no duplicate), and the user can move it anywhere', () => {
    const g = graphWith();
    g.linkEdition(ed, 'ext:the saviors bucket list', { rank: RANK.SOURCE });
    expect(g.linkEdition(ed, 'ext:قائمة امنيات المنقذ', { rank: RANK.SOURCE })).toEqual({ ok: true, merged: true });
    expect(g.sameClass('ext:the saviors bucket list', 'ext:قائمة امنيات المنقذ')).toBe(true);
    expect(g.linkEdition(ed, 'ext:elsewhere', { rank: RANK.USER })).toEqual({ ok: true });
    expect(g.editionRef(ed)).toBe('ext:elsewhere');
  });

  it('links survive save and load', () => {
    const g = graphWith();
    g.linkEdition(ed, 'ext:one piece', { rank: RANK.OFFICIAL });
    const again = graphWith();
    again.load(g.dump());
    expect(again.editionRef(ed)).toBe('ext:one piece');
    expect(again.editionRank(ed)).toBe(RANK.OFFICIAL);
  });
});

describe('storage is safe', () => {
  it('a damaged record loses only its damaged lines', () => {
    const g = graphWith();
    g.load({
      refAliases: { 'ext:a': ['ext:b', 7, null, 'ext:a'], 'ext:c': 'not a list' },
      meta: { v: 1, e: [['ext:x'], 'junk', ['ext:y', 'ext:z', RANK.SOURCE, 9, 'مصدر']], n: { k: ['ext:a', RANK.SOURCE, 1], bad: [42] } },
    });
    expect(g.classOf('ext:a')).toEqual(['ext:a', 'ext:b']);
    expect(g.classOf('ext:y')).toEqual(['ext:y', 'ext:z']);
    expect(g.editionRef('k')).toBe('ext:a');
    expect(g.editionRef('bad')).toBeNull();
  });

  it('the saved legacy shape is exactly what the previous version reads', () => {
    const g = graphWith();
    g.propose('ext:old', 'ext:new');
    g.propose('ext:older', 'ext:new', { rank: RANK.SOURCE, why: 'اسم في صفحة المصدر' });
    const { refAliases, meta } = g.dump();
    expect(refAliases).toEqual({ 'ext:new': ['ext:old', 'ext:older'] });
    expect(Object.values(refAliases).every((v) => Array.isArray(v) && v.every((r) => typeof r === 'string'))).toBe(true);
    expect(meta.v).toBe(1);
  });
});

describe('scale: thousands of works, hundreds of sources', () => {
  it('builds, heals and answers for 20k references without quadratic cost', () => {
    const officials = {};
    const t0 = performance.now();
    // سجل قديم: خمسة آلاف عمل بأربعة أسماء، ومعها مئة دمج خاطئ بين أعمال مختلفة (من إصدار بلا حارس)
    const refAliases = {};
    for (let w = 0; w < 5000; w++) {
      refAliases[`ext:w${w} name0`] = [1, 2, 3].map((n) => `ext:w${w} name${n}`);
      officials[`ext:w${w} name0`] = w + 1;
    }
    for (let w = 0; w < 100; w++) refAliases[`ext:w${w + 1} name0`].push(`ext:w${w} name1`);
    const g = createIdentityGraph({ officialOf: (ref) => officials[ref] ?? null });
    const cuts = g.load({ refAliases });
    for (let w = 0; w < 5000; w++) {
      for (let s = 0; s < 3; s++) g.linkEdition(editionKey(`src${(w * 7 + s) % 300}`, `/w/${w}`), `ext:w${w} name0`, { rank: RANK.SOURCE });
    }
    const ms = performance.now() - t0;
    // كل الدمج الخاطئ قُطع، ولا شيء غيره
    expect(cuts).toHaveLength(100);
    expect(cuts.every((e) => e.rank === RANK.LEGACY && /name1$/.test(e.a))).toBe(true);
    for (let w = 0; w < 101; w++) expect(g.classOf(`ext:w${w} name0`)).toHaveLength(4);
    expect(new Set(Array.from({ length: 5000 }, (_, w) => g.identity(`ext:w${w} name3`))).size).toBe(5000);
    expect(ms).toBeLessThan(4000);
  });
});
