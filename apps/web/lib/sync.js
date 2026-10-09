/**
 * عميل المزامنة.
 *
 * النموذج: الواجهة تقرأ من مرآة محلية دائمًا، والشبكة تحدّث المرآة في
 * الخلفية. لا شاشة تحميل عند كل مزامنة، ولا انتظار لـCloudflare قبل أول رسم.
 *
 * ثلاث قواعد تحمي التجربة:
 *
 * 1. **الـcursor يتقدّم بعد التطبيق لا قبله.** سقوط الشبكة في منتصف الدفعة
 *    يعيد نفس الدفعة، لا يفقدها.
 *
 * 2. **الطابور دائم ومرتّب.** الكتابة تُسجَّل محليًا وتظهر فورًا، ثم تُرسل.
 *    إغلاق التطبيق قبل الإرسال لا يفقدها، وكل عملية تحمل op_id ثابتًا فإعادة
 *    الإرسال لا تُحتسب مرتين.
 *
 * 3. **الإشعار بالتغيير مُصنَّف.** المشتركون يعرفون *ما* تغيّر فيرقّعون العنصر
 *    وحده. إعادة رسم الشاشة كل 25 ثانية تُعيد تحميل الصور وتُرجع التمرير
 *    للأعلى، وهذا وحده كفيل بأن يجعل التطبيق يبدو معطوبًا.
 */

import {
  classifyFailure,
  compactQueue,
  nextAttemptDelay,
  shouldQuarantine,
  syncHealth,
  trimQueue,
} from './queue.js';
import { accountWithIdentity, withIdentity } from './identity.js';
import { PROJECTIONS, projectQueue } from './optimistic.js';

const TOKEN_KEY = 'vantara.token';
const USER_KEY = 'vantara.user';
const CURSOR_KEY = 'vantara.cursor';
const QUEUE_KEY = 'vantara.queue';
const MIRROR_KEY = 'vantara.mirror';
const QUARANTINE_KEY = 'vantara.quarantine';
const DEVICE_ID_KEY = 'vantara.device.id';
const DEVICE_CREDENTIAL_KEY = 'vantara.device.credential';
/**
 * إذن الـPIN: بعد إدخال PIN صحيح، الخادم يعطي هذا الجهاز إذنًا يجدد به الجلسة بلا
 * إعادة السؤال. يُحفظ في sessionStorage لا localStorage عمدًا: يعيش ما دام
 * التطبيق مفتوحًا (وتحديث الصفحة)، ويُنسى بإغلاقه — فمن يفتح التطبيق يُسأل.
 */
const PIN_GRANT_KEY = 'vantara.pin.grant';
const TRANSLATION_TIMEOUT_MS = 240_000;
const SYNC_TIMEOUT_MS = 30_000;

/** مهلة النقل تشمل قراءة الجسم أيضًا كي لا يبقى قفل السحب أو الإرسال عالقًا. */
async function withSyncDeadline(run) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('انتهت مهلة اتصال المزامنة', 'TimeoutError')), SYNC_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * سقف الطابور.
 *
 * تجاوزه يعني انقطاعًا طويلًا جدًا. الإسقاط ليس «الأقدم أولًا»: `trimQueue`
 * يضغط أولًا ثم يُسقط أقدم عمليات **الحالة** فقط، ولا يمسّ عملية تراكمية —
 * فصل قُرئ لا يُستعاد، أما موضع قراءة قديم فتصححه أول كتابة قادمة.
 */
const MAX_QUEUE = 500;

/** سقف سجل المعزولات. أبعد من ذلك تشخيصٌ لا يقرأه أحد. */
const MAX_QUARANTINE = 100;

/**
 * سقف جولات السحب في نداء واحد.
 *
 * الخادم يقطع الدفعة عند 500 صفّ لكل جدول، فالمتأخر الكبير يحتاج جولات. والسقف
 * يمنع نداءً واحدًا من الاستمرار إلى الأبد على شبكة بطيئة.
 *
 * لكن الخروج عند السقف **ليس** مزامنة تامّة: تُرفع `backlog` فتقول الحالة
 * الحقيقة، ويُعاد السحب فورًا بدل انتظار الدورة التالية.
 */
const MAX_PULL_ROUNDS = 20;

/** الجداول التي تصل في الفروقات، ومفتاح كل صف. */
const KEYS = {
  accounts: (row) => row.user_id,
  profiles: (row) => row.user_id,
  library: (row) => `${row.user_id}/${row.series_ref}`,
  progress: (row) => `${row.user_id}/${row.chapter_key}`,
  chapter_reads: (row) => `${row.user_id}/${row.chapter_key}`,
  // عين الفصل: علامة المالك وحده، آخر كتابة تفوز
  chapter_marks: (row) => `${row.user_id}/${row.chapter_key}`,
  usage_daily: (row) => `${row.user_id}/${row.day}`,
  collections: (row) => `${row.user_id}/${row.kind}/${row.series_ref}`,
  // «المكتمل»: صف لكل عمل أكملته
  completions: (row) => `${row.user_id}/${row.series_ref}`,
  ratings: (row) => `${row.user_id}/${row.series_ref}`,
  comments: (row) => row.id,
  // وصف العمل: عنوانه وغلافه. بلا مفتاح هنا كانت صفوفه تُلقى ويعبر المؤشر
  // فوقها، فتعرض شاشة المكتبة معرّفًا خامًا ولا تعود الصفوف أبدًا.
  works: (row) => row.series_ref,
  reactions: (row) => `${row.comment_id}/${row.user_id}/${row.emoji}`,
  recommendations: (row) => row.id,
  // تفاعل المجلس: صف لكل شخص على كل هدف، والجديد يستبدل القديم
  majlis_reactions: (row) => `${row.target_kind}/${row.target_id}/${row.user_id}`,
  // الفريم: صف لكل مستلم. بلا مفتاح يُلقى ويعبر المؤشر فوقه فلا يصل أبدًا
  frames: (row) => row.id,
  // حالة كل مستلم مستقلة (§19): بلا هذا لا يظهر «منصور قبل · NGM رفض»
  recommendation_recipients: (row) => `${row.recommendation_id}/${row.user_id}`,
  notifications: (row) => row.id,
  activity: (row) => row.id,
  // إيصالات المشاهدة (§13–§15): بلا هذا لا تُعرف من شاهد شيئًا
  activity_receipts: (row) => `${row.event_id}/${row.user_id}`,
  // وصله/شافه في المجلس: صف لكل شخص على كل رسالة
  majlis_receipts: (row) => `${row.target_kind}/${row.target_id}/${row.user_id}`,
  // «آخر المشاهدات»: صف لكل عمل في حسابك، والحذف شاهد قبر
  work_views: (row) => `${row.user_id}/${row.series_ref}`,
  public_work_views: (row) => `${row.user_id}/${row.series_ref}`,
  view_privacy: (row) => row.user_id,
  settings: (row) => row.user_id,
  // المجلس محادثة: رسائل، و«إخفاء لدي»، واسمه وصورته، وآخر ما قرأه كل عضو
  majlis_messages: (row) => row.id,
  majlis_hidden: (row) => `${row.user_id}/${row.target}`,
  majlis_meta: (row) => row.id,
  majlis_reads: (row) => row.user_id,
  majlis_message_receipts: (row) => `${row.message_id}/${row.user_id}`,
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function randomSecret(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Android 8+ يوفّر ANDROID_ID ثابتًا لنفس (مفتاح توقيع التطبيق + المستخدم +
 * الجهاز). لا نستعمله كـcredential؛ دوره معرفة أن التثبيت الجديد عاد إلى
 * جهاز سبق اعتماده، بينما سر الجهاز نفسه يبقى عشوائيًا ويتدوّر.
 */
async function nativeStableDeviceId() {
  const plugin = globalThis.Capacitor?.Plugins?.SystemUi;
  if (!plugin || typeof plugin.deviceId !== 'function') return null;
  try {
    const result = await plugin.deviceId();
    const identifier = String(result?.identifier ?? '').trim().toLowerCase();
    if (!/^[0-9a-f]{16}$/.test(identifier)) return null;
    return `android:${identifier}`;
  } catch {
    return null;
  }
}

/**
 * الموجود محليًا لا يتغيّر أثناء التحديث العادي. في تثبيت Android نظيف نأخذ
 * المعرّف الثابت، وفي المتصفح نرجع إلى UUID عشوائي محفوظ محليًا.
 */
async function deviceProof(deviceIdProvider) {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  let deviceCredential = localStorage.getItem(DEVICE_CREDENTIAL_KEY);
  if (!deviceId) {
    deviceId = await deviceIdProvider();
    if (!deviceId) deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  if (!deviceCredential) {
    deviceCredential = randomSecret();
    localStorage.setItem(DEVICE_CREDENTIAL_KEY, deviceCredential);
  }
  return { deviceId, deviceCredential };
}

export function createSync({ baseUrl, deviceIdProvider = nativeStableDeviceId }) {
  const listeners = new Set();
  let token = localStorage.getItem(TOKEN_KEY) ?? null;
  let user = accountWithIdentity(readJson(USER_KEY, null));
  let accountsLimit = 10;
  let deletingHere = false;
  let pinGrant = (() => {
    try {
      return sessionStorage.getItem(PIN_GRANT_KEY) || null;
    } catch {
      return null;
    }
  })();
  const keepGrant = (grant) => {
    pinGrant = grant || null;
    try {
      if (pinGrant) sessionStorage.setItem(PIN_GRANT_KEY, pinGrant);
      else sessionStorage.removeItem(PIN_GRANT_KEY);
    } catch {
      // تخزين محجوب: الإذن يبقى في الذاكرة فقط
    }
  };
  let cursor = Number(localStorage.getItem(CURSOR_KEY) ?? '0') || 0;
  let queue = readJson(QUEUE_KEY, []);
  let mirror = readJson(MIRROR_KEY, {});
  // ترقية المرآة القديمة: الصفوف الاجتماعية السابقة كانت مختلطة بسجل المالك.
  // لا نعرضها قبل أن يعيد الخادم إرسال projection الحالي وصلاحية كل حساب.
  if (localStorage.getItem('vantara.public-views.v1') !== '1') {
    for (const [key, row] of Object.entries(mirror.work_views ?? {})) {
      if (row?.user_id !== user?.userId) delete mirror.work_views[key];
    }
    cursor = 0;
    localStorage.setItem(CURSOR_KEY, '0');
    writeJson(MIRROR_KEY, mirror);
    localStorage.setItem('vantara.public-views.v1', '1');
  }
  // الإحصاء اليومي كان يصل إلى مرآة كل حساب. بعد حصره بالمالك على الخادم،
  // امسح نسخه القديمة من الأجهزة دون تصفير المؤشر أو سجل المالك.
  if (localStorage.getItem('vantara.private-usage.v1') !== '1') {
    for (const [key, row] of Object.entries(mirror.usage_daily ?? {})) {
      if (row?.user_id !== user?.userId) delete mirror.usage_daily[key];
    }
    writeJson(MIRROR_KEY, mirror);
    localStorage.setItem('vantara.private-usage.v1', '1');
  }
  let quarantine = readJson(QUARANTINE_KEY, []);
  /** أثر الكتابات التي لم يُقرّها الخادم بعد (`lib/optimistic.js`). يُحسب ولا يُحفظ. */
  let overlay = {};
  /**
   * عملياتٌ أقرّها الخادم ولم تصل مرآتنا بعد: `rev` الذي كُتبت فيه.
   *
   * بلا هذه الطبقة يسقط الأثر لحظة الإقرار، وسحبٌ كان في الطريق قبل الكتابة
   * يصل بعدها بالصف القديم — فيرجع الإشعار «غير مقروء» والقلب فارغًا حتى
   * السحب التالي. الأثر يبقى حتى تبلغ المرآة `rev` كتابته.
   */
  let landing = [];
  /** قيم كل جدول (المرآة + الطبقة) محسوبة مرة حتى يتغير أحدهما: الشاشات تسأل مئات المرات. */
  let valuesCache = new Map();
  const refreshOverlay = () => {
    overlay = projectQueue(landing.length ? [...landing.map((l) => l.op), ...queue] : queue, mirror, user?.userId ?? null);
    valuesCache = new Map();
  };
  // Reopening offline must show durable queued edits before the first network pull.
  refreshOverlay();
  let pulling = false;
  let pullAgain = false;
  let sessionGeneration = 0;
  let pushing = false;
  let pushWaiters = [];

  /** محاولات متتالية لكل عملية، بمفتاح op_id. لا تُحفظ: العدّ لكل جلسة. */
  const attemptsOf = new Map();
  /** لا نرسل قبل هذا الوقت: تراجع أُسّي بعد فشل مؤقت. */
  let nextPushAt = 0;
  let pushTimer = null;
  /** طلب إرسال وصل أثناء إرسال جارٍ: يُنفَّذ بعده لا يُلغى. */
  let pushAgain = false;
  /**
   * آخر **كتابة** وصلت الخادم.
   *
   * منفصل عن آخر سحب بقصد: السحب ينجح بينما الكتابة معلّقة، فلو خلطناهما لبقيت
   * الصحة تقول «مزامَن» وطابور الكتابة عالق منذ ساعة.
   */
  let lastSuccessAt = Number(localStorage.getItem('vantara.lastPush') ?? '0') || 0;
  let lastSyncAt = Number(localStorage.getItem('vantara.lastSync') ?? '0') || 0;
  // خرج السحب عند سقف الجولات وقد بقي `more`: القراءة ناقصة، والحالة يجب أن
  // تقولها. بلا هذا يعرض الجهاز «مُزامَن» وهو خلف بآلاف الصفوف.
  let backlog = false;
  let lastError = null;
  /** هل نجح آخر حفظ محلي. كتابة لا تُحفظ ليست كتابة دائمة. */
  let durable = true;
  let overflowing = false;

  const emit = (tables) => {
    for (const listener of listeners) {
      try {
        listener(tables);
      } catch {
        // مشترك معطوب لا يوقف البقية
      }
    }
  };

  const persistMirror = () => writeJson(MIRROR_KEY, mirror);

  /**
   * يحفظ الطابور، ويقاتل على المساحة قبل أن يستسلم.
   *
   * `localStorage` يرفض الكتابة عند الامتلاء. تجاهل الرفض — وهو ما كان يحدث —
   * يعني طابورًا يبدو محفوظًا ويضيع عند إغلاق التطبيق. المرآة مشتقة من الخادم
   * وتُسحب من جديد، فهي أول ما يُفرَّغ لإفساح المكان لكتابة لا يملكها غيرنا.
   */
  const persistQueue = () => {
    refreshOverlay();
    if (writeJson(QUEUE_KEY, queue)) {
      durable = true;
      return true;
    }
    mirror = {};
    valuesCache = new Map();
    try {
      localStorage.removeItem(MIRROR_KEY);
    } catch {
      // لا شيء نفعله: نحاول الحفظ على أي حال
    }
    durable = writeJson(QUEUE_KEY, queue);
    if (durable) {
      // المرآة فُرِّغت: تُعاد من الخادم، والشاشة تُرقَّع بعدها
      cursor = 0;
      localStorage.setItem(CURSOR_KEY, '0');
      void pull();
    }
    return durable;
  };

  const persistQuarantine = () => writeJson(QUARANTINE_KEY, quarantine);

  /** ينسى عدّ المحاولات لعمليات لم تبقَ في الطابور (ضُغطت أو استقرّت). */
  const pruneAttempts = () => {
    const alive = new Set(queue.map((entry) => entry.opId));
    for (const key of [...attemptsOf.keys()]) if (!alive.has(key)) attemptsOf.delete(key);
  };

  /**
   * يعزل عملية لا أمل في نجاحها.
   *
   * بلا عزل تبقى في رأس الطابور إلى الأبد: كل دورة تحاولها، ولا تنجح، وتُحتسب
   * ككتابة معلّقة فتبدو المزامنة متأخرة دائمًا بلا سبب ظاهر.
   */
  const quarantineOp = (op, status, reason) => {
    quarantine.push({ op, status, reason, at: Date.now() });
    if (quarantine.length > MAX_QUARANTINE) quarantine = quarantine.slice(-MAX_QUARANTINE);
    queue = queue.filter((entry) => entry.opId !== op.opId);
    attemptsOf.delete(op.opId);
    persistQuarantine();
    persistQueue();
  };

  async function sessionPayload(userId, extra = {}, signal) {
    if (!signal) return withSyncDeadline((deadline) => sessionPayload(userId, extra, deadline));
    const response = await fetch(`${baseUrl}/v1/session`, {
      signal,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId,
        ...(await deviceProof(deviceIdProvider)),
        ...(pinGrant && extra.pin === undefined ? { pinGrant } : {}),
        ...extra,
      }),
    });
    if (!response.ok) {
      // PIN: سبب الرفض ومعه طول الرمز ووقت انتهاء القفل
      if (response.status === 401 || response.status === 429) {
        const body = await response.clone().json().catch(() => null);
        if (typeof body?.error === 'string' && body.error.startsWith('pin_')) {
          throw Object.assign(new Error(body.error), { status: response.status, code: body.error, digits: body.digits ?? null, retryAt: body.retryAt ?? null });
        }
      }
      const error = new Error(`http_${response.status}`);
      error.status = response.status;
      // رمز الخطأ من الخادم (`weekly_limit`، `translation_not_configured`…) إن وُجد
      error.translationError = await response
        .clone()
        .json()
        .then((b) => (typeof b?.error === 'string' ? b.error : null))
        .catch(() => null);
      // «جهاز غير موثوق» يختلف عن انقطاع: الشاشة تعرض رمز الاعتماد بدل «حاول مرة أخرى»
      error.code = (await response.json().catch(() => null))?.error ?? null;
      throw error;
    }
    return response.json();
  }

  /** جهاز جديد يطلب الاعتماد: رمز يُعرض على الشاشة ويعتمده المالك. */
  async function requestDevice() {
    const response = await fetch(`${baseUrl}/v1/device/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(await deviceProof(deviceIdProvider)),
    });
    if (!response.ok) throw Object.assign(new Error(`request_${response.status}`), { status: response.status });
    return response.json();
  }

  /** هل اعتُمد؟ `{ paired, pending }`. عند الاعتماد يصير الجهاز موثوقًا للحسابات كلها. */
  async function claimDevice() {
    const response = await fetch(`${baseUrl}/v1/device/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(await deviceProof(deviceIdProvider)),
    });
    if (!response.ok) throw Object.assign(new Error(`claim_${response.status}`), { status: response.status });
    return response.json();
  }

  /** من جوال معتمد: يعتمد جوالًا جديدًا برمزه. `{ approved }` أو يرمي عند انقطاع النت. */
  async function approveDevice(code) {
    try {
      return await request('/v1/device/approve', { method: 'POST', body: { code } });
    } catch (error) {
      if (error?.status === 400) return { approved: false, invalid: true };
      throw error;
    }
  }

  /** عدد الجوالات التي تنتظر الاعتماد الآن؛ 0 عند أي خطأ. */
  async function pendingDevices() {
    if (!token) return 0;
    try {
      return Number((await request('/v1/device/pending'))?.pending ?? 0);
    } catch {
      return 0;
    }
  }

  /** يعيد تدوير السر بعد reinstall فقط إن كان Android نفسه موثوقًا من قبل. */
  async function recoverDevice() {
    const response = await fetch(`${baseUrl}/v1/device/recover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(await deviceProof(deviceIdProvider)),
    });
    if (!response.ok) return { recovered: false, accounts: 0 };
    return response.json();
  }

  function persistSession(payload) {
    if (payload.pinGrant) keepGrant(payload.pinGrant);
    token = payload.token;
    user = accountWithIdentity(payload.user);
    refreshOverlay();
    sessionGeneration += 1;
    localStorage.setItem(TOKEN_KEY, token);
    writeJson(USER_KEY, user);
  }

  async function refreshSession() {
    if (!user?.userId) {
      const error = new Error('unauthorized');
      error.status = 401;
      throw error;
    }
    try {
      const payload = await sessionPayload(user.userId);
      persistSession(payload);
      emit(['session']);
      return payload;
    } catch (error) {
      // انقطاع أو عطل خادم ليس إلغاء اعتماد. إبقاء التوكن يسمح للدورة التالية
      // بتجديده وإرسال نفس الكتابات بدل توقف pull/push عند !token إلى الأبد.
      if (classifyFailure(error?.status ?? 0) === 'retry') throw error;
      token = null;
      localStorage.removeItem(TOKEN_KEY);
      // PIN أُضيف من جهاز آخر أو الإذن انتهى: الحساب يُقفل بدل أن يُطرد
      if (error?.code === 'pin_required' && user) {
        keepGrant(null);
        user = { ...user, pinDigits: error.digits ?? user.pinDigits ?? 4 };
        writeJson(USER_KEY, user);
      }
      emit(['session']);
      throw error;
    }
  }

  async function request(path, options = {}, allowRefresh = true) {
    if (!options.signal && (path === '/v1/ops' || path.startsWith('/v1/sync?'))) {
      return withSyncDeadline((signal) => request(path, { ...options, signal }, allowRefresh));
    }
    const headers = { ...(options.headers ?? {}) };
    if (token) headers.authorization = `Bearer ${token}`;
    if (options.body) headers['content-type'] = 'application/json';
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 401) {
      if (allowRefresh && user?.userId) {
        try {
          await refreshSession();
          return request(path, options, false);
        } catch (error) {
          // الفشل العابر في التجديد يستحق تراجع النقل، لا تحويله إلى رفض هوية.
          if (classifyFailure(error?.status ?? 0) === 'retry') throw error;
          // جهاز revoked أو credential مفقود: refreshSession طوى الجلسة.
        }
      } else {
        token = null;
        localStorage.removeItem(TOKEN_KEY);
        emit(['session']);
      }
      const error = new Error('unauthorized');
      error.status = 401;
      throw error;
    }

    if (response.status === 410 && user?.userId && !deletingHere) {
      // الخادم يقول: هذا الحساب حُذف نهائيًا (توكن قديم). المرآة تعرف، والتطبيق يخرج
      mirror.accounts = { ...(mirror.accounts ?? {}), [user.userId]: { ...(mirror.accounts?.[user.userId] ?? { user_id: user.userId }), lifecycle: 'DELETED' } };
      valuesCache = new Map();
      emit(['accounts']);
    }
    if (!response.ok) {
      const error = new Error(`http_${response.status}`);
      error.status = response.status;
      // B10: الخيط إلى سطر السجلّ عند الخادم. يُحمل على الخطأ فيصل إلى
      // `lastError` ومنه إلى البلاغ، بدل أن يبقى البلاغ يقول «ما اشتغل».
      error.correlationId = response.headers.get('x-correlation-id') ?? null;
      // رمز الخادم (`weekly_limit`، `translation_locked`…): الترجمة تعرض سببه بدل «http_429»
      error.translationError = await response
        .json()
        .then((b) => (typeof b?.error === 'string' ? b.error : null))
        .catch(() => null);
      throw error;
    }
    if (options.raw) return response;
    return response.status === 204 ? null : response.json();
  }

  // ───────────────────────── الجلسة ─────────────────────────

  async function pairDevice(pairingToken) {
    const response = await fetch(`${baseUrl}/v1/device/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairingToken, ...(await deviceProof(deviceIdProvider)) }),
    });
    if (!response.ok) throw new Error(`pair_${response.status}`);
    return response.json();
  }

  async function consumePairingUrl(value) {
    const url = new URL(value);
    const pairingToken = url.searchParams.get('pair');
    if (!pairingToken) return false;
    await pairDevice(pairingToken);
    return true;
  }

  async function consumePairingFromUrl() {
    if (typeof location === 'undefined') return;
    const url = new URL(location.href);
    if (!url.searchParams.has('pair')) return;

    try {
      await consumePairingUrl(url.href);
    } catch {
      // رمز مستهلك/منتهي لا يعني أن الخادم ساقط. نكمل إلى قائمة الحسابات؛
      // إن كان الجهاز غير موثوق فعلًا فمحاولة الدخول نفسها ستطلب pairing جديدًا.
    } finally {
      // لا نترك ?pair= معطوبًا في العنوان وإلا يعيد كل reload نفس الفشل.
      url.searchParams.delete('pair');
      if (typeof history !== 'undefined') {
        history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      }
    }
  }

  async function attachNativeLinkBridge(appPlugin) {
    if (
      !appPlugin ||
      typeof appPlugin.getLaunchUrl !== 'function' ||
      typeof appPlugin.addListener !== 'function'
    ) {
      return null;
    }

    // سجّل المستمع أولًا كي لا نفقد رابطًا يصل أثناء الإقلاع.
    const listener = await appPlugin.addListener('appUrlOpen', (event) => {
      if (typeof event?.url !== 'string') return;
      void consumePairingUrl(event.url).catch(() => {
        // رابط قديم/منتهي لا يقتل التطبيق. الدخول سيكشف إن كان الجهاز يحتاج pairing جديدًا.
      });
    });

    try {
      const launched = await appPlugin.getLaunchUrl();
      if (typeof launched?.url === 'string') {
        await consumePairingUrl(launched.url);
      }
    } catch {
      // cold-start pairing مساعد للإقلاع، وليس شرطًا لبناء واجهة التطبيق.
    }

    return listener;
  }

  /** قائمة الحسابات للشاشة الأولى. بلا توكن: تُطلب بعد pairing إن وُجد. */
  async function accounts() {
    await consumePairingFromUrl();
    const response = await fetch(`${baseUrl}/v1/accounts`);
    if (!response.ok) throw new Error(`http_${response.status}`);
    const body = await response.json();
    accountsLimit = Number(body.limit) || 10;
    return (body.content ?? []).map(accountWithIdentity);
  }

  /** اختيار الحساب هو الدخول، وإثبات الجهاز جزء من إصدار الجلسة. */
  async function signIn(userId, { pin } = {}) {
    const previousId = user?.userId ?? null;
    // إذن PIN يخص حسابه: الدخول لحساب آخر يبدأ بلا إذن
    if (previousId !== userId) keepGrant(null);
    let payload;
    try {
      payload = await sessionPayload(userId, pin === undefined ? {} : { pin });
    } catch (error) {
      // التثبيت النظيف يمسح credential. إذا كان هذا Android نفسه سبق اعتماده
      // ندوّر السر مرة واحدة؛ جهاز جديد فعليًا يبقى device_untrusted فتظهر
      // له شاشة الاعتماد الحالية بلا تغيير.
      if (error?.code !== 'device_untrusted') throw error;
      const recovery = await recoverDevice().catch(() => ({ recovered: false }));
      if (!recovery?.recovered) throw error;
      payload = await sessionPayload(userId);
    }
    persistSession(payload);
    if (previousId && previousId !== user.userId) resetAll();
    emit(['session']);
    return user;
  }

  /** حالة الحساب من مرآة المزامنة: ACTIVE، PENDING_DELETE، DELETED. */
  function gone(account) {
    return Boolean(account) && (account.lifecycle === 'PENDING_DELETE' || account.lifecycle === 'DELETED' || Boolean(account.deleted_at));
  }

  const OWNER_COLUMNS = ['user_id', 'author_id', 'from_id', 'to_id', 'sender_id', 'actor_id', 'target_user_id', 'owner_id'];
  function dropAccountRows(userId) {
    const touched = [];
    for (const [table, bucket] of Object.entries(mirror)) {
      if (table === 'accounts' || !bucket || typeof bucket !== 'object') continue;
      let changed = false;
      for (const [key, row] of Object.entries(bucket)) {
        if (!row || typeof row !== 'object') continue;
        // تنبيهك أنت عن فعلٍ له: يبقى تنبيهك، بلا اسمه
        if (table === 'notifications' && row.actor_id === userId && row.user_id !== userId) {
          bucket[key] = { ...row, actor_id: null };
          changed = true;
        } else if (OWNER_COLUMNS.some((column) => row[column] === userId)) {
          delete bucket[key];
          changed = true;
        }
      }
      if (changed) touched.push(table);
    }
    return touched;
  }

  function signOut() {
    keepGrant(null);
    sessionGeneration += 1;
    token = null;
    user = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    resetAll();
    emit(['session']);
  }

  async function logoutDevice() {
    // الإلغاء البعيد هو العملية الأمنية. إذا فشل لا نمسح الدليل المحلي ولا
    // ندّعي نجاح logout؛ يستطيع المستخدم إعادة المحاولة أو اختيار signOut محليًا.
    if (token) await request('/v1/device/logout', { method: 'POST' }, false);
    localStorage.removeItem(DEVICE_CREDENTIAL_KEY);
    signOut();
  }

  async function logoutAll() {
    if (token) await request('/v1/device/logout-all', { method: 'POST' }, false);
    localStorage.removeItem(DEVICE_CREDENTIAL_KEY);
    signOut();
  }

  /**
   * يعيد بناء المرآة من الصفر بلا لمس الطابور.
   *
   * كان `reset` واحدًا يمسح الطابور أيضًا، ويُنادى عند `reset: true` من الخادم
   * (استعادة D1 من نسخة احتياطية). أي أن استعادةً على الخادم كانت تمسح كتابات
   * المستخدم غير المرسلة — فقدٌ صامت لا علاقة له بسبب الاستعادة.
   */
  function resyncMirror() {
    cursor = 0;
    mirror = {};
    landing = [];
    valuesCache = new Map();
    localStorage.setItem(CURSOR_KEY, '0');
    persistMirror();
  }

  /** تبديل حساب أو خروج: كل شيء يُمسح، الطابور معه — ملك الحساب السابق. */
  function resetAll() {
    resyncMirror();
    queue = [];
    quarantine = [];
    attemptsOf.clear();
    nextPushAt = 0;
    overflowing = false;
    persistQueue();
    persistQuarantine();
  }

  // ───────────────────────── السحب ─────────────────────────

  /**
   * يسحب الفروقات ويطبّقها.
   *
   * التطبيق أولًا ثم الـcursor: العكس يفقد دفعة عند سقوط الشبكة. و`more`
   * تعني دفعة مقطوعة عند السقف، فنُكمل فورًا بلا انتظار الدورة القادمة.
   */
  async function pull() {
    if (!token) return;
    if (pulling) {
      pullAgain = true;
      return;
    }
    pulling = true;
    const generation = sessionGeneration;
    const pullUserId = user?.userId ?? null;
    try {
      // كل مسارات النداء تستخدم `void pull()`، فرفضٌ بلا معالجة كان يصبح
      // unhandled rejection: لا يظهر للمستخدم، ولا يُسجّل في صحة المزامنة
      for (let round = 0; round < MAX_PULL_ROUNDS; round += 1) {
        const payload = await request(`/v1/sync?since=${cursor}`);
        if (!payload) break;

        // رد بدأ تحت حساب/جلسة أقدم لا يملك حق لمس مرآة الحساب الحالي.
        if (generation !== sessionGeneration || pullUserId !== (user?.userId ?? null)) {
          pullAgain = true;
          break;
        }

        if (payload.reset) {
          // عدّاد الخادم رجع (استعادة نسخة احتياطية): نُعيد بناء المرآة، ولا
          // نمسّ الطابور — كتاباتنا غير المرسلة ليست جزءًا مما استُعيد
          resyncMirror();
          continue;
        }

        const touched = [];
        // شاهد قبر وصل: كل صف في المرآة يخص ذلك الـUUID يُمسح هنا أيضًا، فلا
        // يبقى على هذا الجهاز ما مُسح من الخادم (الخادم يمسح ولا يرسل «حُذف»)
        for (const account of payload.changes?.accounts ?? []) {
          if (account?.lifecycle === 'DELETED' && account.user_id) touched.push(...dropAccountRows(account.user_id));
        }
        for (const [table, rows] of Object.entries(payload.changes ?? {})) {
          const keyOf = KEYS[table];
          if (!keyOf || !Array.isArray(rows) || rows.length === 0) continue;
          const bucket = (mirror[table === 'public_work_views' ? 'work_views' : table] ??= {});
          for (const row of rows) bucket[keyOf(row)] = row;
          touched.push(table === 'public_work_views' ? 'work_views' : table);
        }
        for (const privacy of Object.values(mirror.view_privacy ?? {})) {
          if (privacy?.visible !== 0 || privacy.user_id === pullUserId) continue;
          let purged = false;
          for (const [key, row] of Object.entries(mirror.work_views ?? {})) {
            if (row.user_id !== privacy.user_id) continue;
            delete mirror.work_views[key];
            purged = true;
          }
          if (purged) touched.push('work_views');
        }

        persistMirror();
        cursor = Number(payload.cursor ?? cursor) || cursor;
        // ما لم يُرسل بعد، وما أُقرّ ولم يصل بعد، يبقى ظاهرًا فوق ما وصل:
        // سحبٌ أسبق من الكتابة لا يُرجع القلب ولا نقطة الإشعار
        if (landing.length) landing = landing.filter((l) => l.rev > cursor);
        refreshOverlay();
        localStorage.setItem(CURSOR_KEY, String(cursor));
        if (touched.length > 0) emit(touched);
        lastSyncAt = Date.now();
        localStorage.setItem('vantara.lastSync', String(lastSyncAt));
        if (!payload.more) {
          backlog = false;
          break;
        }
        // الجولة الأخيرة وما زال هناك مزيد: نخرج بالسقف، لكن لا نُعلنها
        // مزامنة تامّة، ونعود فورًا بدل انتظار الدورة التالية.
        if (round === MAX_PULL_ROUNDS - 1) {
          backlog = true;
          emit(['sync']);
          setTimeout(() => void pull(), 0);
        }
      }
      lastError = null;
      // مرآةٌ بلا حسابات: سُحبت قبل أن يرسل الخادم صفوف rev = 0 (الحسابات
      // المزروعة)، فالأسماء «صديق» والمجلس بلا وجوه. سحبٌ كامل مرة يصلحها
      if (cursor > 0 && !Object.keys(mirror.accounts ?? {}).length && !localStorage.getItem('vantara.resync.accounts')) {
        localStorage.setItem('vantara.resync.accounts', '1');
        resyncMirror();
        pullAgain = true;
      }
    } catch (error) {
      lastError = { status: error?.status ?? 0, at: Date.now(), correlationId: error?.correlationId ?? null };
      emit(['sync']);
    } finally {
      pulling = false;
      if (pullAgain) {
        pullAgain = false;
        queueMicrotask(() => void pull());
      }
    }
  }

  // ───────────────────────── الكتابة ─────────────────────────

  /**
   * يسجّل عملية ويرسلها.
   *
   * الـop_id يُولَّد مرة واحدة هنا ويبقى ثابتًا عبر كل إعادة إرسال — هذا ما
   * يمنع احتساب الفصل مرتين بعد انقطاع.
   */
  function enqueue(kind, payload = {}, { opId = crypto.randomUUID(), requireDurable = false } = {}) {
    const existing = queue.find((op) => op.opId === opId);
    if (existing) {
      if (!persistQueue() && requireDurable) throw new Error('تعذّر حفظ الوقت محليًا');
      schedulePush();
      return opId;
    }
    const op = { opId, kind, payload, at: Date.now() };
    queue.push(op);
    if (queue.length > MAX_QUEUE) {
      const trimmed = trimQueue(queue, MAX_QUEUE);
      queue = trimmed.ops;
      overflowing = trimmed.overflowing;
      pruneAttempts();
    }
    const saved = persistQueue();
    if (!saved && requireDurable) throw new Error('تعذّر حفظ الوقت محليًا');
    // الأثر يظهر الآن لا بعد الرحلة: القلب والنقطة والتفاعل يتغيرون تحت الإصبع
    const touched = new Set();
    try {
      for (const change of PROJECTIONS[kind]?.(op, (t, k) => overlay[t]?.[k] ?? mirror[t]?.[k] ?? null, user?.userId, mirror) ?? []) {
        touched.add(change.table);
      }
    } catch {
      // إسقاطٌ معطوب لا يمنع الكتابة نفسها
    }
    if (touched.size) emit([...touched]);
    schedulePush();
    return op.opId;
  }

  /**
   * يجمّع الكتابات المتلاحقة في إرسال واحد.
   *
   * التمرير يولّد عمليات تقدم كثيرة متتالية. الإرسال عند كل واحدة كان يُفرغ
   * الطابور عملية بعملية فلا يجد الضغط شيئًا يضغطه: ثلاثة طلبات مكان طلب،
   * وثلاث كتابات عند الخادم مكان أعلاها.
   */
  const ENQUEUE_DEBOUNCE_MS = 400;
  // A reader session can enqueue several SQL-heavy operations per chapter.
  // Sending 100 logical ops at once expands to hundreds of D1 statements; one
  // oversized/data-specific failure then blocks every later history/stat write.
  // Keep normal writes bounded, and peel one op on a retryable batch failure so
  // good writes can keep draining without losing the durable queue.
  const MAX_PUSH_BATCH = 12;

  function schedulePush() {
    if (pushTimer !== null) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      void push();
    }, ENQUEUE_DEBOUNCE_MS);
  }

  /**
   * يرسل الطابور.
   *
   * `force` يتجاوز التراجع: عودة الاتصال أو ضغط المستخدم على «مزامنة الآن»
   * سببان يستحقان محاولة فورية، بينما الدورة الزمنية تحترم التراجع.
   */
  async function push({ force = false } = {}) {
    if (!token || queue.length === 0) return;
    if (pushing) {
      // طلب أثناء إرسال جارٍ لا يُهمل: الدفعة الحالية قد لا تحمل آخر عملية
      pushAgain = true;
      await new Promise(resolve => pushWaiters.push(resolve));
      return push({ force });
    }
    if (!force && Date.now() < nextPushAt) return;
    if (!force && typeof navigator !== 'undefined' && navigator.onLine === false) return;

    pushing = true;
    try {
      // لا شيء في الطريق الآن، فالضغط آمن: يقلّص الطلبات بعد انقطاع طويل
      const compacted = compactQueue(queue);
      if (compacted.length !== queue.length) {
        queue = compacted;
        pruneAttempts();
        persistQueue();
      }

      while (queue.length > 0) {
        let batch = queue.slice(0, MAX_PUSH_BATCH);
        let payload;
        try {
          payload = await request('/v1/ops', { method: 'POST', body: { ops: batch } });
        } catch (error) {
          let effectiveError = error;
          const initialStatus = error?.status ?? 0;

          // 5xx on a multi-op batch may be D1 statement pressure or one poison
          // operation. Probe only the first durable op. If it succeeds, remove it
          // normally and continue; the backlog drains instead of wedging forever.
          // If it also fails, treat just that op as the failed unit — repeated
          // retries can quarantine that one without sacrificing the other chapters.
          if (initialStatus >= 500 && batch.length > 1) {
            const probe = [batch[0]];
            try {
              payload = await request('/v1/ops', { method: 'POST', body: { ops: probe } });
              batch = probe;
              effectiveError = null;
            } catch (probeError) {
              batch = probe;
              effectiveError = probeError;
            }
          }

          if (effectiveError) {
            const status = effectiveError?.status ?? 0;
            lastError = { status, at: Date.now(), correlationId: effectiveError?.correlationId ?? null };
            const verdict = classifyFailure(status);
            // الجلسة انتهت: الكتابات سليمة وتنتظر جلسة جديدة، فلا عزل ولا تراجع
            if (verdict === 'auth') return;

            for (const op of batch) {
              const attempts = (attemptsOf.get(op.opId) ?? 0) + 1;
              attemptsOf.set(op.opId, attempts);
              if (shouldQuarantine({ attempts, status })) quarantineOp(op, status, verdict);
            }
            const worst = Math.max(...batch.map((op) => attemptsOf.get(op.opId) ?? 1));
            nextPushAt = Date.now() + nextAttemptDelay(worst);
            emit(['sync']);
            return;
          }
        }

        const settled = new Set([...(payload?.applied ?? []), ...(payload?.skipped ?? [])]);
        // استجابة ناجحة لا تذكر عملية تعني أن الخادم رفضها عند التحليل — لا
        // تصلح بإعادة الإرسال. تُعزل حالًا بدل أن تُحاول إلى الأبد.
        for (const op of batch) {
          if (!settled.has(op.opId)) quarantineOp(op, 422, 'not_settled');
        }
        const writtenAt = Number(payload?.serverRev ?? payload?.cursor ?? 0);
        if (writtenAt > cursor) {
          for (const op of batch) if (settled.has(op.opId) && PROJECTIONS[op.kind]) landing.push({ op, rev: writtenAt });
          if (landing.length > 400) landing = landing.slice(-400);
        }
        queue = queue.filter((op) => !settled.has(op.opId));
        pruneAttempts();
        persistQueue();

        lastSuccessAt = Date.now();
        localStorage.setItem('vantara.lastPush', String(lastSuccessAt));
        lastError = null;
        nextPushAt = 0;
        overflowing = false;
        if (settled.size === 0) break;
      }
      // الكتابة تُنتج revs جديدة: نسحبها فورًا حتى يرى الجهاز أثر كتابته
      await pull();
      emit(['sync']);
    } finally {
      pushing = false;
      const waiters = pushWaiters;
      pushWaiters = [];
      for (const resolve of waiters) resolve();
      if (pushAgain) {
        pushAgain = false;
        schedulePush();
      }
    }
  }

  /**
   * يعيد المعزولات إلى الطابور.
   *
   * قرار المستخدم لا قرارنا: بعض العزل سببه عطل زائل (نسخة خادم قديمة لا تعرف
   * نوع العملية) وتستحق محاولة ثانية بعد التحديث.
   */
  function retryQuarantined() {
    if (quarantine.length === 0) return 0;
    const revived = quarantine.map((entry) => entry.op).filter(Boolean);
    // الإعادة قد تتجاوز السقف: نفس قاعدة التقليم تُطبَّق، فلا تُسقط الإعادة
    // عملية تراكمية كانت في الطابور
    const trimmed = trimQueue(queue.concat(revived), MAX_QUEUE);
    queue = trimmed.ops;
    overflowing = trimmed.overflowing;
    quarantine = [];
    persistQuarantine();
    persistQueue();
    void push({ force: true });
    return revived.length;
  }

  function health() {
    return syncHealth({
      lastSyncAt,
      backlog,
      pending: queue.length,
      quarantined: quarantine.length,
      lastSuccessAt,
      lastError,
      online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
      durable,
      overflowing,
      now: Date.now(),
    });
  }

  // ───────────────────────── الحضور ─────────────────────────

  async function beat(body) {
    if (!token) return;
    try {
      await request('/v1/presence', { method: 'POST', body });
    } catch {
      // نبضة فائتة لا تستحق خطأً مرئيًا
    }
  }

  async function presence() {
    if (!token) return [];
    try {
      return ((await request('/v1/presence'))?.content ?? []).map(accountWithIdentity);
    } catch {
      return [];
    }
  }

  /**
   * طلب الترجمة: يرجع `{ status, body }` ولا يرمي على 4xx/5xx — القارئ يحتاج
   * سبب الرفض (غير مفعّلة، الحد اليومي، مشغول) لا مجرد «فشل».
   */
  async function translation(path, options = {}) {
    if (!token) return { status: 401, body: { error: 'unauthorized' } };
    try {
      // طلب معلّق على نت ضعيف لا ينتظر للأبد: يُقطع فيُعاد كعطل عابر
      const signal = globalThis.AbortSignal?.timeout ? AbortSignal.timeout(TRANSLATION_TIMEOUT_MS) : undefined;
      return { status: 200, body: await request(path, { ...options, signal }) };
    } catch (error) {
      if (!error?.status) return { status: 0, body: { error: 'offline' } };
      return { status: error.status, body: { error: error.translationError ?? `http_${error.status}` } };
    }
  }

  /**
   * طلب بثّ (SSE): الرد كما هو ليُقرأ وهو يصل. الجلسة تتجدد كالعادة، والخطأ يرجع
   * بحالته ورمز الخادم (`rafiq_locked`…).
   */
  async function stream(path, body, { signal } = {}) {
    if (!token) return { status: 401, error: 'unauthorized' };
    try {
      return { status: 200, response: await request(path, { method: 'POST', body, signal, raw: true }) };
    } catch (error) {
      if (error?.name === 'AbortError') return { status: 0, error: 'aborted' };
      if (!error?.status) return { status: 0, error: 'offline' };
      return { status: error.status, error: error.translationError ?? `http_${error.status}` };
    }
  }

  async function stats(userId) {
    if (!token) return null;
    try {
      return await request(`/v1/stats/${encodeURIComponent(userId)}`);
    } catch {
      return null;
    }
  }

  async function insights(userId, seriesRef = null) {
    if (!token) return null;
    try {
      const work = seriesRef ? `?work=${encodeURIComponent(seriesRef)}` : '';
      return await request(`/v1/insights/${encodeURIComponent(userId)}${work}`);
    } catch (error) {
      if (error?.status === 403) return { locked: true };
      return null;
    }
  }

  // ───────────────────────── دورة حياة الحساب ─────────────────────────

  /** طلب لا يرمي: `{ ok, status, data }` — رموز PIN والسقف تُقرأ من data. */
  async function accountCall(path, body, { withDevice = false } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (token && !withDevice) headers.authorization = `Bearer ${token}`;
    const payload = withDevice ? { ...body, ...(await deviceProof(deviceIdProvider)) } : body;
    let response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(payload ?? {}) });
    if (response.status === 401 && !withDevice && user?.userId) {
      // توكن انتهى (15 دقيقة): جدّد مرة ثم أعد
      const data = await response.clone().json().catch(() => null);
      if (data?.error === 'unauthorized') {
        await refreshSession().catch(() => {});
        if (token) headers.authorization = `Bearer ${token}`;
        response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(payload ?? {}) });
      }
    }
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  }

  /** حساب جديد: من داخل حساب (بالجلسة) أو من «من يتابع؟» (بإثبات الجهاز). */
  async function createAccount({ username, displayName, avatarKey = null }) {
    return accountCall('/v1/accounts/create', { username, displayName, avatarKey }, { withDevice: !token });
  }

  /** فتح حساب عليه PIN بعد أن أُغلق التطبيق (الجلسة موجودة والإذن لا). */
  async function unlock(pin) {
    const payload = await sessionPayload(user.userId, { pin });
    persistSession(payload);
    emit(['session']);
    return user;
  }

  function rememberPinDigits(digits) {
    if (!user) return;
    user = { ...user, pinDigits: digits ?? null };
    writeJson(USER_KEY, user);
    emit(['session']);
  }

  async function setPin(pin, currentPin) {
    const out = await accountCall('/v1/pin', { action: 'set', pin, ...(currentPin ? { currentPin } : {}) });
    if (out.ok) {
      keepGrant(out.data?.pinGrant);
      rememberPinDigits(out.data?.digits ?? pin.length);
    }
    return out;
  }

  async function removePin(currentPin) {
    const out = await accountCall('/v1/pin', { action: 'remove', currentPin });
    if (out.ok) {
      keepGrant(null);
      rememberPinDigits(null);
    }
    return out;
  }

  /**
   * الحذف: PENDING_DELETE على الخادم (لا شيء يُمسح)، ثم عشر ثوانٍ، ثم المسح
   * النهائي. هذا الجهاز يعرف أنه صاحب العدّ، فلا يعامل حالته كحذف من جهاز آخر.
   */
  async function deleteAccount(pin) {
    const out = await accountCall('/v1/accounts/delete', pin ? { pin } : {});
    if (out.ok) deletingHere = true;
    return out;
  }
  async function restoreAccount() {
    const out = await accountCall('/v1/accounts/restore', {});
    if (out.ok && out.data?.restored) deletingHere = false;
    return out;
  }
  /** بعد العدّ: الخادم يمسح إن انتهت المهلة، وإلا يقول كم بقي فننتظره. ثم خروج. */
  async function commitDeletion() {
    let out = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      out = await accountCall('/v1/accounts/delete/commit', {}).catch(() => null);
      const wait = out?.data?.state === 'PENDING_DELETE' ? Number(out.data.retryInMs) || 0 : 0;
      if (!wait) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(wait + 150, 5_000)));
    }
    deletingHere = false;
    signOut();
    return out;
  }

  /**
   * رفع صورة ملف شخصي (الصورة أو البانر). يرجع `{ url, hash }`.
   *
   * جسمٌ ثنائي لا JSON، فلا يمرّ من `request`. والفشل يُرمى بحالته: الواجهة
   * تفرّق بين «كبيرة» (413) و«ليست صورة» (415) و«لا اتصال».
   */
  async function uploadMedia(blob, attempt = 0) {
    if (!token) throw Object.assign(new Error('unauthorized'), { status: 401 });
    const response = await fetch(`${baseUrl}/v1/media`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': blob.type || 'application/octet-stream' },
      body: blob,
    });
    if (response.status === 401 && attempt === 0 && user?.userId) {
      await refreshSession();
      return uploadMedia(blob, 1);
    }
    if (!response.ok) throw Object.assign(new Error(`http_${response.status}`), { status: response.status });
    return response.json();
  }

  /** «أفضل 5» لأي حساب: واجهة الملف يراها الأصدقاء. */
  async function topWorks(userId) {
    if (!token) return [];
    try {
      const out = await request(`/v1/collections?kind=top&user=${encodeURIComponent(userId)}`);
      return out?.content ?? [];
    } catch {
      return [];
    }
  }

  /**
   * صفوف التقدم التي لم يستلمها مالكها بعد.
   *
   * تُقرأ من الخادم لا من المرآة المحلية: الصندوق قد يحمل ما كتبه جهاز آخر
   * وفشلت كتابته عند المالك، وهذا الجهاز هو من يستطيع تصريفه الآن.
   */
  async function pendingProgress() {
    if (!token) return null;
    return await request('/v1/progress/pending');
  }

  // ───────────────────────── القراءة المحلية ─────────────────────────

  /** صف لكيان داخلي (فحص/اختبار): مراجعه تبدأ بـ`__`. */
  const INTERNAL = /^__/;
  const isInternalRow = (r) =>
    INTERNAL.test(String(r?.series_ref ?? '')) || INTERNAL.test(String(r?.chapter_key ?? '')) || INTERNAL.test(String(r?.username ?? '')) || INTERNAL.test(String(r?.user_id ?? ''));

  /** صفوف جدول من المرآة، مُرشَّحة اختياريًا. */
  /** الشاشات ترى الملفات بهويتها الأساسية مكان الفارغ؛ المرآة نفسها لا تتغير. */
  const view = (table, value) => {
    if (table !== 'profiles' || !value) return value;
    return withIdentity(value, mirror.accounts?.[value.user_id]?.username);
  };

  function rows(table, predicate) {
    let all = valuesCache.get(table);
    if (!all) {
      const bucket = overlay[table] ? { ...mirror[table], ...overlay[table] } : mirror[table];
      if (!bucket) return [];
      all = table === 'profiles' ? Object.values(bucket).map((r) => view(table, r)) : Object.values(bucket);
      // حارس مركزي: ما يكتبه فحص الخادم (`__verify__…`) وأي كيان داخلي لا يصل شاشة أبدًا
      all = all.filter((r) => !isInternalRow(r));
      // حساب في مهلة الحذف أو محذوف (شاهد قبر): يختفي هو وملفه من كل شاشة
      if (table === 'accounts') all = all.filter((r) => !gone(r));
      else if (table === 'profiles') all = all.filter((r) => !gone(mirror.accounts?.[r.user_id]));
      valuesCache.set(table, all);
    }
    return predicate ? all.filter(predicate) : [...all];
  }

  function row(table, key) {
    return view(table, overlay[table]?.[key] ?? mirror[table]?.[key] ?? null);
  }

  /**
   * هل عند الخادم جديد؟ رقم واحد لا فروقات: رخيص بما يكفي ليُسأل كل ثوانٍ
   * والتطبيق مفتوح، فتصل رسالة صديقك وإيصاله في ثوانٍ.
   */
  async function pulse() {
    if (!token || pulling) return;
    try {
      const out = await request('/v1/pulse');
      if (Number(out?.rev) > cursor) await pull();
    } catch {
      // نبضة فائتة؛ السحب الدوري يلتقط ما فات
    }
  }

  /**
   * عودة الاتصال محاولة فورية.
   *
   * الدورة الزمنية كل 15 ثانية مع تراجع أُسّي قد تُبقي كتابة تنتظر دقائق بعد
   * عودة الشبكة فعلًا. حدث `online` يعرف اللحظة بالضبط، فنتجاوز التراجع مرة.
   */
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      nextPushAt = 0;
      void push({ force: true });
      void pull();
    });
    window.addEventListener('offline', () => emit(['sync']));
    // الخروج من التطبيق: آخر فرصة لإرسال ما تراكم قبل أن يُجمَّد التبويب
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void push({ force: true });
    });
  }

  return {
    get user() {
      return user;
    },
    get signedIn() {
      return Boolean(token);
    },
    get authorizationHeader() {
      return token ? `Bearer ${token}` : null;
    },
    async playerPresence() {
      if (!token || !user?.userId) return null;
      return { authorization: `Bearer ${token}`, userId: user.userId, ...(await deviceProof(deviceIdProvider)) };
    },
    get pendingWrites() {
      return queue.length;
    },
    accounts,
    get accountsLimit() {
      return accountsLimit;
    },
    createAccount,
    unlock,
    setPin,
    removePin,
    deleteAccount,
    restoreAccount,
    commitDeletion,
    /** حالة حسابك كما وصلت بالمزامنة: ACTIVE، PENDING_DELETE، DELETED. */
    get accountState() {
      const row = user?.userId ? mirror.accounts?.[user.userId] : null;
      return row?.lifecycle ?? 'ACTIVE';
    },
    /** هذا الجهاز هو من بدأ الحذف (عدّه التنازلي ظاهر هنا). */
    get deletingHere() {
      return deletingHere;
    },
    /** الحساب الحالي عليه PIN ولم يُدخل منذ فُتح التطبيق. */
    get locked() {
      return Boolean(user?.pinDigits) && !pinGrant;
    },
    requestDevice,
    claimDevice,
    approveDevice,
    pendingDevices,
    pairDevice,
    consumePairingUrl,
    attachNativeLinkBridge,
    refreshSession,
    signIn,
    signOut,
    logoutDevice,
    logoutAll,
    pull,
    pulse,
    push,
    enqueue,
    beat,
    presence,
    uploadMedia,
    topWorks,
    stats,
    insights,
    translation,
    stream,
    pendingProgress,
    latestSnapshots: () => request('/v1/source-latest'),
    privacyCapability: () => request('/v1/privacy/capabilities'),
    claimLatest: (sourceId) => request('/v1/source-latest/claim', { method: 'POST', body: { sourceId } }),
    publishLatest: (sourceId, value, leaseUntil) => request('/v1/source-latest', { method: 'POST', body: { sourceId, value, leaseUntil } }),
    health,
    retryQuarantined,
    /**
     * إعادة بناء المرآة من الخادم.
     *
     * مخرج صريح حين تبدو البيانات المحلية غريبة: يمسح المرآة والـcursor ولا
     * يمسّ الطابور. بلا مسار كهذا كان الحل الوحيد تسجيل خروج ودخول — وذلك
     * يمسح كتابات غير مرسلة.
     */
    async resync() {
      resyncMirror();
      emit(['sync']);
      await pull();
    },
    get quarantined() {
      return quarantine.length;
    },
    rows,
    row,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
