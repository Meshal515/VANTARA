/**
 * بلاغ المالك (22 نوفمبر، بالصور): «آخر التحديثات» صارت كموقع إباحي. السبب الجذري: كل جهاز يمسح «آخر» مصادره ويبلّغ
 * الخادم بلا أي فحص، وقائمة الخادم مشتركة لكل المستخدمين. الآن: لا يُبلَّغ إلا من عربي آمن عن عمل نظيف، والعرض يُسقط
 * ما سواه (فوق فلترة الخادم).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetSourceTiers, noteSourceTiers } from './source-policy.js';
import { connectUpdates, flush, observeMangaChapters } from './update-engine.js';
import { groupEvents } from '../v35/updates-view.js';
import { mangaContentVerdict } from './manga-meta.js';

const P = 'eu.kanade.tachiyomi.extension';
const chapters = [{ chapterNumber: 35, dateUpload: Date.now() - 60_000 }, { chapterNumber: 34, dateUpload: Date.now() - 86_400_000 }];

describe('التبليغ عن الفصول', () => {
  let sent;
  beforeEach(() => {
    _resetSourceTiers();
    sent = [];
    connectUpdates(async (_path, { body }) => { sent.push(...body.works); return { status: 200, body: {} }; });
    noteSourceTiers([
      { id: `${P}.ar.teamx`, lang: 'ar', warning: 'SAFE' },
      { id: `${P}.all.mangafire@en`, lang: 'en', filler: true, user: true, warning: 'SAFE' },
      { id: `${P}.all.mangadex@en`, lang: 'en', filler: true, warning: 'MIXED' },
    ]);
  });
  it('only an Arabic safe source reports, and never an adult or ecchi work', async () => {
    observeMangaChapters(`${P}.all.mangafire@en`, { title: 'Secret Taste.Zip', url: '/a', genre: 'Manhwa' }, chapters);
    observeMangaChapters(`${P}.all.mangadex@en`, { title: 'Nighthawk', url: '/b', genre: 'Action, Content rating: Suggestive' }, chapters);
    observeMangaChapters(`${P}.ar.teamx`, { title: 'Sleeping With a Friend Mom Hentai', url: '/c' }, chapters);
    observeMangaChapters(`${P}.ar.teamx`, { title: 'Some Harem', url: '/d', genre: 'Ecchi, Comedy' }, chapters);
    observeMangaChapters(`${P}.ar.teamx`, { title: 'Solo Leveling', url: '/e', genre: 'Action' }, chapters);
    await flush();
    expect(sent.map((w) => w.title)).toEqual(['Solo Leveling']);
  });
});

describe('عرض «آخر التحديثات»', () => {
  beforeEach(() => _resetSourceTiers());
  const ev = (work, s, extra = {}) => ({ id: `${work}|${s}`, work, title: work.slice(4), section: 'manga', kind: 'chapter', number: 2, at: 1, sources: s ? [{ s }] : [], ...extra });
  it('an event without an Arabic safe source is not shown; foreign and mixed sources are stripped from shown ones', () => {
    const groups = groupEvents([
      ev('ext:wrath of the underdog', `${P}.all.mangafire@en`),
      ev('ext:siren getty', `${P}.en.unknownrepo#3`),
      ev('ext:nighthawk', `${P}.all.mangadex@ar`),
      ev('ext:no source', null),
      { ...ev('ext:solo leveling', `${P}.ar.mangalek`), sources: [{ s: `${P}.ar.mangalek` }, { s: `${P}.all.mangafire@en` }] },
    ]);
    expect(groups.map((g) => g.work)).toEqual(['ext:solo leveling']);
    expect(groups[0].sources.map((s) => s.s)).toEqual([`${P}.ar.mangalek`]);
  });
  it('a source this device knows is mixed is dropped even when its id looks Arabic', () => {
    noteSourceTiers([{ id: `${P}.ar.mixedsite`, lang: 'ar', user: true, warning: 'MIXED' }]);
    expect(groupEvents([ev('ext:x', `${P}.ar.mixedsite`)])).toEqual([]);
  });
});

describe('حكم AniList', () => {
  const m = (id, title, extra = {}) => ({ id, format: 'MANGA', title: { english: title }, genres: [], isAdult: false, ...extra });
  it('unknown, clean, ecchi and adult', () => {
    expect(mangaContentVerdict('Nobody Knows', [])).toBe('unknown');
    expect(mangaContentVerdict('Vagabond', [m(1, 'Vagabond', { genres: ['Action'] })])).toBe('clean');
    expect(mangaContentVerdict('Prison School', [m(2, 'Prison School', { genres: ['Comedy', 'Ecchi'] })])).toBe('ecchi');
    expect(mangaContentVerdict('Secret Taste', [m(3, 'Secret Taste', { isAdult: true })])).toBe('adult');
    expect(mangaContentVerdict('Harem Thing', [m(4, 'Harem Thing', { genres: ['Ecchi', 'Harem'] })])).toBe('adult');
    // اسم مشترك أحدهما للكبار: لا يُحكم له
    expect(mangaContentVerdict('Siren', [m(5, 'Siren'), m(6, 'Siren', { isAdult: true })])).toBe('unknown');
  });
});
