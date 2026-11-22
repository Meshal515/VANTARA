import { describe, expect, it } from 'vitest';
import { normalizeTitle } from './catalog.js';
import { detailEvidence, isPartName, listingEvidence, namesPointElsewhere, officialConflict, ownNames, pickEdition } from './work-evidence.js';

// الخطة ب: النسخة تُقبل بما قاله مصدرها عن اسم من أسماء العمل الموثوقة، وفوقه حارس المعرّف الرسمي.
const card = (title, editions, extra = {}) => ({ id: `ext:${title.toLowerCase()}`, title: { english: title }, _work: { key: title.toLowerCase(), title, editions }, ...extra });
const ed = (title, altNames) => ({ sourceId: 'src', manga: { title, url: `/${title}`, ...(altNames ? { altNames } : {}) } });

describe('the trusted names of a work', () => {
  it('are its titles, its editions’ titles and what its editions’ sources call it, never the parent series name', () => {
    const zoro = card('One Piece Roronoa Zoro', [ed('One Piece Roronoa Zoro', ['ONE PIECE', 'ون بيس زورو'])]);
    const own = ownNames(zoro);
    expect(own.has('one piece roronoa zoro')).toBe(true);
    expect(own.has('ون بيس زورو')).toBe(true);
    expect(own.has('one piece')).toBe(false);
  });

  it('a collection listing its stories’ names gives none of them; a name of another official work is left out', () => {
    const officialOf = (k) => ({ 'sasaki stopped a bullet': 1, 'love is blind': 2, 'the other one': 9 })[k] ?? null;
    const collection = card('Short Story Collection', [ed('Short Story Collection', ['Sasaki Stopped a Bullet', 'Love Is Blind'])]);
    expect([...ownNames(collection, { officialOf })]).toEqual(['short story collection']);
    const work = card('Real Work', [ed('Real Work', ['The Other One', 'Real Work Alt'])]);
    expect([...ownNames(work, { workOfficial: 5, officialOf })].sort()).toEqual(['real work', 'real work alt']);
  });

  it('AniList synonyms count only for an AniList card, and the work’s detail page names count', () => {
    const anilist = { ...card('Until No Demon Remains', []), _metaId: 214315, synonyms: ['Myeolgwisudojeon'] };
    expect(ownNames(anilist).has('myeolgwisudojeon')).toBe(true);
    expect(ownNames({ ...anilist, _metaId: undefined }).has('myeolgwisudojeon')).toBe(false);
    expect(ownNames(card('Komi Cant Communicate', []), { more: ['Komi-san wa Komyushou Desu'] }).has('komi san wa komyushou desu')).toBe(true);
  });
});

describe('what a listing result proves', () => {
  const own = new Set([normalizeTitle("The Savior's Bucket List"), normalizeTitle('Solo Leveling')]);
  it('its exact title, a spelling twin, its own alternative names, or its link', () => {
    expect(listingEvidence({ title: "The Savior's Bucket List" }, own)).toBe('exact');
    expect(listingEvidence({ title: 'قائمة المنقذ', altNames: ["The Savior's Bucket List"] }, own)).toBe('alt');
    expect(listingEvidence({ title: 'قائمة أمنيات المنقذ', url: '/manga/the-saviors-bucket-list/' }, own)).toBe('slug');
    expect(listingEvidence({ title: 'قائمة أمنيات المنقذ', url: '/p/7731' }, own)).toBeNull();
    expect(listingEvidence({ title: 'Solo Leveling: Ragnarok' }, own)).toBeNull();
  });

  it('alternative names that point to other official works prove nothing', () => {
    const officialOf = (k) => ({ [normalizeTitle('Solo Leveling')]: 1, [normalizeTitle('Another Work')]: 2 })[k] ?? null;
    expect(listingEvidence({ title: 'Collection', altNames: ['Solo Leveling', 'Another Work'] }, own, { officialOf })).toBeNull();
    expect(namesPointElsewhere(['Solo Leveling', 'x'], 1, officialOf)).toBe(false);
    expect(namesPointElsewhere(['Solo Leveling', 'Another Work'], 1, officialOf)).toBe(true);
  });

  it('a detail page proves it when its own names include the work’s name', () => {
    expect(detailEvidence({ title: 'قائمة أمنيات المنقذ', altNames: ["The Savior's Bucket List"] }, own)).toBe('detail');
    expect(detailEvidence({ title: 'قائمة', description: "قصة...\nAlternative Names: The Savior's Bucket List, X" }, own)).toBe('detail');
    expect(detailEvidence({ title: 'سولو ليفلينج: راجناروك', altNames: ['Solo Leveling: Ragnarok'] }, own)).toBeNull();
  });
});

describe('choosing and guarding', () => {
  it('the strongest evidence wins; two different results with the same evidence is ambiguity, never a guess', () => {
    const a = { manga: { url: '/a' }, ev: 'exact' };
    const b = { manga: { url: '/b' }, ev: 'alt' };
    expect(pickEdition([b, a])).toBe(a);
    expect(pickEdition([a, { manga: { url: '/c' }, ev: 'exact' }])).toBeNull();
    expect(pickEdition([a, { ...a, ev: 'alias' }])).toBe(a);
    expect(pickEdition([])).toBeNull();
  });

  it('a different known official id is a different work', () => {
    const officialOf = (k) => ({ 'one piece': 30013 })[k] ?? null;
    expect(officialConflict({ title: 'One Piece' }, 187943, officialOf)).toBe(true);
    expect(officialConflict({ title: 'One Piece' }, 30013, officialOf)).toBe(false);
    expect(officialConflict({ title: 'One Piece' }, null, officialOf)).toBe(false);
  });

  it('part names: a series and its spin-off or sequel are not one work', () => {
    expect(isPartName('one piece', 'one piece roronoa zoro')).toBe(true);
    expect(isPartName('solo leveling ragnarok', 'solo leveling')).toBe(true);
    expect(isPartName('magic emperor', 'demonic emperor')).toBe(false);
  });
});
