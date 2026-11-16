/**
 * نموذج التنزيلات: حالات العنصر وأسماؤها، مفتاح منع التكرار، وتجميع «على الجهاز» حسب العمل.
 *
 * العنصر = ملف واحد يملكه المستخدم على جهازه: فصل مانجا، حلقة، أو فيلم. لا يُزامَن ولا يرفع
 * (ملكية الجهاز: docs/VANTARA_DATA_OWNERSHIP.md و packages/domain/src/downloads.ts).
 *
 * «على الجهاز» مكتبة أعمال لا قائمة ملفات: ستة فصول من عمل فيه 150 فصلًا تظهر بطاقة عمل واحدة
 * عليها «6 فصول»، ولا يُسمّى القسم «المكتملة» لأن العمل نفسه ليس مكتملًا.
 */

export const STATES = Object.freeze({
  queued: 'queued',
  resolving: 'resolving',
  downloading: 'downloading',
  paused: 'paused',
  reconnecting: 'reconnecting',
  verifying: 'verifying',
  ready: 'ready',
  failed: 'failed',
  noSpace: 'no_space',
  waitingWifi: 'waiting_wifi',
  /** الاتصال انقطع: العنصر يكمل وحده حين يعود، ولا تُستهلك محاولاته وهو بلا شبكة. */
  waitingNetwork: 'waiting_network',
  /** سُلِّم لطابور الجهاز (Android) وينتظر خانته هناك: يكمل ولو أُغلق التطبيق، ولا يشغل خانة في الواجهة. */
  scheduled: 'scheduled',
});

/** الحالات التي تشغل خانة من خانات التوازي. */
export const ACTIVE_STATES = new Set([STATES.resolving, STATES.downloading, STATES.reconnecting, STATES.verifying]);
/** حالات «جاري التحميل» (كل ما لم يصبح على الجهاز بعد). */
export const PENDING_STATES = new Set([...ACTIVE_STATES, STATES.queued, STATES.scheduled, STATES.paused, STATES.failed, STATES.noSpace, STATES.waitingWifi, STATES.waitingNetwork]);

export const STATE_LABEL = Object.freeze({
  queued: 'في الانتظار',
  resolving: 'يجهّز المصدر',
  downloading: 'جارٍ التحميل',
  paused: 'متوقف مؤقتًا',
  reconnecting: 'يعيد الاتصال',
  verifying: 'يتحقق من الملف',
  ready: 'جاهز على الجهاز',
  failed: 'فشل التنزيل',
  no_space: 'مساحة غير كافية',
  waiting_wifi: 'بانتظار Wi-Fi',
  waiting_network: 'بانتظار الاتصال',
  scheduled: 'في طابور الجهاز',
});

/** أسباب الفشل كما تُعرض: سطر قصير، والتفصيل التقني في ورقة المعلومات. */
export const ERROR_LABEL = Object.freeze({
  NETWORK: 'انقطع الاتصال',
  EXPIRED: 'انتهت صلاحية رابط المصدر',
  SOURCE: 'المصدر رفض الطلب',
  UNSUPPORTED: 'هذا المصدر لا يدعم التنزيل',
  /** المصدر ردّ لكن الفصل بلا صفحات (مقفل، مدفوع، أو أزيل) — ليس «رفضًا». */
  EMPTY: 'الفصل بلا صفحات عند المصدر',
  /** 429 أو صفحة حجب بدل الصورة: الموقع يطلب التمهّل، والتنزيل يبطئ ويعيد. */
  RATE_LIMIT: 'الموقع يحدّ الطلبات',
  /** تحدّي Cloudflare أو ما يشبهه: يُحل من «تحتاج تحقق» في الإضافات. */
  VERIFICATION: 'الموقع يطلب تحققًا',
  /** كود الإضافة تعطّل أو لم يقرأ صفحة الموقع (تغيّر الموقع). */
  EXTENSION: 'الإضافة تعطّلت عند هذا الفصل',
  NO_SPACE: 'المساحة على الجهاز لا تكفي',
  VERIFY: 'الملف لم يجتز التحقق',
  NO_ROUTE: 'لم يجهز مصدر صالح للتنزيل',
  // المصدر ردّ بقائمة صفحات فاضية (فصل ترويجي أو معطّل عنده): ليس رفضًا للطلب
  DRM: 'المحتوى محمي ولا يُنزَّل',
  STORAGE: 'تعذّرت الكتابة على الجهاز',
  UNKNOWN: 'تعذّر التنزيل',
});

export const SECTIONS = ['anime', 'manga', 'cinema'];

/** خطأ تنزيل برمز معروف. الرسالة التقنية تبقى للمعلومات، والسطر الظاهر من ERROR_LABEL. */
export class DownloadError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message || ERROR_LABEL[code] || ERROR_LABEL.UNKNOWN);
    this.code = ERROR_LABEL[code] ? code : 'UNKNOWN';
    this.retryable = retryable;
  }
}

/**
 * رقم فصل المانجا للتنزيل: السالب (-1) يعني «بلا رقم» (إعلان، مقدمة، «انضم لسيرفرنا»)، فيصير مجهولًا يُرتَّب آخرًا ولا يُسمّى
 * «الفصل -1». كان يُرتَّب أولًا فيصير هو «الفصل الحالي» الافتراضي في ورقة التحميل.
 */
export function mangaUnitNumber(n) {
  if (n === null || n === undefined || n === '') return null; // Number(null) = 0: يصير «الفصل 0»
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * الفصل الافتراضي في ورقة التحميل: ما تقرؤه تاليًا، وإلا أول فصل حقيقي (من 1 قبل 0: الفصل 0 مقدمة ترويجية بلا صور في
 * مصادر كثيرة)، وإلا أول مرقَّم، وإلا الأول.
 */
export function defaultUnitKey(units, nextKey = null) {
  const list = Array.isArray(units) ? units : [];
  if (nextKey != null && list.some((u) => u.key === nextKey)) return nextKey;
  return (list.find((u) => u.number != null && u.number >= 1) ?? list.find((u) => u.number != null) ?? list[0])?.key;
}

/** مفتاح العنصر: العمل + الوحدة. نفس الفصل لا يدخل الطابور مرتين ولا يتكرر على القرص. */
export function itemKey(workRef, unitKey) {
  return `${String(workRef)}|${String(unitKey)}`;
}

/** معرّف ثابت قصير من المفتاح (FNV-1a): اسم مجلد آمن بلا رموز من عنوان العمل. */
export function itemId(key) {
  let h = 0x811c9dc5;
  const s = String(key);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let h2 = 0x9e3779b1;
  for (let i = s.length - 1; i >= 0; i--) {
    h2 ^= s.charCodeAt(i);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `dl_${(h >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

/** رقم للعرض بلا أصفار زائدة: 7 لا 7.0، و12.5 كما هي. */
export function numberLabel(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}

/** اسم الوحدة كما يظهر في الصف: «الفصل 12»، «الحلقة 7»، «م2 · الحلقة 3»، أو اسم الفيلم. */
export function unitLabel(item) {
  const u = item?.unit ?? {};
  if (item?.kind === 'movie') return u.title || item?.work?.title || 'الفيلم';
  const n = numberLabel(u.number);
  if (item?.kind === 'manga') return n ? `الفصل ${n}` : u.title || 'فصل';
  const ep = n ? `الحلقة ${n}` : u.title || 'حلقة';
  return u.season > 0 && item?.section === 'cinema' ? `م${u.season} · ${ep}` : ep;
}

/** تطبيع مواصفات عنصر جديد قبل دخوله الطابور. يرمي إن نقصه ما لا يُنزَّل بدونه. */
export function createItem(spec, { now = Date.now(), order = 0 } = {}) {
  const section = SECTIONS.includes(spec?.section) ? spec.section : null;
  if (!section) throw new Error('قسم التنزيل غير معروف');
  const kind = section === 'manga' ? 'manga' : spec.kind === 'movie' ? 'movie' : 'episode';
  const ref = spec?.work?.ref;
  if (!ref) throw new Error('مرجع العمل مطلوب');
  const unitKey = spec?.unit?.key ?? (kind === 'movie' ? 'movie' : null);
  if (unitKey == null) throw new Error('مفتاح الفصل/الحلقة مطلوب');
  const key = itemKey(ref, unitKey);
  return {
    id: itemId(key),
    key,
    kind,
    section,
    work: {
      ref: String(ref),
      title: String(spec.work.title ?? ''),
      cover: spec.work.cover ?? null,
      banner: spec.work.banner ?? null,
      logo: spec.work.logo ?? null,
      color: spec.work.color ?? null,
      // مصدر غلاف المانجا: يُجلب بعميله وترويساته (الطلب المباشر من الواجهة يرفضه الموقع)
      coverSource: spec.work.coverSource ?? null,
      year: spec.work.year ?? null,
      format: spec.work.format ?? null,
    },
    unit: {
      key: String(unitKey),
      number: Number.isFinite(Number(spec.unit?.number)) ? Number(spec.unit.number) : null,
      season: Number.isFinite(Number(spec.unit?.season)) ? Number(spec.unit.season) : null,
      title: spec.unit?.title ?? null,
    },
    source: {
      mode: spec.source?.mode === 'manual' ? 'manual' : 'smart',
      sourceId: spec.source?.sourceId ?? null,
      sourceName: spec.source?.sourceName ?? null,
      server: spec.source?.server ?? null,
      routeCode: spec.source?.routeCode ?? null,
      // هوية السيرفر الثابتة (التورنت: btih:hash:idx) — بها يُنزَّل ما اختاره المستخدم نفسه لا «أفضل» غيره
      fingerprint: spec.source?.fingerprint ?? null,
      label: spec.source?.label ?? null,
      quality: spec.source?.quality ?? null,
    },
    request: spec.request ?? {},
    state: STATES.queued,
    error: null,
    bytes: 0,
    total: null,
    pages: 0,
    pagesTotal: null,
    speed: 0,
    transport: spec.transport ?? (kind === 'manga' ? 'pages' : null),
    resumable: kind === 'manga' ? true : null,
    media: null,
    storage: null,
    attempts: 0,
    order,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    updatedAt: now,
  };
}

const ts = (item) => item.finishedAt ?? item.updatedAt ?? item.createdAt ?? 0;

/**
 * «على الجهاز»: بطاقة لكل عمل فيه عنصر جاهز واحد على الأقل. الفاشل لا يُحسب محتوى محفوظًا،
 * والعمل الذي حُذف آخر عناصره يختفي. الأحدث نشاطًا أولًا.
 */
export function onDeviceWorks(items, { section = 'all' } = {}) {
  const works = new Map();
  for (const item of items ?? []) {
    if (item.state !== STATES.ready) continue;
    if (section !== 'all' && item.section !== section) continue;
    const ref = item.work.ref;
    let w = works.get(ref);
    if (!w) {
      w = { ref, section: item.section, kind: item.kind, work: item.work, count: 0, bytes: 0, at: 0 };
      works.set(ref, w);
    }
    w.count++;
    w.bytes += Number(item.storage?.bytes ?? item.bytes ?? 0) || 0;
    // أحدث بيانات للعمل تكسب (غلاف أوضح، شعار وصل لاحقًا)
    if (ts(item) >= w.at) {
      w.at = ts(item);
      w.work = { ...w.work, ...Object.fromEntries(Object.entries(item.work).filter(([, v]) => v != null && v !== '')) };
    }
  }
  return [...works.values()].sort((a, b) => b.at - a.at);
}

/** عدد العناصر كنص: «6 فصول»، «حلقة واحدة»، «فيلم». */
export function countText(kind, n) {
  if (kind === 'movie') return 'فيلم';
  const [one, two, few, many] = kind === 'manga' ? ['فصل واحد', 'فصلان', 'فصول', 'فصلًا'] : ['حلقة واحدة', 'حلقتان', 'حلقات', 'حلقة'];
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

/**
 * صفحة العمل المحلي: ما على هذا الجهاز وحده، بأرقامه الأصلية (1 و4 و7 تبقى كذلك).
 * المسلسل يُقسَّم بالمواسم التي فيها تنزيلات فقط. لا عناصر معتمة لما لم يُنزَّل.
 */
export function localWork(items, ref) {
  const mine = (items ?? []).filter((i) => i.work.ref === ref);
  const ready = mine.filter((i) => i.state === STATES.ready);
  const pending = mine.filter((i) => i.state !== STATES.ready);
  const byNumber = (a, b) => (a.unit.season ?? 0) - (b.unit.season ?? 0) || (a.unit.number ?? Infinity) - (b.unit.number ?? Infinity) || String(a.unit.key).localeCompare(String(b.unit.key));
  ready.sort(byNumber);
  const seasons = [];
  if (ready.some((i) => i.unit.season != null && i.section !== 'manga')) {
    const map = new Map();
    for (const i of ready) {
      const s = i.unit.season ?? 0;
      if (!map.has(s)) map.set(s, []);
      map.get(s).push(i);
    }
    for (const [season, list] of [...map.entries()].sort((a, b) => a[0] - b[0])) seasons.push({ season, items: list });
  }
  const head = ready[0] ?? pending[0] ?? null;
  const work = mine.reduce((acc, i) => ({ ...acc, ...Object.fromEntries(Object.entries(i.work).filter(([, v]) => v != null && v !== '')) }), {});
  return {
    ref,
    section: head?.section ?? null,
    kind: head?.kind ?? null,
    work,
    ready,
    pending,
    seasons,
    bytes: ready.reduce((s, i) => s + (Number(i.storage?.bytes ?? i.bytes) || 0), 0),
  };
}

/** ملخص «جاري التحميل»: النشطة والمنتظرة وإجمالي السرعة. */
export function queueSummary(items) {
  let active = 0;
  let waiting = 0;
  let paused = 0;
  let failed = 0;
  let speed = 0;
  for (const i of items ?? []) {
    if (ACTIVE_STATES.has(i.state)) {
      active++;
      speed += i.state === STATES.downloading ? Number(i.speed) || 0 : 0;
    } else if (i.state === STATES.queued || i.state === STATES.waitingWifi || i.state === STATES.waitingNetwork || i.state === STATES.scheduled) waiting++;
    else if (i.state === STATES.paused) paused++;
    else if (i.state === STATES.failed || i.state === STATES.noSpace) failed++;
  }
  return { active, waiting, paused, failed, speed, running: active + waiting > 0 };
}

/**
 * نطاق التحميل إلى قائمة وحدات: رقم واحد، أو مدى «3-8»، أو قائمة «1, 4, 7»، أو الكل.
 * يرجع الوحدات الموجودة فعلًا بترتيبها، بلا تكرار.
 */
export function pickUnits(units, scope) {
  const list = Array.isArray(units) ? units : [];
  if (!scope || scope.type === 'all') return list.slice();
  if (scope.type === 'keys') {
    const set = new Set((scope.keys ?? []).map(String));
    return list.filter((u) => set.has(String(u.key)));
  }
  if (scope.type === 'season') return list.filter((u) => Number(u.season) === Number(scope.season));
  if (scope.type === 'range') {
    const from = Number(scope.from);
    const to = Number(scope.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
    const [a, b] = from <= to ? [from, to] : [to, from];
    return list.filter((u) => Number(u.number) >= a && Number(u.number) <= b && (scope.season == null || Number(u.season) === Number(scope.season)));
  }
  return [];
}

/** «1-5, 9, 12» ⇒ نطاق قائمة. نص غير مفهوم ⇒ null (لا تخمين). */
export function parseNumberList(text) {
  const parts = String(text ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).split(/[,،\s]+/).filter(Boolean);
  if (!parts.length) return null;
  const out = [];
  for (const p of parts) {
    const m = /^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$/.exec(p);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] != null ? Number(m[2]) : a;
    out.push([Math.min(a, b), Math.max(a, b)]);
  }
  return out;
}

export function matchesNumberList(ranges, n) {
  const v = Number(n);
  return Array.isArray(ranges) && Number.isFinite(v) && ranges.some(([a, b]) => v >= a && v <= b);
}
