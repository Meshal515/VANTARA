import { beforeEach, describe, expect, it } from 'vitest';
import { ARABIC, BLOCKED, FOREIGN, MIXED, _resetSourceTiers, buildsLibrary, enrichOnly, noteSourceTiers, searchable, sourceTier, tierFromId, tierOf } from './source-policy.js';

const P = 'eu.kanade.tachiyomi.extension';
beforeEach(() => _resetSourceTiers());

describe('سياسة المصادر (قرار المالك، 22 نوفمبر)', () => {
  it('classifies sources from the engine manifest: Arabic safe, foreign safe, mixed, adult', () => {
    expect(sourceTier({ id: `${P}.ar.teamx`, lang: 'ar', warning: 'SAFE' })).toBe(ARABIC);
    expect(sourceTier({ id: `${P}.all.mangafire@en`, lang: 'en', filler: true, user: true, warning: 'SAFE' })).toBe(FOREIGN);
    expect(sourceTier({ id: `${P}.all.mangadex`, lang: 'ar', warning: 'MIXED' })).toBe(MIXED);
    expect(sourceTier({ id: `${P}.ar.mixedsite#9`, lang: 'ar', user: true, warning: 'MIXED' })).toBe(MIXED);
    expect(sourceTier({ id: `${P}.all.nhentai#1`, lang: 'en', user: true, warning: 'SAFE' })).toBe(BLOCKED);
    // مثبّت بلا تصنيف معلن: مجهول = مختلط حتى يُعرف
    expect(sourceTier({ id: `${P}.en.unrated#1`, lang: 'en', user: true })).toBe(MIXED);
  });

  it('without the manifest (another device, the server) only built-in Arabic ids are Arabic', () => {
    expect(tierFromId(`${P}.ar.mangalek`)).toBe(ARABIC);
    expect(tierFromId('teamx')).toBe(ARABIC);
    expect(tierFromId(`${P}.all.mangafire@en`)).toBe(MIXED);
    expect(tierFromId(`${P}.all.mangadex@ar`)).toBe(MIXED);
    expect(tierFromId(`${P}.ar.hizomanga#4177563748162518441`)).toBe(MIXED);
    expect(tierFromId(`${P}.all.mangadex`)).toBe(MIXED);
    expect(tierFromId(`${P}.en.toonily`)).toBe(BLOCKED);
    expect(tierFromId('')).toBe(MIXED);
  });

  it('the device manifest wins over the id rule, and roles follow the tier', () => {
    noteSourceTiers([{ id: `${P}.ar.hizomanga#1`, lang: 'ar', user: true, warning: 'SAFE' }, { id: `${P}.all.mangadex`, lang: 'ar', warning: 'MIXED' }]);
    expect(tierOf(`${P}.ar.hizomanga#1`)).toBe(ARABIC);
    expect(buildsLibrary(`${P}.ar.hizomanga#1`)).toBe(true);
    expect(tierOf(`${P}.all.mangadex`)).toBe(MIXED);
    expect(enrichOnly(`${P}.all.mangadex`)).toBe(true);
    expect(searchable(`${P}.all.mangadex`)).toBe(false);
    expect(searchable(`${P}.all.mangafire@en`)).toBe(false);
    noteSourceTiers([{ id: `${P}.all.mangafire@en`, lang: 'en', filler: true, user: true, warning: 'SAFE' }]);
    expect(searchable(`${P}.all.mangafire@en`)).toBe(true);
    expect(buildsLibrary(`${P}.all.mangafire@en`)).toBe(false);
  });
});
