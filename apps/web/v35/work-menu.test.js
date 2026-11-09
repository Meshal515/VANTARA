import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { libraryLabel, workKind, workMenuEntries, workOptionEntries } from './work-menu.js';

const ids = (list) => list.map((x) => x.id);
const label = (list, id) => list.find((x) => x.id === id)?.label;
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

describe('قائمة ⋮ موحدة للأقسام الثلاثة', () => {
  it('الترتيب نفسه في المانجا والأنمي والمسلسلات', () => {
    const order = ['library', 'later', 'mark', 'previous', 'top', 'options'];
    for (const kind of ['manga', 'anime', 'series']) expect(ids(workMenuEntries(kind, {}))).toEqual(order);
  });

  it('«أتابعها» قبل الحفظ و«في مكتبتي» بعده: حالة library واحدة لا إجراءان', () => {
    expect(libraryLabel(false)).toBe('أتابعها');
    expect(libraryLabel(true)).toBe('في مكتبتي');
    for (const kind of ['manga', 'anime', 'series', 'movie']) {
      expect(label(workMenuEntries(kind, { library: false }), 'library')).toBe('أتابعها');
      const on = workMenuEntries(kind, { library: true }).find((x) => x.id === 'library');
      expect([on.label, on.pressed]).toEqual(['في مكتبتي', true]);
    }
  });

  it('علّم الفصول للمانجا، وعلّم الحلقات للأنمي والمسلسل، ولا شيء للفيلم', () => {
    expect(label(workMenuEntries('manga'), 'mark')).toBe('علّم الفصول');
    expect(label(workMenuEntries('anime'), 'mark')).toBe('علّم الحلقات');
    expect(label(workMenuEntries('series'), 'mark')).toBe('علّم الحلقات');
    expect(ids(workMenuEntries('movie'))).not.toContain('mark');
    expect(workMenuEntries('movie').some((x) => /حلق/.test(x.label))).toBe(false);
  });

  it('قرأته سابقًا للمانجا، وشاهدته سابقًا للأنمي والسينما، بحالته', () => {
    expect(label(workMenuEntries('manga'), 'previous')).toBe('قرأته سابقًا');
    for (const k of ['anime', 'series', 'movie']) expect(label(workMenuEntries(k), 'previous')).toBe('شاهدته سابقًا');
    expect(workMenuEntries('movie', { previous: true }).find((x) => x.id === 'previous').pressed).toBe(true);
  });

  it('أفضل 5 بالاسم نفسه وحالته في الأقسام كلها، والترجمة للمانجا وحدها', () => {
    for (const k of ['manga', 'anime', 'series', 'movie']) {
      expect(label(workMenuEntries(k, { top: false }), 'top')).toBe('أفضل 5');
      expect(label(workMenuEntries(k, { top: true }), 'top')).toBe('في أفضل 5');
    }
    const tr = { available: true, on: false };
    expect(ids(workMenuEntries('manga', { translate: tr }))).toContain('translate');
    expect(ids(workMenuEntries('anime', { translate: tr }))).not.toContain('translate');
  });

  it('لا «مشاركة» في أي قائمة', () => {
    for (const k of ['manga', 'anime', 'series', 'movie']) expect(workMenuEntries(k, { library: true, later: true }).some((x) => /مشارك|share/i.test(`${x.id}${x.label}`))).toBe(false);
  });

  it('خارج الحساب: ما يحتاج الحساب لا يظهر', () => {
    expect(ids(workMenuEntries('anime', { signedIn: false }))).toEqual(['library', 'mark', 'previous']);
  });

  it('النوع من القسم: الفيلم وحده بلا حلقات', () => {
    expect(workKind('manga')).toBe('manga');
    expect(workKind('anime')).toBe('anime');
    expect(workKind('anime', { movie: true })).toBe('movie');
    expect(workKind('cinema')).toBe('series');
    expect(workKind('cinema', { movie: true })).toBe('movie');
  });

  it('خيارات أخرى: التقييم وأكملته بحالتهما، والحذف حيث يوجد', () => {
    expect(workOptionEntries({ rating: 0, completed: false }).map((x) => x.label)).toEqual(['قيّم العمل', 'علّمه مكتملًا']);
    const on = workOptionEntries({ rating: 4, completed: true, canReport: true, canDelete: true });
    expect(on.map((x) => x.id)).toEqual(['rate', 'completed', 'report', 'delete']);
    expect(on[0]).toMatchObject({ label: 'تقييمك 4 من 5 — غيّره', pressed: true });
    expect(on[1].pressed).toBe(true);
  });
});

describe('صفحات العمل تستعمل القائمة الموحدة، وبلا زر مشاركة', () => {
  it('الأقسام الثلاثة تبني ⋮ من workMenuEntries', () => {
    expect(src('./shell.js')).toContain("workMenuEntries('manga'");
    expect(src('./anime.js')).toContain('workMenuEntries(kind');
    expect(src('./cinema.js')).toContain('workMenuEntries(kind');
  });
  it('لا مشاركة خارجية من صفحة العمل في أي قسم', () => {
    expect(src('./shell.js')).not.toContain('shareWorkOut');
    expect(src('./anime.js')).not.toMatch(/tool\([^)]*'شارك'/);
    expect(src('./cinema.js')).not.toMatch(/tool\('share'/);
    expect(src('./anime.js')).not.toContain("'قائمتي';\n    const inMine");
  });
});
