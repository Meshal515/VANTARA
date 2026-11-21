import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _reset, canonicalRefOf, noteRefAlias, refsOf } from './manga-alias-store.js';

beforeEach(() => { vi.stubGlobal('localStorage', undefined); _reset(); });

describe('reading and library references survive canonical regrouping', () => {
  it('includes earlier aliases when a canonical work later joins another work', () => {
    noteRefAlias('ext:first title', 'ext:second title');
    noteRefAlias('ext:second title', 'ext:third title');
    expect(refsOf('ext:third title')).toEqual(['ext:third title', 'ext:second title', 'ext:first title']);
  });

  it('retains every old work reference across more than ten names', () => {
    const old = Array.from({ length: 15 }, (_, i) => `ext:old ${i}`);
    for (const ref of old) noteRefAlias(ref, 'ext:canonical');
    expect(refsOf('ext:canonical')).toEqual(['ext:canonical', ...old]);
  });

  it('terminates and deduplicates when evidence later reverses a canonical reference', () => {
    noteRefAlias('ext:a', 'ext:b');
    noteRefAlias('ext:b', 'ext:a');
    expect(refsOf('ext:a')).toEqual(['ext:a', 'ext:b']);
  });
});

describe('one work, one reference class (both directions)', () => {
  it('an old reference reads the canonical work too, not only the reverse', () => {
    noteRefAlias('ext:demon slayer kimetsu no yaiba', 'ext:kimetsu no yaiba');
    expect(refsOf('ext:demon slayer kimetsu no yaiba')).toEqual(['ext:demon slayer kimetsu no yaiba', 'ext:kimetsu no yaiba']);
    expect(refsOf('ext:kimetsu no yaiba')).toEqual(['ext:kimetsu no yaiba', 'ext:demon slayer kimetsu no yaiba']);
  });

  it('every member of a class has the same canonical reference, whatever order the evidence came in', () => {
    noteRefAlias('ext:b', 'ext:c');
    noteRefAlias('ext:a', 'ext:c');
    noteRefAlias('ext:a', 'ext:d');
    const reps = ['ext:a', 'ext:b', 'ext:c', 'ext:d'].map(canonicalRefOf);
    expect(new Set(reps).size).toBe(1);
    expect(canonicalRefOf('ext:unrelated')).toBe('ext:unrelated');
    expect(canonicalRefOf('anime:21')).toBe('anime:21');
  });

  it('a class learned later is seen at once (no stale cache)', () => {
    expect(canonicalRefOf('ext:x')).toBe('ext:x');
    noteRefAlias('ext:x', 'ext:y');
    expect(canonicalRefOf('ext:x')).toBe(canonicalRefOf('ext:y'));
  });
});

describe('SY2: a full device storage is said, not swallowed', () => {
  it('a failed save of the merge record announces vantara:storage-full and keeps the alias for the session', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } });
    const heard = [];
    vi.stubGlobal('dispatchEvent', (e) => heard.push(e.type === 'vantara:storage-full' ? e.detail.key : e.type));
    noteRefAlias('ext:old name', 'ext:new name');
    expect(heard).toEqual(['vantara.manga.refAliases.v1']);
    expect(refsOf('ext:new name')).toEqual(['ext:new name', 'ext:old name']);
  });
});

describe('ID4: a merge can be undone, and undoing deletes nothing', () => {
  it('after a split each reference reads only its own marks; re-merging the same evidence is refused; unsplit restores', async () => {
    const { splitRefs, unsplitRefs, isSplit } = await import('./manga-alias-store.js');
    noteRefAlias('ext:ragnarok arise', 'ext:solo leveling');
    expect(refsOf('ext:solo leveling')).toEqual(['ext:solo leveling', 'ext:ragnarok arise']);
    expect(splitRefs('ext:ragnarok arise', 'ext:solo leveling')).toBe(true);
    expect(isSplit('ext:solo leveling', 'ext:ragnarok arise')).toBe(true);
    expect(refsOf('ext:solo leveling')).toEqual(['ext:solo leveling']);
    expect(refsOf('ext:ragnarok arise')).toEqual(['ext:ragnarok arise']);
    // الفهرس يعيد الدليل نفسه: لا يُسجَّل الدمج من جديد
    noteRefAlias('ext:ragnarok arise', 'ext:solo leveling');
    expect(refsOf('ext:solo leveling')).toEqual(['ext:solo leveling']);
    unsplitRefs('ext:ragnarok arise', 'ext:solo leveling');
    expect(refsOf('ext:solo leveling')).toEqual(['ext:solo leveling', 'ext:ragnarok arise']);
  });
});

describe('plan B: the stored merge record heals itself on the device', () => {
  it('an old record that joined the Zoro spin-off to One Piece is cut as soon as both official ids are known, and saved in both forms', async () => {
    const data = new Map([['vantara.manga.refAliases.v1', JSON.stringify({ 'ext:one piece': ['ext:ون بيس', 'ext:roronoa zoro umi ni chiru'] })]]);
    vi.stubGlobal('localStorage', { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) });
    _reset();
    const { noteOfficialIds, workIdentity } = await import('./manga-alias-store.js');
    expect(refsOf('ext:one piece')).toEqual(['ext:one piece', 'ext:ون بيس', 'ext:roronoa zoro umi ni chiru']);
    noteOfficialIds([['one piece', 30013], ['roronoa zoro umi ni chiru', 187943]]);
    expect(refsOf('ext:one piece')).toEqual(['ext:one piece', 'ext:ون بيس']);
    expect(refsOf('ext:roronoa zoro umi ni chiru')).toEqual(['ext:roronoa zoro umi ni chiru']);
    // الشكل القديم بلا المقطوع (يقرؤه إصدار أقدم سليمًا)، والقطع بسببه في سجل الهوية
    expect(JSON.parse(data.get('vantara.manga.refAliases.v1'))).toEqual({ 'ext:one piece': ['ext:ون بيس'] });
    expect(JSON.parse(data.get('vantara.manga.identity.v1')).e.some((row) => row[5] === 'official')).toBe(true);
    // وبعد إعادة التشغيل يبقى مقطوعًا، والهوية واحدة لمراجع العمل كلها
    _reset();
    expect(refsOf('ext:roronoa zoro umi ni chiru')).toEqual(['ext:roronoa zoro umi ni chiru']);
    expect(workIdentity('ext:ون بيس')).toBe(workIdentity('ext:one piece'));
  });

  it('a listing cannot join two works whose official ids differ', async () => {
    const { noteOfficialIds, noteRefAliases } = await import('./manga-alias-store.js');
    noteOfficialIds([['solo leveling', 105398], ['solo leveling ragnarok', 176009]]);
    noteRefAliases([['ext:solo leveling ragnarok', 'ext:solo leveling']]);
    expect(refsOf('ext:solo leveling')).toEqual(['ext:solo leveling']);
  });
});
