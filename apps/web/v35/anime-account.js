/**
 * الأنمي في حسابك — نفس جداول المانجا بمرجع `anime:<AniList id>`، لا نظام موازٍ.
 *
 *   قائمتي (أتابعه)   → library.add / library.remove
 *   شاهد لاحقًا      → readLater.set   (collections: read_later)
 *   المفضلة          → favorite.set    (collections: favorite)
 *   أكملته           → completed.set
 *   عين الحلقة       → chapter.mark / chapter.markMany  (مفتاح `anime:<id>#ep:<n>`)
 *   آخر المشاهدات    → view.add (بعنوان «الحلقة N»)
 *
 * فتصل لكل أجهزتك، وتظهر في ملفك الشخصي وعند أصدقائك مثل المانجا تمامًا. سجل
 * الجهاز القديم (قائمتي، الحلقات المشاهدة) يُرحَّل مرة واحدة.
 */

const MIGRATED_KEY = 'vantara.anime.account.v1';

export const animeRef = (id) => `anime:${id}`;
export const episodeKey = (id, n) => `anime:${id}#ep:${n}`;
export const isAnimeRef = (ref) => typeof ref === 'string' && ref.startsWith('anime:');

export function createAnimeAccount(sync) {
  const me = () => sync.user?.userId;
  const descriptor = (m) => ({ seriesRef: animeRef(m.id), seriesTitle: m.title ?? null, coverUrl: m.posterSmall ?? m.poster ?? null });
  const pending = new Map();

  const inLibrary = (id) => sync.rows('library', (r) => r.user_id === me() && r.series_ref === animeRef(id) && !r.removed).length > 0;
  const inCollection = (kind, id) => sync.rows('collections', (r) => r.user_id === me() && r.kind === kind && r.series_ref === animeRef(id) && r.member).length > 0;
  const isCompleted = (id) => sync.rows('completions', (r) => r.user_id === me() && r.series_ref === animeRef(id) && r.member).length > 0;

  function setLibrary(m, on) {
    sync.enqueue(on ? 'library.add' : 'library.remove', on ? descriptor(m) : { seriesRef: animeRef(m.id) });
    return on;
  }
  function setCollection(kind, m, on) {
    sync.enqueue(kind === 'favorite' ? 'favorite.set' : 'readLater.set', { ...descriptor(m), member: on });
    return on;
  }
  function setCompleted(m, on) {
    sync.enqueue('completed.set', { ...descriptor(m), member: on });
    return on;
  }

  /** «شوهدت» من الحساب (مع ما لم يرجع به الخادم بعد). */
  function isSeen(id, n) {
    const key = episodeKey(id, n);
    // الطبقة المتفائلة في `sync.row` تحمل ما لم يرجع به الخادم بعد
    if (typeof sync.row === 'function') return Boolean(sync.row('chapter_marks', `${me()}/${key}`)?.read);
    if (pending.has(key)) return pending.get(key);
    return sync.rows('chapter_marks', (r) => r.user_id === me() && r.chapter_key === key && r.read).length > 0;
  }
  function seenCount(id) {
    return sync.rows('chapter_marks', (r) => r.user_id === me() && r.series_ref === animeRef(id) && r.read).length;
  }

  /** من ← إلى (شاملًا): عملية واحدة مهما كثرت الحلقات. يرجع كم تغيّر. */
  function markRange(m, from, to, seen) {
    const lo = Math.max(1, Math.min(from, to));
    const hi = Math.max(from, to);
    const keys = [];
    for (let n = lo; n <= hi; n++) if (isSeen(m.id, n) !== seen) keys.push(episodeKey(m.id, n));
    if (!keys.length) return 0;
    for (const k of keys) pending.set(k, seen);
    for (let i = 0; i < keys.length; i += 2000) sync.enqueue('chapter.markMany', { seriesRef: animeRef(m.id), keys: keys.slice(i, i + 2000), read: seen });
    return keys.length;
  }
  function markEpisode(m, n, seen) {
    const key = episodeKey(m.id, n);
    pending.set(key, seen);
    sync.enqueue('chapter.mark', { seriesRef: animeRef(m.id), chapterKey: key, read: seen });
  }
  function clearAll(m) {
    for (const r of sync.rows('chapter_marks', (x) => x.user_id === me() && x.series_ref === animeRef(m.id) && x.read)) pending.set(r.chapter_key, false);
    sync.enqueue('chapter.markMany', { seriesRef: animeRef(m.id), read: false, all: true });
  }

  /** «آخر المشاهدات»: مرة لكل حلقة في الجلسة، لا مع كل ثانية تشغيل. */
  const viewed = new Set();
  function recordView(m, episode) {
    const k = `${m.id}:${episode}`;
    if (viewed.has(k)) return;
    viewed.add(k);
    sync.enqueue('view.add', { ...descriptor(m), chapterLabel: `الحلقة ${episode}`, chapterNumber: episode });
  }

  /** أعمال الأنمي في رف من رفوف الحساب، الأحدث أولًا. */
  function shelf(kind) {
    const refs =
      kind === 'library'
        ? sync.rows('library', (r) => r.user_id === me() && !r.removed && isAnimeRef(r.series_ref)).map((r) => r.series_ref)
        : kind === 'completed'
          ? sync.rows('completions', (r) => r.user_id === me() && r.member && isAnimeRef(r.series_ref)).map((r) => r.series_ref)
          : sync.rows('collections', (r) => r.user_id === me() && r.kind === kind && r.member && isAnimeRef(r.series_ref)).map((r) => r.series_ref);
    const viewAt = (ref) => sync.rows('work_views', (v) => v.user_id === me() && v.series_ref === ref)[0]?.viewed_at ?? 0;
    return [...new Set(refs)]
      .sort((a, b) => viewAt(b) - viewAt(a))
      .map((ref) => {
        const w = sync.rows('works', (x) => x.series_ref === ref)[0];
        const v = sync.rows('work_views', (x) => x.user_id === me() && x.series_ref === ref)[0];
        const id = Number(ref.slice(6));
        const cover = w?.cover_url ?? v?.cover_url ?? null;
        return { id, title: w?.title ?? v?.series_title ?? `#${id}`, poster: cover, posterSmall: cover };
      });
  }

  /**
   * ترحيل سجل الجهاز القديم مرة واحدة: «قائمتي» المحلية → مكتبتك، والحلقات
   * المشاهدة → عين الحلقة، وآخر ما شاهدت → «آخر المشاهدات».
   */
  function migrate({ list, watch }) {
    if (!me()) return;
    try {
      if (localStorage.getItem(MIGRATED_KEY) === me()) return;
    } catch {
      return;
    }
    for (const m of Object.values(list ?? {})) if (m?.id && !inLibrary(m.id)) setLibrary(m, true);
    for (const w of Object.values(watch ?? {})) {
      if (!w?.id) continue;
      const done = Object.entries(w.episodes ?? {}).filter(([, e]) => e?.done).map(([n]) => episodeKey(w.id, Number(n)));
      if (done.length) sync.enqueue('chapter.markMany', { seriesRef: animeRef(w.id), keys: done.slice(0, 2000), read: true });
      if (w.episode) sync.enqueue('view.add', { seriesRef: animeRef(w.id), seriesTitle: w.title ?? null, coverUrl: w.poster ?? null, chapterLabel: `الحلقة ${w.episode}`, chapterNumber: w.episode, at: w.at ?? Date.now() });
    }
    try {
      localStorage.setItem(MIGRATED_KEY, me());
    } catch {
      // يُعاد في المرة الجاية: العمليات نفسها لا تكرر شيئًا
    }
  }

  return { descriptor, inLibrary, inCollection, isCompleted, setLibrary, setCollection, setCompleted, isSeen, seenCount, markRange, markEpisode, clearAll, recordView, shelf, migrate };
}
