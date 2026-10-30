/**
 * صلاحية رابط المشاهدة وترتيب «شغّل الأفضل» — مصدر الحقيقة الواحد للأنمي والسينما والويندوز.
 *
 * ثلاث حالات فقط، ولا تختلط (route-validity.test.js):
 *   صالح      — فُحص الرابط فعلًا وأعاد وسائط (مباشر: probed === true)، أو تورنت محركه جاهز على هذا
 *               الجهاز وسربه معلن بمشاركين > 0. لا شيء غير هذا يُسمّى صالحًا.
 *   قيد الفحص — يُستخرج الرابط أو يُفحص الآن، أو جاهز للتجربة بلا دليل بعد (لم يُفحص، أو تورنت بلا
 *               عدد مشاركين معلن). لا يدخل «شغّل الأفضل»؛ المستخدم يقدر يلمسه فيجرّبه بنفسه.
 *   غير متاح  — فشل الاستخراج أو الفحص، أو انتهت صلاحيته، أو تورنت بلا مشاركين/بلا محرك.
 *               لا يُختار أبدًا، ولسببه جملة عربية صادقة.
 *
 * «شغّل الأفضل» يختار من الصالح وحده، والصلاحية شرط دخول لا معيار ترتيب. الترتيب بجدول معايير
 * معلن (RANK_CRITERIA) يطبّق على كل الأنواع (مباشر، تورنت، مستخرجات) بالأوزان نفسها.
 */
import { parseRelease } from '../addons/release-info.js';
import { FAIL_MS, knownStart, startFeatures } from './start-memory.js';

export const VALIDITY = Object.freeze({ VALID: 'VALID', CHECKING: 'CHECKING', UNAVAILABLE: 'UNAVAILABLE' });
export const VALIDITY_AR = Object.freeze({ VALID: 'صالح', CHECKING: 'قيد الفحص', UNAVAILABLE: 'غير متاح' });

const isTorrent = (r) => r?.runtimeReady != null || r?.type === 'torrent' || Boolean(r?.infoHash || r?.magnet);

function seedersOf(r) {
  if (Number.isFinite(r?.seeders)) return r.seeders;
  const label = r?.label;
  if (!label) return null;
  const info = parseRelease(r.sourceName ?? r.server ?? '', label);
  return Number.isFinite(info?.seeders) ? info.seeders : null;
}

/**
 * حالة الرابط وسببها: `{ state, reason }`. `reason` جملة عربية لغير المتاح فقط.
 * `now` للاختبار (انتهاء صلاحية الروابط المؤقتة).
 */
export function validity(r, { now = Date.now() } = {}) {
  if (!r) return { state: VALIDITY.UNAVAILABLE, reason: 'لا رابط' };
  if (r.state === 'UNAVAILABLE' || r.state === 'FAILED' || r.probed === false)
    return { state: VALIDITY.UNAVAILABLE, reason: failureText(r.reason) };
  // رقم = ميلي ثانية؛ نص = تاريخ ISO (Date.parse('1000') كان يقرأ الرقم سنةً فلا ينتهي أبدًا)
  const expires = typeof r.expiresAt === 'number' ? r.expiresAt : Date.parse(r.expiresAt ?? '');
  if (Number.isFinite(expires) && expires > 0 && expires <= now)
    return { state: VALIDITY.UNAVAILABLE, reason: FAILURES.SESSION.text };
  if (r.state === 'RESOLVING') return { state: VALIDITY.CHECKING, reason: null };
  if (isTorrent(r)) {
    if (r.runtimeReady == null) return { state: VALIDITY.CHECKING, reason: null };
    if (r.runtimeReady === false) return { state: VALIDITY.UNAVAILABLE, reason: 'محرك التورنت غير متاح على هذا الجهاز' };
    const seeds = seedersOf(r);
    // بلا عدد معلن لا دليل أنه يعمل ولا أنه ميت: لم يُحكم عليه بعد. يبقى خارج «شغّل الأفضل»،
    // ولمسه اختيار صريح من المستخدم يجرّبه فعلًا (روابط إضافات الويندوز المباشرة مثلًا)
    if (seeds == null) return { state: VALIDITY.CHECKING, reason: null };
    if (seeds <= 0) return { state: VALIDITY.UNAVAILABLE, reason: 'لا مشاركين في هذا التورنت الآن' };
    return { state: VALIDITY.VALID, reason: null };
  }
  if (r.state === 'READY' && r.probed === true) return { state: VALIDITY.VALID, reason: null };
  if (r.state === 'READY') return { state: VALIDITY.CHECKING, reason: null };
  return { state: VALIDITY.UNAVAILABLE, reason: failureText(r.reason) };
}

export const isValid = (r) => validity(r).state === VALIDITY.VALID;
export const isChecking = (r) => validity(r).state === VALIDITY.CHECKING;
export const isUnavailable = (r) => validity(r).state === VALIDITY.UNAVAILABLE;

// ───────────────────────── أسباب الفشل الصادقة ─────────────────────────

/**
 * أسباب الفشل كما يفهمها المشاهد. ما يأتي من موقع المصدر نفسه يُقال إنه من الموقع، لا عطل VANTARA.
 * الترتيب مهم: الأخص أولًا.
 */
export const FAILURES = Object.freeze({
  VERIFY: { text: 'الموقع يطلب تحققًا يدويًا؛ افتح «تحقق» من صفحة الإضافات', test: /captcha|turnstile|challenge|cf[-_ ]?chl|human|تحقق/i },
  SESSION: { text: 'انتهت جلسة الموقع أو صلاحية الرابط', test: /HTTP\s*401|\b401\b|session|expired|token|انتهت (?:صلاحية|الجلسة)/i },
  REMOVED: { text: 'المحتوى أُزيل من موقع المصدر', test: /HTTP\s*(?:404|410)|\b(?:404|410)\b|not found|removed|deleted|محذوف|أُزيل|ازيل/i },
  SITE_DOWN: { text: 'موقع المصدر متعطل الآن (الخلل من الموقع نفسه)', test: /HTTP\s*5\d\d|\b5\d\d\b|bad gateway|service unavailable|internal server error/i },
  EXTRACTOR: { text: 'مضيف الفيديو غير مدعوم بعد', test: /unsupported (?:host|extractor)|no extractor|لا مستخرج|غير مدعوم|NoSuchMethod/i },
  NOT_SUITABLE: { text: 'الملف ليس فيديو صالحًا للتشغيل', test: /mime|content-type|text\/html|not a video|ليس فيديو|unsupported format|RESOLVER_EMPTY/i },
  NETWORK: { text: 'تعذّر الاتصال: الشبكة أو الموقع بطيء', test: /timeout|timed out|ECONN|ENOTFOUND|network|DNS|UnknownHost|offline|لم يرد|مهلة/i },
});

/** كود سبب الفشل أو null إن لم يُعرف. */
export function failureCode(reason) {
  const text = String(reason ?? '');
  if (!text) return null;
  for (const [code, rule] of Object.entries(FAILURES)) if (rule.test.test(text)) return code;
  return null;
}

/** جملة عربية للسبب؛ ما لا نعرفه يُقال كما هو أو «لم ينجح فحص رابط الفيديو» — لا تخمين. */
export function failureText(reason) {
  const code = failureCode(reason);
  if (code) return FAILURES[code].text;
  const text = String(reason ?? '').trim();
  return text && /[؀-ۿ]/.test(text) ? text.slice(0, 160) : 'لم ينجح فحص رابط الفيديو';
}

// ───────────────────────── جدول الترتيب ─────────────────────────

const QUALITY = { 1080: 1, 2160: 0.8, 1440: 0.8, 720: 0.6, 480: 0.2 };
const CODEC = { 'H.264': 1, HEVC: 0.6, AV1: 0.1 };
const GB = 1024 ** 3;

/**
 * معايير «شغّل الأفضل» وأوزانها. كل معيار يعطي 0..1 والوزن يضربه؛ المجموع هو الدرجة.
 * `d` وصف الصف من server-sheet.js describe(): { torrent, q, langs, info, prefer, … }.
 * القيمة غير المعروفة تأخذ درجة وسطى معلنة لا أعلى ولا أدنى.
 */
export const RANK_CRITERIA = Object.freeze([
  {
    id: 'arabic', label: 'يدعم العربية (صوت مدبلج أو ترجمة عربية)', weight: 400,
    score: (r, d) => (d.langs?.some((l) => l.ar) || d.info?.arabic ? 1 : 0),
  },
  {
    id: 'release', label: 'ليس تسجيل سينما (CAM)', weight: 300,
    score: (r, d) => (d.info?.source === 'CAM' ? 0 : 1),
  },
  {
    id: 'start', label: 'سرعة البدء: زمن الفحص للمباشر، والمشاركون للتورنت', weight: 250,
    score: (r, d) => {
      if (d.torrent) {
        const s = d.info?.seeders ?? seedersOf(r);
        return Number.isFinite(s) ? Math.min(1, Math.log10(1 + Math.max(0, s)) / 3) : 0;
      }
      const ms = Number(r.probeMs);
      if (!Number.isFinite(ms) || ms <= 0) return 0.5;
      return ms < 1500 ? 1 : ms < 4000 ? 0.7 : 0.4;
    },
  },
  {
    id: 'quality', label: 'الجودة: 1080 مفضلة، ثم 4K، ثم 720', weight: 200,
    score: (r, d) => QUALITY[d.q] ?? 0.5,
  },
  {
    id: 'reliability', label: 'الثبات: سيرفرك السابق وما بدأ سريعًا على هذا الجهاز', weight: 150,
    score: (r, d) => {
      if (d.prefer) return 1;
      const known = knownStart(startFeatures(d));
      return known == null ? 0.5 : 1 - Math.min(known, FAIL_MS) / FAIL_MS;
    },
  },
  {
    id: 'codec', label: 'الترميز المناسب للجهاز: H.264 ثم HEVC ثم AV1', weight: 100,
    score: (r, d) => CODEC[d.info?.codec] ?? 0.7,
  },
  {
    id: 'size', label: 'حجم معقول (حتى 8 GB)', weight: 150,
    score: (r, d) => {
      const size = d.info?.size;
      if (!Number.isFinite(size) || size <= 0) return 0.8;
      return size <= 8 * GB ? 1 : size <= 20 * GB ? 0.5 : 0;
    },
  },
]);

/** درجة الصف وتفصيلها: `{ score, parts: [{id, label, value}] }`. غير الصالح لا درجة له (-Infinity). */
export function scoreRoute(r, d, { valid = isValid } = {}) {
  if (!valid(r)) return { score: -Infinity, parts: [] };
  const parts = RANK_CRITERIA.map((c) => ({ id: c.id, label: c.label, value: c.weight * c.score(r, d) }));
  return { score: parts.reduce((sum, p) => sum + p.value, 0), parts };
}

/** الأفضل من صفوف موصوفة: الصالح وحده، بأعلى درجة. null إن لم يوجد صالح. */
export function bestRoute(rows, describe, options) {
  let top = null;
  for (const r of rows ?? []) {
    const { score } = scoreRoute(r, describe(r), options);
    if (score === -Infinity) continue;
    if (!top || score > top.score) top = { r, score };
  }
  return top?.r ?? null;
}
