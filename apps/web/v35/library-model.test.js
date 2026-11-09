import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { PROJECTIONS } from '../lib/optimistic.js';
import { LIBRARY_TABS, libraryShelves, shelfCounts, workRefOf } from './library-model.js';
import { createUnifiedLibrary, progressLabel } from './unified-library.js';
import { readStructure, setUnifyContent, writeStructure } from './experience.js';

const ME = 'me';
/** مزامنة وهمية تطبّق إسقاطات optimistic.js الحقيقية: ما يكتبه التطبيق هو ما يُقرأ. */
function fakeSync(seed = {}) {
  const mirror = {};
  const keyOf = (t, r) => r.id ?? (t === 'collections' ? `${r.user_id}/${r.kind}/${r.series_ref}` : `${r.user_id}/${r.series_ref ?? r.chapter_key}`);
  for (const [t, list] of Object.entries(seed)) { mirror[t] = {}; for (const r of list) mirror[t][keyOf(t, r)] = r; }
  const get = (t, k) => mirror[t]?.[k] ?? null;
  return {
    mirror,
    rows: (t, f) => Object.values(mirror[t] ?? {}).filter(f ?? (() => true)),
    enqueue(kind, payload) {
      for (const { table, key, row } of PROJECTIONS[kind]({ kind, payload, opId: `${kind}${Math.random()}` }, get, ME, mirror) ?? []) (mirror[table] ??= {})[key] = row;
    },
  };
}
const refs = (list) => list.map((x) => x.ref);
const d = (ref, title = ref) => ({ seriesRef: ref, seriesTitle: title, coverUrl: `https://img/${encodeURIComponent(ref)}.jpg` });

describe('نموذج المكتبة المشترك', () => {
  it('التبويبات بأسمائها وترتيبها المعتمد', () => {
    expect(LIBRARY_TABS.map((t) => t.label)).toEqual(['الكل', 'أتابعها', 'آخر المشاهدات', 'لاحقًا', 'المفضلة', 'المكتمل']);
  });

  it('إضافة عمل إلى المكتبة وحذفه، في كل قسم', () => {
    const sync = fakeSync();
    for (const ref of ['al:1', 'anime:21', 'cinema:tt0944947']) sync.enqueue('library.add', d(ref));
    expect(refs(libraryShelves(sync, ME).following).sort()).toEqual(['al:1', 'anime:21', 'cinema:tt0944947']);
    sync.enqueue('library.remove', { seriesRef: 'anime:21' });
    const s = libraryShelves(sync, ME);
    expect(refs(s.following)).not.toContain('anime:21');
    expect(refs(s.all)).not.toContain('anime:21');
  });

  it('«لاحقًا» يظهر في تبويبه الصحيح، والسينما ليست استثناءً (كان محفوظًا بلا تبويب)', () => {
    const sync = fakeSync();
    sync.enqueue('readLater.set', { ...d('cinema:tt1375666'), member: true });
    const cinema = libraryShelves(sync, ME, { section: 'cinema' });
    expect(refs(cinema.later)).toEqual(['cinema:tt1375666']);
    expect(refs(cinema.following)).toEqual([]);
    expect(refs(cinema.all)).toEqual(['cinema:tt1375666']);
    sync.enqueue('readLater.set', { ...d('cinema:tt1375666'), member: false });
    expect(libraryShelves(sync, ME).later).toHaveLength(0);
  });

  it('المفضلة والمكتمل لكل قسم من جدوليهما', () => {
    const sync = fakeSync();
    sync.enqueue('favorite.set', { ...d('anime:5'), member: true });
    sync.enqueue('completed.set', { ...d('cinema:tt0816692'), member: true });
    sync.enqueue('completed.set', { ...d('al:9'), member: true });
    const s = libraryShelves(sync, ME);
    expect(refs(s.favorite)).toEqual(['anime:5']);
    expect(refs(s.completed).sort()).toEqual(['al:9', 'cinema:tt0816692']);
    expect(refs(libraryShelves(sync, ME, { section: 'manga' }).completed)).toEqual(['al:9']);
  });

  it('عدّادات التبويبات تساوي ما يُعرض حرفيًا', () => {
    const sync = fakeSync();
    sync.enqueue('library.add', d('al:1'));
    sync.enqueue('readLater.set', { ...d('al:1'), member: true });
    sync.enqueue('favorite.set', { ...d('anime:2'), member: true });
    sync.enqueue('view.add', { ...d('anime:2'), chapterLabel: 'الحلقة 4', chapterNumber: 4, at: 10 });
    const s = libraryShelves(sync, ME);
    const c = shelfCounts(s);
    for (const t of LIBRARY_TABS) expect(c[t.id]).toBe(s[t.id].length);
    expect(c).toEqual({ all: 2, following: 1, recent: 1, later: 1, favorite: 1, completed: 0 });
  });

  it('موسم المسلسل ومسلسله عمل واحد، وعملان مختلفان لا يُدمجان أبدًا', () => {
    expect(workRefOf('cinema:tt0944947:3')).toBe('cinema:tt0944947');
    const sync = fakeSync();
    sync.enqueue('view.add', { ...d('cinema:tt0944947:2'), chapterLabel: 'S02E03', at: 5 });
    sync.enqueue('view.add', { ...d('cinema:tt0944947:3'), chapterLabel: 'S03E01', at: 9 });
    sync.enqueue('view.add', { ...d('anime:21'), chapterLabel: 'الحلقة 1', at: 7 });
    sync.enqueue('view.add', { ...d('anime:210'), chapterLabel: 'الحلقة 9', at: 8 });
    const recent = libraryShelves(sync, ME).recent;
    expect(refs(recent)).toEqual(['cinema:tt0944947', 'anime:210', 'anime:21']);
    expect(recent[0].view.chapter_label).toBe('S03E01');
    expect(recent.find((x) => x.ref === 'anime:21').view.chapter_label).toBe('الحلقة 1');
    expect(recent.find((x) => x.ref === 'anime:210').view.chapter_label).toBe('الحلقة 9');
  });

  it('صفوف غيري ومحذوفاتي لا تظهر', () => {
    const sync = fakeSync({ library: [{ user_id: 'other', series_ref: 'al:7', removed: 0 }], work_views: [{ user_id: ME, series_ref: 'al:8', removed: 1, viewed_at: 3 }] });
    const s = libraryShelves(sync, ME);
    expect(s.all).toHaveLength(0);
    expect(s.recent).toHaveLength(0);
  });

  it('التقييم يُسجّل ويُحدّث في الجدول الواحد للأنواع الثلاثة', () => {
    const sync = fakeSync();
    for (const ref of ['al:1', 'anime:2', 'cinema:tt3']) sync.enqueue('rating.set', { ...d(ref), score: 6 });
    sync.enqueue('rating.set', { ...d('anime:2'), score: 10 });
    const scores = Object.fromEntries(sync.rows('ratings').map((r) => [r.series_ref, r.score]));
    expect(scores).toEqual({ 'al:1': 6, 'anime:2': 10, 'cinema:tt3': 6 });
  });
});

describe('المكتبة الموحدة (التصميم الرابع)', () => {
  const { document } = parseHTML('<html><body></body></html>');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
  const mount = (sync) => {
    const host = document.createElement('div');
    const opened = [];
    const lib = createUnifiedLibrary({ el, glyph: () => '<svg></svg>', shelves: () => libraryShelves(sync, ME), open: (it) => opened.push(it.ref), discover: () => {}, storage: memory(), now: () => 100 });
    lib.render(host);
    return { host, lib, opened };
  };

  it('تجمع الأقسام الثلاثة، وفلتر النوع يصفّي، والعدّاد يطابق الشبكة', () => {
    const sync = fakeSync();
    for (const ref of ['al:1', 'anime:2', 'cinema:tt3']) sync.enqueue('library.add', d(ref));
    const { host, lib } = mount(sync);
    expect(host.querySelectorAll('.ul-grid .ul-card')).toHaveLength(3);
    const tab = (label) => [...host.querySelectorAll('.ul-types button')].find((b) => b.textContent === label);
    tab('أنمي').onclick();
    expect(host.querySelectorAll('.ul-grid .ul-card')).toHaveLength(1);
    expect(host.querySelector('.ul-shelf.on sup').textContent).toBe('1');
    expect(lib.state.filter).toBe('anime');
  });

  it('تغيير في المكتبة يظهر فورًا، وتعطيل التوحيد وإعادته لا يفقد ولا يكرر', () => {
    const sync = fakeSync();
    sync.enqueue('library.add', d('al:1'));
    const storage = memory();
    const { host, lib } = mount(sync);
    sync.enqueue('readLater.set', { ...d('cinema:tt9'), member: true });
    lib.render(host);
    expect(host.querySelectorAll('.ul-grid .ul-card')).toHaveLength(2);
    // الوضع العادي: كل قسم يرى عمله وحده من الجداول نفسها
    writeStructure(setUnifyContent(readStructure(storage), false), storage);
    expect(refs(libraryShelves(sync, ME, { section: 'cinema' }).later)).toEqual(['cinema:tt9']);
    expect(refs(libraryShelves(sync, ME, { section: 'manga' }).following)).toEqual(['al:1']);
    writeStructure(setUnifyContent(readStructure(storage), true), storage);
    lib.render(host);
    const shown = [...host.querySelectorAll('.ul-grid .ul-card')];
    expect(shown).toHaveLength(2);
  });

  it('«آخر المشاهدات» مرة واحدة في رأس «الكل» بتقدّم كل نوع بلغته', () => {
    const sync = fakeSync();
    sync.enqueue('library.add', d('al:1'));
    sync.enqueue('view.add', { ...d('al:1'), chapterLabel: '48', chapterNumber: 48, at: 50 });
    sync.enqueue('view.add', { ...d('anime:2'), chapterLabel: 'الحلقة 4', chapterNumber: 4, at: 60 });
    const { host, opened } = mount(sync);
    const cards = [...host.querySelectorAll('.ul-peek .ul-recent')];
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('الحلقة 4');
    expect(cards[1].textContent).toContain('الفصل 48');
    cards[0].onclick();
    expect(opened).toEqual(['anime:2']);
    expect(host.querySelectorAll('.ul-sec h2')[0].textContent).toBe('آخر المشاهدات');
  });

  it('التقدّم لا يُخترع: بلا صف مشاهدة لا نص تقدّم', () => {
    expect(progressLabel({ section: 'manga', view: null })).toBe('');
    expect(progressLabel({ section: 'manga', view: { chapter_label: '12' } })).toBe('الفصل 12');
    expect(progressLabel({ section: 'anime', view: { chapter_number: 3 } })).toBe('الحلقة 3');
  });

  it('حالة فراغ لكل تبويب', () => {
    const { host } = mount(fakeSync());
    expect(host.querySelector('.ul-empty strong').textContent).toBe('مكتبتك فاضية');
  });
});

describe('مكتبات الأقسام تستعمل الأسماء الموحدة', () => {
  const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  it('لا «قائمتي» تبويبًا في السينما، و«لاحقًا» و«المكتمل» موجودان، و«المصادر» خارج المكتبة', () => {
    expect(src('./cinema.js')).not.toContain("['later', 'قائمتي']");
    expect(src('./cinema.js')).toContain("later: 'read_later'");
    expect(src('./cinema.js')).toContain("completed: 'completed'");
    expect(src('./anime.js')).not.toContain("[['sources', 'المصادر']]");
    expect(src('./shell.js')).toContain('LIBRARY_TABS.map((t) => [KEY[t.id], t.label])');
  });
});
