import { describe, expect, it } from 'vitest';
import { adultGenre, adultManga, adultTitle, blockKey, isBlockedKey } from './adult-filter.js';
import { groupEvents } from '../v35/updates-view.js';

describe('محتوى الكبار لا يظهر في VANTARA', () => {
  it('blocks hentai, ecchi, smut, BL/GL, yaoi/yuri and 18+ by genre, in English and Arabic', () => {
    for (const genre of ['Action, Hentai', 'Ecchi', 'Romance, Smut', "Boys' Love", 'BL', 'Girls Love', 'Yaoi', 'Yuri', 'Shounen Ai', 'Shoujo-ai', 'Adult', '18+', 'Erotica', 'NSFW',
      'أكشن، هنتاي', 'إيتشي', 'ياوي', 'يوري', 'شونين اي', 'للكبار', '+18', 'محتوى جنسي'])
      expect(adultGenre(genre), genre).toBe(true);
    expect(adultGenre([{ name: 'Yaoi' }, { name: 'دراما' }])).toBe(true);
  });
  it('keeps ordinary works: action, romance, mature violence, and titles that only look similar', () => {
    for (const genre of ['Action, Drama, Adventure', 'Romance, School Life', 'Mature, Gore', 'أكشن، دراما، مغامرة', 'Full Color, Long Strip, Web Comic', 'Blue Lock'])
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
    const ev = (work, title) => ({ id: `${work}|c:1`, work, title, section: 'manga', kind: 'chapter', number: 1, at: 1 });
    blockKey('ext:hidden by page');
    const groups = groupEvents([ev('ext:clean', 'Clean Work'), ev('ext:x', 'Night [NSFW]'), ev('ext:hidden by page', 'Hidden By Page')]);
    expect(groups.map((g) => g.title)).toEqual(['Clean Work']);
  });
});
