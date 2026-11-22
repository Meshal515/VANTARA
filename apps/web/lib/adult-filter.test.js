import { describe, expect, it } from 'vitest';
import { adultGenre, adultManga, adultTitle, blockKey, isBlockedKey } from './adult-filter.js';
import { groupEvents } from '../v35/updates-view.js';

describe('محتوى الكبار لا يظهر في VANTARA', () => {
  it('blocks hentai, smut, BL/GL, yaoi/yuri and 18+ by genre, in English and Arabic', () => {
    for (const genre of ['Action, Hentai', 'Romance, Smut', "Boys' Love", 'BL', 'Girls Love', 'Yaoi', 'Yuri', 'Shounen Ai', 'Shoujo-ai', 'Adult', '18+', 'Erotica', 'NSFW',
      'أكشن، هنتاي', 'ياوي', 'يوري', 'شونين اي', 'للكبار', '+18', 'محتوى جنسي'])
      expect(adultGenre(genre), genre).toBe(true);
    expect(adultGenre([{ name: 'Yaoi' }, { name: 'دراما' }])).toBe(true);
  });
  it('keeps ordinary works: action, romance, mature violence, and titles that only look similar', () => {
    // الإيتشي يبقى بقرار المالك
    for (const genre of ['Ecchi', 'Romance, Ecchi', 'إيتشي', 'Action, Drama, Adventure', 'Romance, School Life', 'Mature, Gore', 'أكشن، دراما، مغامرة', 'Full Color, Long Strip, Web Comic', 'Blue Lock'])
      expect(adultGenre(genre), genre).toBe(false);
    for (const title of ['Blue Lock', 'Yuri!!! on ICE', 'Kariel the Hero', 'The Adult Life of a Hero', 'BLEACH', 'Solo Leveling'])
      expect(adultTitle(title), title).toBe(false);
  });
  it('blocks unmistakable titles from listings that carry no genre', () => {
    for (const title of ['Some Work [NSFW]', 'Uncensored Edition', 'Work (R18)', 'عمل +18', 'Hentai Academy', 'Night Smut'])
      expect(adultTitle(title), title).toBe(true);
    expect(adultManga({ title: 'Clean', genre: 'Action, Yuri' })).toBe(true);
    expect(adultManga({ title: 'Clean', genre: 'Action' })).toBe(false);
  });
  it('remembers works whose page revealed adult content, under ext: keys too', () => {
    blockKey('ext:some secret work');
    expect(isBlockedKey('some secret work')).toBe(true);
    expect(isBlockedKey('ext:some secret work')).toBe(true);
    expect(isBlockedKey('another work')).toBe(false);
  });
  it('removes adult works from latest updates', () => {
    const ev = (work, title) => ({ id: `${work}|c:1`, work, title, section: 'manga', kind: 'chapter', number: 1, at: 1, sources: [{ s: 'teamx' }] });
    blockKey('ext:hidden by page');
    const groups = groupEvents([ev('ext:clean', 'Clean Work'), ev('ext:x', 'Night [NSFW]'), ev('ext:hidden by page', 'Hidden By Page')]);
    expect(groups.map((g) => g.title)).toEqual(['Clean Work']);
  });
});

import { adultSource as _adultSource, adultGenre as _adultGenre } from './adult-filter.js';
import { describe as _d, it as _it, expect as _e } from 'vitest';
_d('owner rule 16 Nov: specialized adult sources vanish, general ones stay', () => {
  _it('specialized by name or package', () => {
    for (const s of [{ name: 'NHentai' }, { name: 'HentaiRead' }, { pkg: 'eu.kanade.tachiyomi.extension.all.hitomi' }, { name: 'Manhwa18' }, { name: 'Toonily' }, { label: 'مانجا هنتاي' }])
      _e(_adultSource(s), JSON.stringify(s)).toBe(true);
  });
  _it('general sources flagged NSFW in their repository stay', () => {
    for (const s of [{ name: 'MangaDex', nsfw: 1 }, { name: 'Team X' }, { name: 'MangaFire', nsfw: 1 }, { pkg: 'eu.kanade.tachiyomi.extension.en.weebcentral' }])
      _e(_adultSource(s), JSON.stringify(s)).toBe(false);
  });
  _it('nudity hides a work; ecchi alone does not', () => {
    _e(_adultGenre('Action, Ecchi, Nudity')).toBe(true);
    _e(_adultGenre('Fantasy, Ecchi, Isekai')).toBe(false);
  });
});

import { dirtyEcchiGenre, ecchiGenre, ecchiManga } from './adult-filter.js';
_d('الإيتشي (قرار المالك، 22 نوفمبر)', () => {
  _it('ecchi alone is recognised, and ecchi with harem or infidelity counts as adult everywhere', () => {
    _e(ecchiGenre('Comedy, Ecchi, School Life')).toBe(true);
    _e(dirtyEcchiGenre('Comedy, Ecchi, School Life')).toBe(false);
    _e(dirtyEcchiGenre(['Ecchi', 'Harem'])).toBe(true);
    _e(adultManga({ title: 'Some Work', genre: 'Ecchi, Harem, Romance' })).toBe(true);
    _e(adultManga({ title: 'Some Work', genre: 'Ecchi, Slice of Life' })).toBe(false);
    _e(ecchiManga({ title: 'Some Work', genre: 'Ecchi, Slice of Life' })).toBe(true);
  });
  _it('MangaDex explicit content ratings are adult; Suggestive is treated as ecchi', () => {
    _e(adultManga({ title: 'X', genre: 'Action, Content rating: Erotica' })).toBe(true);
    _e(adultManga({ title: 'X', genre: 'Action, Content rating: Suggestive' })).toBe(false);
    _e(ecchiManga({ title: 'X', genre: 'Action, Content rating: Suggestive, Japanese' })).toBe(true);
  });
});
