/**
 * موضع التوقف داخل الحلقة أو الفيلم بين أجهزتك (ANX1).
 *
 * كان الموضع على الجهاز وحده: شاهدت «ذا أوديسي» ساعتين على جهاز، فيعرف الجهاز الآخر الحلقة من الحساب ويبدأها من
 * أولها، بينما الأول يقول «متبقي ساعة وعشرون دقيقة». الآن:
 *   - الجهاز يقيس الموضع ويحفظه محليًا كما كان (الأساس، يعمل بلا حساب ولا خادم).
 *   - ويرفع الرقم وحده إلى جدول مستقل `playback_positions` (لا جدول تقدم المانجا): لا يختلط بإحصائيات المانجا ولا
 *     بصندوق «مالك التقدم».
 *   - **الأحدث بوقت القياس يفوز، لا الأكبر:** من أعاد الحلقة من بدايتها يجد البداية على أجهزته الأخرى.
 *   - لا يُرفع شيء قبل 30 ثانية مشاهدة فعلية في الجلسة: فتح المشغّل وإغلاقه لا يمحو موضعك على جهاز آخر.
 *   - الجهاز الآخر يأخذ موضع الحساب فقط إن كان قياسه أحدث من آخر قياس هنا.
 *   - لا يُرسل حتى يعلن الخادم دعمه (`sync.supports('position.set')`): خادم أقدم كان سيعزل العملية فتضيع.
 */

/** مشاهدة فعلية في الجلسة قبل أول رفع: فتح المشغّل وإغلاقه لا يمس موضعك على أجهزتك الأخرى. */
export const MIN_SESSION_MS = 30_000;
/** أقل فاصل بين رفعين لنفس الحلقة أثناء المشاهدة. الإغلاق يرفع فورًا. */
export const POSITION_EVERY_MS = 20_000;
export const FEATURE = 'position.set';

export const animePositionKey = (id, n) => `anime:${id}#ep:${n}`;
export const cinemaPositionKey = (id, season, n) => `cinema:${id}#s:${season ?? 0}#e:${n}`;

/**
 * يرفع مواضع التشغيل إلى الحساب. `played(key, ms)` يُنادى بزمن التشغيل الفعلي المتقدم (لا قفزات) لعدّ الجلسة،
 * و`record` بموضع كل حدث تشغيل.
 */
export function createPositionSync(sync, { now = Date.now } = {}) {
  const sent = new Map();
  const session = new Map();
  const ready = () => Boolean(sync?.user?.userId) && typeof sync.enqueue === 'function' && sync.supports?.(FEATURE) === true;
  return {
    /** تشغيل فعلي تقدّم بهذا القدر (ms) في الحلقة؛ القفزات (أكثر من 15 ث) والرجوع لا تُعد. */
    played(key, ms) {
      if (ms > 0 && ms <= 15_000) session.set(key, (session.get(key) ?? 0) + ms);
    },
    /** @returns {boolean} هل رُفع الآن. */
    record(seriesRef, key, positionMs, durationMs, { final = false } = {}) {
      if (!ready() || !(Number(durationMs) > 0) || !(Number(positionMs) >= 0)) return false;
      if ((session.get(key) ?? 0) < MIN_SESSION_MS) return false;
      const at = now();
      const second = Math.floor(Number(positionMs) / 1000);
      const prev = sent.get(key);
      if (prev && prev.second === second) return false;
      if (!final && prev && at - prev.at < POSITION_EVERY_MS) return false;
      sent.set(key, { at, second });
      sync.enqueue('position.set', { mediaKey: key, seriesRef, positionMs: Math.round(Number(positionMs)), durationMs: Math.round(Number(durationMs)), at });
      return true;
    },
    /** المشغّل أُغلق: الجلسة التالية تبدأ عدّها من الصفر. */
    end(key) { session.delete(key); sent.delete(key); },
  };
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
 * سجل مشاهدة الجهاز لعمل، وفوقه مواضع الحساب التي قِيست **بعد** آخر قياس هنا. لا يمس التخزين: نسخة للعرض والاستئناف.
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
    if (mine && (Number(mine.at) || 0) >= r.at) continue;
    episodes[key] = { ...mine, position: r.position, duration: r.duration || Number(mine?.duration) || 0, at: r.at, done: false };
    if (r.at > latest) { latest = r.at; last = key; }
  }
  if (last == null) return { ...base, episodes };
  return { ...base, episodes, at: latest, ...lastOf(last) };
}

/**
 * سجل الجهاز لكل أعمال القسم، وفوقه مواضع الحساب الأحدث. عمل لم يُشغَّل على هذا الجهاز أبدًا يأخذ سجلًا من الحساب
 * بعلامة `_remoteOnly` (حالة «ذا أوديسي» على الجهاز الثاني). `section` = 'anime' أو 'cinema'.
 */
export function overlayAllPositions(all, sync, section) {
  const me = sync?.user?.userId;
  if (!me || typeof sync?.rows !== 'function') return all;
  const prefix = `${section}:`;
  const groups = new Map();
  for (const row of sync.rows('playback_positions', (r) => r.user_id === me && String(r.series_ref ?? '').startsWith(prefix))) {
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
      const key = localKey(String(row.media_key ?? ''));
      const position = Number(row.position_ms);
      if (key == null || !(position >= 0)) continue;
      remote.set(key, { position, duration: Number(row.duration_ms) || 0, at: Number(row.watched_at) || 0 });
    }
    if (!remote.size) continue;
    const lastOf = section === 'anime'
      ? (key) => ({ episode: Number(key) })
      : (key) => { const [s, n] = key.split(':').map(Number); return { season: s, episode: n }; };
    const key = Object.keys(all ?? {}).find((k) => String(k) === id) ?? id;
    const fresh = { id: section === 'anime' && /^\d+$/.test(id) ? Number(id) : id, episodes: {}, _remoteOnly: true };
    out[key] = withAccountPositions(all?.[key] ?? fresh, remote, { lastOf });
  }
  return out;
}
