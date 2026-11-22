/**
 * «نسختي»: كل ما يخصك في ملف واحد على جهازك (المرحلة 1 من خطة «Cloudflare طبقة اختيارية»، قرار المالك 20 نوفمبر).
 *
 * المكتبة والقوائم (المفضلة، لاحقًا، أفضل 5) والمكتمل والتقييمات، وتقدم الفصول وعلاماتها، ومواضع التوقف في الحلقات
 * والأفلام، وإعدادات الحساب، و«إضافاتي» (lib/extensions-transfer.js). الملف يُستعاد على أي جهاز وأي حساب، حتى على
 * خادم آخر لو توقف خادمنا. لا أسرار فيه: لا رمز دخول ولا جلسة ولا كوكيز ولا معرّف حساب.
 *
 * الاستعادة **تضيف ما ينقص ولا تغلب الأحدث**: تمر بعمليات المزامنة المعتادة (`sync.enqueue`) فتبقى قواعد الخادم
 * هي الحَكَم (التقدم لا يرجع، الموضع الأحدث يفوز)، وصف موجود عندك أحدث من الملف لا يُلمس. وتُرسل دفعات صغيرة
 * فلا يمتلئ طابور المزامنة، وإعادتها بعد انقطاع لا تكرر شيئًا.
 */

export const FORMAT = 'vantara.backup';
export const VERSION = 1;
const MAX_BYTES = 32 * 1024 * 1024;
const BATCH = 150;
const COLLECTION_OPS = Object.freeze({ favorite: 'favorite.set', read_later: 'readLater.set', top: 'top.set' });
// إعدادات لا تنتقل بين الأجهزة: أسرار أو ما يخص هذا الجهاز وحده
const PRIVATE_SETTING = /token|secret|password|cookie|session|credential|apikey|api_key|device/i;

const str = (v, max = 600) => (typeof v === 'string' && v ? v.slice(0, max) : null);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function settingsOf(sync, userId) {
  try {
    const data = JSON.parse(sync.row('settings', userId)?.data ?? '{}') ?? {};
    return Object.fromEntries(Object.entries(data).filter(([k]) => !PRIVATE_SETTING.test(k)));
  } catch { return {}; }
}

/** يجمع بيانات الحساب الحالي من مرآة المزامنة (ما يراه التطبيق الآن، بما فيه ما لم يُرسل بعد). */
export async function collectBackup({ sync, extensions = null, platform = 'unknown', now = Date.now } = {}) {
  const userId = sync?.user?.userId;
  if (!userId) throw new Error('سجّل الدخول أولًا: النسخة تُؤخذ من حسابك');
  const mine = (table, keep = () => true) => sync.rows(table, (r) => r.user_id === userId && keep(r)).filter((r) => r.user_id === userId && keep(r));
  const works = new Map(sync.rows('works').map((w) => [w.series_ref, w]));
  const data = {
    library: mine('library', (r) => !Number(r.removed)).map((r) => ({
      seriesRef: r.series_ref, title: str(r.series_title ?? works.get(r.series_ref)?.title, 300), coverUrl: str(r.cover_url ?? works.get(r.series_ref)?.cover_url),
      sourceId: str(r.source_id ?? works.get(r.series_ref)?.source_id, 120), addedAt: num(r.added_at),
    })),
    collections: mine('collections', (r) => Number(r.member) !== 0 && COLLECTION_OPS[r.kind]).map((r) => ({ kind: r.kind, seriesRef: r.series_ref, position: num(r.position) })),
    completions: mine('completions', (r) => Number(r.member) !== 0).map((r) => ({ seriesRef: r.series_ref })),
    ratings: mine('ratings', (r) => num(r.score) != null).map((r) => ({ seriesRef: r.series_ref, score: num(r.score), updatedAt: num(r.updated_at) })),
    progress: mine('progress').map((r) => ({ chapterKey: r.chapter_key, seriesRef: r.series_ref, page: num(r.page) ?? 0, ratio: num(r.ratio) ?? 0, updatedAt: num(r.updated_at) })),
    marks: mine('chapter_marks').map((r) => ({ chapterKey: r.chapter_key, seriesRef: r.series_ref, read: Boolean(Number(r.read)), updatedAt: num(r.updated_at) })),
    positions: mine('playback_positions').map((r) => ({ mediaKey: r.media_key, seriesRef: r.series_ref, positionMs: num(r.position_ms), durationMs: num(r.duration_ms), at: num(r.watched_at) })),
    settings: settingsOf(sync, userId),
  };
  return { format: FORMAT, version: VERSION, exportedAt: now(), platform, data, extensions: extensions ?? null };
}

export const serialize = (doc) => JSON.stringify(doc);
export const fileName = (now = Date.now()) => `vantara-backup-${new Date(now).toISOString().slice(0, 10)}.json`;

const list = (v) => (Array.isArray(v) ? v : []);
/** يقرأ الملف ويتحقق منه بصرامة. يرمي برسالة عربية. */
export function parseBackup(raw) {
  const text = String(raw ?? '');
  if (text.length > MAX_BYTES) throw new Error('الملف أكبر من 32MB؛ ليس نسخة فانتارا');
  let doc;
  try { doc = JSON.parse(text); } catch { throw new Error('الملف ليس JSON صالحًا'); }
  if (doc?.format !== FORMAT) throw new Error('هذا ليس ملف «نسختي» من فانتارا');
  if (!Number.isInteger(doc.version) || doc.version > VERSION) throw new Error('الملف من إصدار أحدث من فانتارا؛ حدّث التطبيق ثم أعد المحاولة');
  const d = doc.data ?? {};
  const ref = (v) => str(v, 200);
  const data = {
    library: list(d.library).filter((x) => ref(x?.seriesRef)).map((x) => ({ seriesRef: ref(x.seriesRef), title: str(x.title, 300), coverUrl: str(x.coverUrl), sourceId: str(x.sourceId, 120), addedAt: num(x.addedAt) })),
    collections: list(d.collections).filter((x) => ref(x?.seriesRef) && COLLECTION_OPS[x?.kind]).map((x) => ({ kind: x.kind, seriesRef: ref(x.seriesRef), position: num(x.position) })),
    completions: list(d.completions).filter((x) => ref(x?.seriesRef)).map((x) => ({ seriesRef: ref(x.seriesRef) })),
    ratings: list(d.ratings).filter((x) => ref(x?.seriesRef) && num(x?.score) != null && x.score >= 0 && x.score <= 10).map((x) => ({ seriesRef: ref(x.seriesRef), score: num(x.score), updatedAt: num(x.updatedAt) })),
    progress: list(d.progress).filter((x) => ref(x?.chapterKey) && ref(x?.seriesRef)).map((x) => ({ chapterKey: ref(x.chapterKey), seriesRef: ref(x.seriesRef), page: Math.max(0, num(x.page) ?? 0), ratio: Math.min(1, Math.max(0, num(x.ratio) ?? 0)), updatedAt: num(x.updatedAt) })),
    marks: list(d.marks).filter((x) => ref(x?.chapterKey) && ref(x?.seriesRef) && typeof x?.read === 'boolean').map((x) => ({ chapterKey: ref(x.chapterKey), seriesRef: ref(x.seriesRef), read: x.read, updatedAt: num(x.updatedAt) })),
    positions: list(d.positions).filter((x) => ref(x?.mediaKey) && ref(x?.seriesRef) && num(x?.positionMs) != null && num(x?.durationMs) > 0 && num(x?.at) > 0).map((x) => ({ mediaKey: ref(x.mediaKey), seriesRef: ref(x.seriesRef), positionMs: num(x.positionMs), durationMs: num(x.durationMs), at: num(x.at) })),
    settings: d.settings && typeof d.settings === 'object' && !Array.isArray(d.settings) ? Object.fromEntries(Object.entries(d.settings).filter(([k]) => typeof k === 'string' && k.length <= 80 && !PRIVATE_SETTING.test(k))) : {},
  };
  return { format: FORMAT, version: doc.version, exportedAt: num(doc.exportedAt), platform: str(doc.platform, 20), data, extensions: doc.extensions && typeof doc.extensions === 'object' ? doc.extensions : null };
}

/** أعداد الملف للعرض قبل الاستعادة. */
export function summary(doc) {
  const d = doc.data;
  return {
    library: d.library.length, lists: d.collections.length + d.completions.length, ratings: d.ratings.length,
    chapters: new Set([...d.progress.map((x) => x.chapterKey), ...d.marks.map((x) => x.chapterKey)]).size,
    positions: d.positions.length, settings: Object.keys(d.settings).length,
  };
}

/**
 * العمليات اللازمة لإضافة ما ينقص هذا الحساب من الملف، بالترتيب: الأوصاف والمكتبة أولًا ثم القوائم ثم التقدم.
 * صف موجود عندك بقيمة أحدث (أو مساوية) لا يُعاد؛ والتقدم يُرسل وقاعدة الخادم (MAX) تحكم.
 */
export function planRestore(doc, sync) {
  const userId = sync?.user?.userId;
  if (!userId) throw new Error('سجّل الدخول أولًا: الاستعادة تكتب في حسابك');
  const d = doc.data;
  const have = (table, key) => sync.row(table, `${userId}/${key}`);
  const ops = [];
  const settings = settingsOf(sync, userId);
  const missingSettings = Object.fromEntries(Object.entries(d.settings).filter(([k]) => !(k in settings)));
  if (Object.keys(missingSettings).length) ops.push(['settings.patch', { fields: missingSettings }]);
  const titles = new Map(d.library.map((x) => [x.seriesRef, x]));
  const describe = (ref) => { const w = titles.get(ref); return w ? { seriesTitle: w.title, coverUrl: w.coverUrl, sourceId: w.sourceId } : {}; };
  for (const x of [...d.library].sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0))) {
    const row = have('library', x.seriesRef);
    if (row && !Number(row.removed)) continue;
    ops.push(['library.add', { seriesRef: x.seriesRef, seriesTitle: x.title, coverUrl: x.coverUrl, sourceId: x.sourceId }]);
  }
  for (const x of [...d.collections].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    const row = sync.row('collections', `${userId}/${x.kind}/${x.seriesRef}`);
    if (row && Number(row.member) !== 0) continue;
    ops.push([COLLECTION_OPS[x.kind], { seriesRef: x.seriesRef, member: true, ...describe(x.seriesRef) }]);
  }
  for (const x of d.completions) {
    const row = have('completions', x.seriesRef);
    if (row && Number(row.member) !== 0) continue;
    ops.push(['completed.set', { seriesRef: x.seriesRef, member: true, ...describe(x.seriesRef) }]);
  }
  for (const x of d.ratings) {
    const row = have('ratings', x.seriesRef);
    if (row && (num(row.updated_at) ?? 0) >= (x.updatedAt ?? 0)) continue;
    ops.push(['rating.set', { seriesRef: x.seriesRef, score: x.score }]);
  }
  // علامات الفصول: عملية واحدة لكل عمل وحالة (chapter.markMany)، لا ألف عملية
  const marks = new Map();
  for (const x of d.marks) {
    const row = have('chapter_marks', x.chapterKey);
    if (row && (num(row.updated_at) ?? 0) >= (x.updatedAt ?? 0)) continue;
    const key = `${x.seriesRef}\n${x.read}`;
    if (!marks.has(key)) marks.set(key, { seriesRef: x.seriesRef, read: x.read, keys: [] });
    marks.get(key).keys.push(x.chapterKey);
  }
  for (const m of marks.values()) for (let i = 0; i < m.keys.length; i += 200) ops.push(['chapter.markMany', { seriesRef: m.seriesRef, read: m.read, keys: m.keys.slice(i, i + 200) }]);
  // التقدم بترتيبه الأصلي (الأقدم أولًا) فيبقى «تابع» على آخر ما قرأته فعلًا
  for (const x of [...d.progress].sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0))) {
    const row = have('progress', x.chapterKey);
    if (row && (num(row.page) ?? 0) >= x.page && (num(row.ratio) ?? 0) >= x.ratio) continue;
    ops.push(['progress.set', { chapterKey: x.chapterKey, seriesRef: x.seriesRef, page: x.page, ratio: x.ratio }]);
  }
  for (const x of d.positions) {
    const row = have('playback_positions', x.mediaKey);
    if (row && (num(row.watched_at) ?? 0) >= x.at) continue;
    ops.push(['position.set', { mediaKey: x.mediaKey, seriesRef: x.seriesRef, positionMs: x.positionMs, durationMs: x.durationMs, at: x.at }]);
  }
  return ops;
}

/**
 * يرسل خطة الاستعادة دفعات: يكتب دفعة في الطابور ثم ينتظر إرسالها قبل التالية. انقطاع الاتصال يوقفها بوضوح،
 * وإعادتها لاحقًا تكمل ما بقي فقط (الخطة تُحسب من جديد ضد ما وصل).
 */
export async function restoreBackup(doc, sync, { onProgress = () => {}, batch = BATCH } = {}) {
  const ops = planRestore(doc, sync);
  const positions = ops.some(([kind]) => kind === 'position.set') && sync.supports?.('position.set') === false;
  const runnable = positions ? ops.filter(([kind]) => kind !== 'position.set') : ops;
  let done = 0;
  onProgress({ done, total: runnable.length });
  for (let i = 0; i < runnable.length; i += batch) {
    for (const [kind, payload] of runnable.slice(i, i + batch)) sync.enqueue(kind, payload, { requireDurable: true });
    await sync.push({ force: true });
    if (sync.pendingWrites >= batch) {
      throw Object.assign(new Error(`توقفت الاستعادة عند ${done} من ${runnable.length}: لا اتصال بالخادم. أعد المحاولة لاحقًا؛ ما استُعيد يبقى ولا يتكرر.`), { code: 'RESTORE_OFFLINE', done, total: runnable.length });
    }
    done = Math.min(runnable.length, i + batch);
    onProgress({ done, total: runnable.length });
  }
  return { restored: done, total: runnable.length, skipped: ops.length - runnable.length };
}
