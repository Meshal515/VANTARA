import { expect, it } from 'vitest';
import { teamxChapterLink, ikenChapterLocked } from './chapter-access.js';

it('requires an actual same-site chapter URL, including for a paid chapter the user can legitimately read', () => {
  const base='https://olympustaff.com';
  expect(teamxChapterLink('/series/LWW/219',base)).toBe(true);
  for(const href of ['#','#buyModel','/series/LWW','https://other.test/series/LWW/219','javascript:alert(1)',''])expect(teamxChapterLink(href,base)).toBe(false);
  expect(teamxChapterLink('/series/LWW/219',base,true)).toBe(false);
});

it('uses the same Iken access rules in the collector and reader', () => {
  for(const chapter of [{isLocked:true},{isTimeLocked:true},{isPermanentlyLocked:true},{chapterPurchased:false,price:10}])expect(ikenChapterLocked(chapter)).toBe(true);
  expect(ikenChapterLocked({chapterPurchased:true,price:10})).toBe(false);
  expect(ikenChapterLocked({chapterPurchased:false,price:0})).toBe(false);
});
