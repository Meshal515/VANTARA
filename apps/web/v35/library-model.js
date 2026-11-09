/**
 * «مكتبتي» واحدة في دلالتها للأقسام الثلاثة (قرار المالك، 9 نوفمبر): التبويبات نفسها بأسمائها وترتيبها،
 * والعدّادات من مصدر واحد. التصميم يبقى لكل قسم، والمكتبة الموحدة تصميم رابع فوق هذا النموذج نفسه.
 *
 * لا ترحيل ولا جداول جديدة: الأقسام تكتب أصلًا في الجداول نفسها، ويميّزها `series_ref`
 * (`anime:<id>`، `cinema:<tt>[:موسم]`، والمانجا بلا بادئة):
 *   library ← أتابعها · collections.read_later ← لاحقًا · collections.favorite ← المفضلة ·
 *   completions ← المكتمل · work_views ← آخر المشاهدات.
 * فتشغيل «توحيد المحتوى» أو إيقافه عرضٌ فقط، والتغيير في أحدهما يظهر في الآخر فورًا.
 */

import { sectionOfRef } from './anime-account.js';

export const LIBRARY_TABS = Object.freeze([
  Object.freeze({ id: 'all', label: 'الكل' }),
  Object.freeze({ id: 'following', label: 'أتابعها' }),
  Object.freeze({ id: 'recent', label: 'آخر المشاهدات' }),
  Object.freeze({ id: 'later', label: 'لاحقًا' }),
  Object.freeze({ id: 'favorite', label: 'المفضلة' }),
  Object.freeze({ id: 'completed', label: 'المكتمل' }),
]);
export const tabLabel = (id) => LIBRARY_TABS.find((t) => t.id === id)?.label ?? '';

export const LIBRARY_FILTERS = Object.freeze([['all', 'الكل'], ['manga', 'مانجا'], ['anime', 'أنمي'], ['cinema', 'سينما']]);

/** المرجع القانوني للعمل: موسم السينما (`cinema:tt…:2`) عمل واحد مع مسلسله. */
export const workRefOf = (ref) => {
  const s = String(ref ?? '');
  return s.startsWith('cinema:') ? s.split(':').slice(0, 2).join(':') : s;
};

/**
 * رفوف المكتبة من الجداول المشتركة.
 * @param {{ rows: (t: string, f?: Function) => any[] }} sync
 * @param {string} userId
 * @param {{ section?: 'all'|'manga'|'anime'|'cinema', qualifiesView?: (row: any) => boolean }} [opts]
 * @returns {Record<'all'|'following'|'recent'|'later'|'favorite'|'completed', LibraryItem[]>}
 *
 * @typedef {{ ref: string, section: 'manga'|'anime'|'cinema', title: string|null, cover: string|null, at: number,
 *   view: any|null }} LibraryItem
 */
export function libraryShelves(sync, userId, { section = 'all', qualifiesView = () => true } = {}) {
  const inSection = (ref) => section === 'all' || sectionOfRef(ref) === section;
  const mine = (r) => r.user_id === userId && inSection(r.series_ref);
  const works = new Map();
  for (const w of sync.rows('works') ?? []) if (w?.series_ref) works.set(workRefOf(w.series_ref), w);
  const views = new Map();
  for (const v of sync.rows('work_views', (r) => mine(r) && !r.removed) ?? []) {
    const ref = workRefOf(v.series_ref);
    const prev = views.get(ref);
    if (!prev || (v.viewed_at ?? 0) > (prev.viewed_at ?? 0)) views.set(ref, v);
  }

  const items = new Map();
  const item = (ref, row, at) => {
    const key = workRefOf(ref);
    const prev = items.get(key);
    const w = works.get(key);
    const v = views.get(key);
    const next = {
      ref: key,
      section: sectionOfRef(key),
      title: prev?.title ?? row?.series_title ?? w?.title ?? v?.series_title ?? null,
      cover: prev?.cover ?? row?.cover_url ?? w?.cover_url ?? v?.cover_url ?? null,
      at: Math.max(prev?.at ?? 0, at ?? 0, v?.viewed_at ?? 0),
      view: v ?? null,
    };
    items.set(key, next);
    return next;
  };
  /** رف واحد: كل عمل مرة واحدة، الأحدث نشاطًا أولًا. */
  const shelf = (list, atOf) => {
    const seen = new Map();
    for (const r of list) {
      const key = workRefOf(r.series_ref);
      const at = atOf(r) ?? 0;
      if (!seen.has(key) || at > seen.get(key).at) seen.set(key, { r, at });
    }
    return [...seen.values()].map(({ r, at }) => item(r.series_ref, r, at)).map((x) => x.ref);
  };

  const following = shelf(sync.rows('library', (r) => mine(r) && !r.removed) ?? [], (r) => r.added_at);
  const col = (kind) => shelf(sync.rows('collections', (r) => mine(r) && r.kind === kind && r.member) ?? [], (r) => r.updated_at);
  const later = col('read_later');
  const favorite = col('favorite');
  const completed = shelf(sync.rows('completions', (r) => mine(r) && r.member) ?? [], (r) => r.updated_at);
  const recent = [...views.values()].filter((v) => qualifiesView(v)).map((v) => item(v.series_ref, v, v.viewed_at).ref);

  const byAt = (refs) => [...new Set(refs)].map((ref) => items.get(ref)).filter(Boolean).sort((a, b) => b.at - a.at);
  return {
    all: byAt([...following, ...later, ...favorite, ...completed]),
    following: byAt(following),
    recent: byAt(recent).sort((a, b) => (b.view?.viewed_at ?? 0) - (a.view?.viewed_at ?? 0)),
    later: byAt(later),
    favorite: byAt(favorite),
    completed: byAt(completed),
  };
}

/** عدد كل تبويب: هو طول ما يُعرض فيه حرفيًا (لا عدّاد يختلف عن الشبكة). */
export const shelfCounts = (shelves) => Object.fromEntries(LIBRARY_TABS.map((t) => [t.id, shelves[t.id]?.length ?? 0]));

/** حالات الفراغ بنص واحد لكل تبويب. */
export const EMPTY_COPY = Object.freeze({
  all: ['مكتبتك فاضية', 'المس «أتابعها» في قائمة ⋮ بصفحة أي عمل، ويظهر هنا على أجهزتك كلها.'],
  following: ['ما تتابع شي الحين', 'من قائمة ⋮ في صفحة العمل اختر «أتابعها».'],
  recent: ['لا مشاهدات بعد', 'ما تبدأ قراءته أو مشاهدته يظهر هنا لتكمله من حيث وقفت.'],
  later: ['القائمة فاضية', 'من قائمة ⋮ في صفحة العمل اختر «لاحقًا».'],
  favorite: ['ما عندك مفضلة', 'القلب في صفحة العمل يضيفه هنا.'],
  completed: ['ما أكملت شي بعد', 'من «خيارات أخرى» في قائمة ⋮ اختر «علّمه مكتملًا».'],
});
