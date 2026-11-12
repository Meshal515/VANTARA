import { beforeEach, describe, expect, it } from 'vitest';
import { chapterGroups, detailMarkup, groupIndexOf, isNewChapter, mangaLook, MANGA_LOOKS, rowsForMark, rowsInGroup } from './manga-work.js';
import { chapterKeyOf, clearChapterMarks, isChapterRead, markChapter, markChapters, _resetPending } from './reading.js';
import { projectQueue } from '../lib/optimistic.js';

const glyph = (n) => `<svg data-g="${n}"></svg>`;
const iconButton = (n, label, { act } = {}) => `<button data-act="${act}" aria-label="${label}">${glyph(n)}</button>`;
const row = (n) => ({ sourceId: 'pkg', number: n, chapter: { url: `/c/${n}`, name: `الفصل ${n}`, chapterNumber: n } });
const rows = (max) => Array.from({ length: max }, (_, i) => row(max - i));

describe('أنماط صفحة عمل المانجا', () => {
  it('الأربعة بمعرّفاتها المتفق عليها، وأي قيمة أخرى = «الصفحة»', () => {
    expect(MANGA_LOOKS).toEqual(['page', 'gallery', 'profile', 'resume']);
    for (const id of MANGA_LOOKS) expect(mangaLook(id)).toBe(id);
    for (const id of ['core', 'platform', '', null, undefined]) expect(mangaLook(id)).toBe('page');
  });

  it('كل نمط يبني العناصر التي يملؤها shell.js بمعرّفاتها مرة واحدة', () => {
    for (const look of MANGA_LOOKS) {
      const html = detailMarkup(look, { glyph, iconButton });
      expect(html.match(/<button[^>]*id="readCta"[\s\S]*?<\/button>/)?.[0], look).toContain('data-g="book"');
      for (const id of ['detailTop', 'detailTools', 'detailMenu', 'detailScrim', 'detailCover', 'detailTitle', 'readCta', 'readCtaLabel', 'readCtaSub', 'libraryBtn', 'sourceRow', 'chapterPanel', 'chapterCount', 'chapterSort', 'description', 'moreToggle', 'infoGrid', 'detailStats', 'detailGenres', 'detailInsights']) {
        expect(html.split(`id="${id}"`).length - 1, `${look}: ${id}`).toBe(1);
      }
    }
    expect(detailMarkup('resume', { glyph, iconButton })).toContain('id="resumeNum"');
    expect(detailMarkup('profile', { glyph, iconButton })).toContain('id="detailBanner"');
    expect(detailMarkup('gallery', { glyph, iconButton })).toContain('role="tablist"');
    expect(detailMarkup('page', { glyph, iconButton })).toContain('id="togetherBtn"');
    // «كلاسيكي» = تخطيط Stable كما هو: الغلاف بجانب الاسم، والزر العريض، وثلاثة أزرار، وكتل STORY/CHAPTERS/DETAILS
    const classic = detailMarkup('page', { glyph, iconButton });
    for (const part of ['class="detail-head"', 'class="detail-quick"', 'STORY', 'CHAPTERS', 'DETAILS']) expect(classic).toContain(part);
    expect(classic).not.toMatch(/mw-hero|depth/);
  });

  it('النطاقات كل 50، والبقية القصيرة تُضم لما قبلها (151–201)', () => {
    expect(chapterGroups(rows(201).map((r) => r.number))).toEqual([[1, 50], [51, 100], [101, 150], [151, 201]]);
    expect(chapterGroups(rows(230).map((r) => r.number)).at(-1)).toEqual([201, 230]);
    expect(chapterGroups(rows(40).map((r) => r.number))).toEqual([]);
    expect(chapterGroups([0, ...rows(120).map((r) => r.number)])[0]).toEqual([0, 50]);
  });

  it('الفصل في نطاقه، والجانبي مع رقمه', () => {
    const g = chapterGroups(rows(201).map((r) => r.number));
    expect(groupIndexOf(g, 143)).toBe(2);
    expect(groupIndexOf(g, 150.5)).toBe(2);
    expect(groupIndexOf(g, 201)).toBe(3);
    expect(rowsInGroup(rows(201), g, 2).map((r) => r.number)).toEqual(Array.from({ length: 50 }, (_, i) => 150 - i));
  });

  it('«جديد» لفصل غير مقروء نُشر في آخر أسبوع فقط', () => {
    const now = Date.UTC(2026, 10, 8);
    const r = { chapter: { dateUpload: now - 3 * 86_400_000 } };
    expect(isNewChapter(r, false, now)).toBe(true);
    expect(isNewChapter(r, true, now)).toBe(false);
    expect(isNewChapter({ chapter: { dateUpload: now - 9 * 86_400_000 } }, false, now)).toBe(false);
  });
});

describe('«علّم فصول»', () => {
  const all = rows(60);
  it('المحدّد كما هو، وكل ما قبله، وما بين فصلين بأي ترتيب', () => {
    expect(rowsForMark(all, [row(5), row(9)]).map((r) => r.number)).toEqual([5, 9]);
    expect(rowsForMark(all, [row(12)], 'upTo').map((r) => r.number).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(rowsForMark(all, [row(20), row(15)], 'between').map((r) => r.number).sort((a, b) => a - b)).toEqual([15, 16, 17, 18, 19, 20]);
    expect(rowsForMark(all, [row(1), row(2)], 'upTo')).toEqual([]);
    expect(rowsForMark(all, [row(1)], 'between')).toEqual([]);
  });

  // مزامنة كالحقيقية: الطابور فوق المرآة بالطبقة المتفائلة نفسها (lib/optimistic.js)
  function liveSync(mirror = {}) {
    const queue = [];
    const view = () => projectQueue(queue, mirror, 'me');
    return {
      user: { userId: 'me' },
      queue,
      enqueue: (kind, payload) => queue.push({ kind, payload }),
      row: (t, k) => view()[t]?.[k] ?? mirror[t]?.[k] ?? null,
      rows: (t, f = () => true) => Object.values({ ...(mirror[t] ?? {}), ...(view()[t] ?? {}) }).filter(f),
    };
  }
  const ref = 'ext:solo leveling';
  const read = (s, n) => isChapterRead(s, ref, chapterKeyOf(ref, row(n)));
  beforeEach(() => _resetPending());

  it('تعليم جماعي: عملية واحدة في الطابور، ويظهر فورًا لكل فصل', () => {
    const s = liveSync();
    const n = markChapters(s, ref, rowsForMark(all, [row(30)], 'upTo'), true);
    expect(n).toBe(30);
    expect(s.queue).toHaveLength(1);
    expect(s.queue[0]).toMatchObject({ kind: 'chapter.markMany', payload: { seriesRef: ref, read: true } });
    expect(read(s, 1) && read(s, 30)).toBe(true);
    expect(read(s, 31)).toBe(false);
  });

  it('لا يعيد إرسال ما هو معلّم، والإلغاء يفوز على علامة أقدم في المرآة', () => {
    const key = chapterKeyOf(ref, row(4));
    const s = liveSync({ chapter_marks: { [`me/${key}`]: { user_id: 'me', chapter_key: key, series_ref: ref, read: 1, updated_at: 1 } } });
    expect(markChapters(s, ref, [row(4)], true)).toBe(0);
    expect(markChapters(s, ref, [row(3), row(4)], false)).toBe(1);
    expect(read(s, 4)).toBe(false);
  });

  it('فصل واحد بالزر الجانبي ثم إلغاؤه: آخر كتابة تفوز', () => {
    const s = liveSync();
    markChapter(s, ref, row(7), true);
    expect(read(s, 7)).toBe(true);
    markChapter(s, ref, row(7), false);
    expect(read(s, 7)).toBe(false);
    expect(s.queue.map((o) => o.kind)).toEqual(['chapter.mark', 'chapter.mark']);
  });

  it('إلغاء تعليم الكل يمر من الطبقة المتفائلة بلا شكل بيانات جديد', () => {
    const marks = {};
    for (const n of [1, 2, 3]) {
      const k = chapterKeyOf(ref, row(n));
      marks[`me/${k}`] = { user_id: 'me', chapter_key: k, series_ref: ref, read: 1, updated_at: 1 };
    }
    const s = liveSync({ chapter_marks: marks });
    expect(clearChapterMarks(s, ref)).toBe(3);
    expect(s.queue[0]).toEqual({ kind: 'chapter.markMany', payload: { seriesRef: ref, read: false, all: true } });
    expect([1, 2, 3].some((n) => read(s, n))).toBe(false);
  });
});
