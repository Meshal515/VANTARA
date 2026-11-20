/**
 * موضع التوقف داخل الحلقة أو الفيلم بين أجهزتك (ANX1).
 *
 * كان الموضع على الجهاز وحده: شاهدت «ذا أوديسي» ساعتين على جهاز، فيعرف الجهاز الآخر الحلقة من الحساب ويبدأها من
 * أولها، بينما الأول يقول «متبقي ساعة وعشرون دقيقة». الآن الجهاز يقيس الموضع ويحفظه محليًا كما كان، ويرفع الرقم وحده
 * (بالثواني) إلى الحساب في جدول التقدم الموجود (`progress`): لا جدول جديد ولا تحديث للخادم.
 *   - مفتاح الصف: `anime:<id>#ep:<n>` أو `cinema:<id>#s:<season>#e:<n>`، فلا يختلط بفصول المانجا.
 *   - `page` = الثواني، و`ratio` = الموضع ÷ المدة؛ الخادم لا يُرجع الرقم للخلف (MAX).
 *   - يتبع كل رفع إقرار فوري (`progress.confirm`): صف الحلقة لا ينتظر «مالك تقدم المانجا» في صندوقه.
 *   - الجهاز الآخر يأخذ موضع الحساب فقط إن كان أحدث من موضعه المحلي (لا يُبدّل ما شاهدته هنا للتو).
 * الحساب طبقة إضافية: بلا حساب أو بلا خادم يعمل الاستئناف محليًا كما كان تمامًا.
 */

/** أقل فاصل بين رفعين لنفس الحلقة أثناء المشاهدة. الإغلاق يرفع فورًا. */
export const POSITION_EVERY_MS = 20_000;
/** موضع أقل من هذا لا يستحق «تابع من حيث وقفت». */
export const MIN_RESUME_MS = 5_000;

export const animePositionKey = (id, n) => `anime:${id}#ep:${n}`;
export const cinemaPositionKey = (id, season, n) => `cinema:${id}#s:${season ?? 0}#e:${n}`;

/** يرفع مواضع التشغيل إلى الحساب بفاصل، مرة لكل تغيّر حقيقي. */
export function createPositionSync(sync, { now = Date.now } = {}) {
  const sent = new Map();
  return {
    /** @returns {boolean} هل رُفع الآن. */
    record(seriesRef, key, positionMs, durationMs, { final = false } = {}) {
      if (!sync?.user?.userId || typeof sync.enqueue !== 'function') return false;
      if (!(Number(durationMs) > 0) || !(Number(positionMs) >= MIN_RESUME_MS)) return false;
      const at = now();
      const page = Math.floor(Number(positionMs) / 1000);
      const prev = sent.get(key);
      if (prev && prev.page === page) return false;
      if (!final && prev && at - prev.at < POSITION_EVERY_MS) return false;
      sent.set(key, { at, page });
      const ratio = Math.min(1, Math.max(0, Number(positionMs) / Number(durationMs)));
      sync.enqueue('progress.set', { chapterKey: key, seriesRef, page, ratio });
      sync.enqueue('progress.confirm', { chapterKey: key, page });
      return true;
    },
  };
}

/**
 * مواضع الحساب لعمل: `Map<مفتاح الحلقة المحلي, { position, duration, at }>`.
 * `localKey` يحوّل مفتاح الصف إلى مفتاح سجل الجهاز (`n` للأنمي، `season:n` للسينما) أو null.
 */
export function accountPositions(sync, seriesRef, localKey) {
  const me = sync?.user?.userId;
  const out = new Map();
  if (!me || typeof sync.rows !== 'function') return out;
  for (const row of sync.rows('progress', (r) => r.user_id === me && r.series_ref === seriesRef)) {
    const key = localKey(String(row.chapter_key ?? ''));
    const seconds = Number(row.page);
    if (key == null || !(seconds > 0)) continue;
    const ratio = Number(row.ratio);
    const position = seconds * 1000;
    out.set(key, { position, duration: ratio > 0 ? Math.round(position / ratio) : 0, at: Number(row.updated_at) || 0 });
  }
  return out;
}

export const animeLocalKey = (id) => {
  const prefix = `anime:${id}#ep:`;
  return (key) => (key.startsWith(prefix) && /^\d+(\.\d+)?$/.test(key.slice(prefix.length)) ? key.slice(prefix.length) : null);
};
export const cinemaLocalKey = (id) => {
  const rule = new RegExp(`^cinema:${String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}#s:(\\d+)#e:(\\d+)$`);
  return (key) => { const m = rule.exec(key); return m ? `${m[1]}:${m[2]}` : null; };
};

/**
 * سجل مشاهدة الجهاز لعمل، وفوقه مواضع الحساب الأحدث منه. لا يمس ما في التخزين: نسخة للعرض والاستئناف فقط.
 * حلقة مكتملة هنا تبقى مكتملة؛ وأحدث حلقة في الحساب تصير «آخر حلقة» إن كانت أحدث من آخر مشاهدة هنا.
 */
export function withAccountPositions(watch, remote, { lastOf = (key) => ({ episode: Number(key) }) } = {}) {
  if (!remote?.size) return watch;
  const base = watch ?? { episodes: {} };
  const episodes = { ...(base.episodes ?? {}) };
  let latest = Number(base.at) || 0;
  let last = null;
  for (const [key, r] of remote) {
    const mine = episodes[key];
    if (mine?.done) continue;
    const mineAt = Number(mine?.at) || 0;
    if (mine && mineAt >= r.at) continue;
    episodes[key] = { ...mine, position: r.position, duration: r.duration || Number(mine?.duration) || 0, at: r.at, done: Boolean(mine?.done) };
    if (r.at > latest) { latest = r.at; last = key; }
  }
  if (last == null) return { ...base, episodes };
  return { ...base, episodes, at: latest, ...lastOf(last) };
}

/**
 * سجل الجهاز لكل أعمال القسم، وفوقه مواضع الحساب الأحدث. عمل لم يُشغَّل على هذا الجهاز أبدًا يأخذ سجلًا من الحساب
 * (هذه حالة «ذا أوديسي» على الجهاز الثاني). `section` = 'anime' أو 'cinema'.
 */
export function overlayAllPositions(all, sync, section) {
  const me = sync?.user?.userId;
  if (!me || typeof sync?.rows !== 'function') return all;
  const prefix = `${section}:`;
  const groups = new Map();
  for (const row of sync.rows('progress', (r) => r.user_id === me && String(r.series_ref ?? '').startsWith(prefix))) {
    const id = String(row.series_ref).slice(prefix.length);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  if (!groups.size) return all;
  const out = { ...all };
  for (const [id, rows] of groups) {
    const localKey = section === 'anime' ? animeLocalKey(id) : cinemaLocalKey(id);
    const remote = new Map();
    for (const row of rows) {
      const key = localKey(String(row.chapter_key ?? ''));
      const seconds = Number(row.page);
      if (key == null || !(seconds > 0)) continue;
      const ratio = Number(row.ratio);
      const position = seconds * 1000;
      remote.set(key, { position, duration: ratio > 0 ? Math.round(position / ratio) : 0, at: Number(row.updated_at) || 0 });
    }
    if (!remote.size) continue;
    const lastOf = section === 'anime'
      ? (key) => ({ episode: Number(key) })
      : (key) => { const [s, n] = key.split(':').map(Number); return { season: s || null, episode: n }; };
    const key = Object.keys(all ?? {}).find((k) => String(k) === id) ?? id;
    // عمل بلا سجل هنا: `_remoteOnly` (بلا عنوان ولا غلاف بعد)، فلا يُرسم بطاقة من هذا السجل وحده؛ «تابع المشاهدة»
    // يأخذ بطاقته من الحساب (work_views) ومعها هذا الموضع
    const fresh = { id: section === 'anime' && /^\d+$/.test(id) ? Number(id) : id, episodes: {}, _remoteOnly: true };
    out[key] = withAccountPositions(all?.[key] ?? fresh, remote, { lastOf });
  }
  return out;
}
