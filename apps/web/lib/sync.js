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

const TOKEN_KEY = 'vantara.token';
const USER_KEY = 'vantara.user';
const CURSOR_KEY = 'vantara.cursor';
const QUEUE_KEY = 'vantara.queue';
const MIRROR_KEY = 'vantara.mirror';

/** سقف الطابور. تجاوزه يعني انقطاعًا طويلًا جدًا، وأقدم عملية تُسقط أولًا. */
const MAX_QUEUE = 500;

/** الجداول التي تصل في الفروقات، ومفتاح كل صف. */
const KEYS = {
  accounts: (row) => row.user_id,
  profiles: (row) => row.user_id,
  library: (row) => `${row.user_id}/${row.series_ref}`,
  progress: (row) => `${row.user_id}/${row.chapter_key}`,
  chapter_reads: (row) => `${row.user_id}/${row.chapter_key}`,
  usage_daily: (row) => `${row.user_id}/${row.day}`,
  collections: (row) => `${row.user_id}/${row.kind}/${row.series_ref}`,
  ratings: (row) => `${row.user_id}/${row.series_ref}`,
  comments: (row) => row.id,
  reactions: (row) => `${row.comment_id}/${row.user_id}/${row.emoji}`,
  recommendations: (row) => row.id,
  notifications: (row) => row.id,
  activity: (row) => row.id,
  settings: (row) => row.user_id,
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

export function createSync({ baseUrl }) {
  const listeners = new Set();
  let token = localStorage.getItem(TOKEN_KEY) ?? null;
  let user = readJson(USER_KEY, null);
  let cursor = Number(localStorage.getItem(CURSOR_KEY) ?? '0') || 0;
  let queue = readJson(QUEUE_KEY, []);
  let mirror = readJson(MIRROR_KEY, {});
  let pulling = false;
  let pushing = false;

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
  const persistQueue = () => writeJson(QUEUE_KEY, queue);

  async function request(path, options = {}) {
    const headers = { ...(options.headers ?? {}) };
    if (token) headers.authorization = `Bearer ${token}`;
    if (options.body) headers['content-type'] = 'application/json';
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (response.status === 401) {
      // السرّ دُوّر أو التوكن انتهى: الجلسة تُطوى ويُعاد المستخدم للاختيار
      token = null;
      localStorage.removeItem(TOKEN_KEY);
      emit(['session']);
      throw new Error('unauthorized');
    }
    if (!response.ok) throw new Error(`http_${response.status}`);
    return response.status === 204 ? null : response.json();
  }

  // ───────────────────────── الجلسة ─────────────────────────

  /** قائمة الحسابات للشاشة الأولى. بلا توكن: تُطلب قبل أي جلسة. */
  async function accounts() {
    const response = await fetch(`${baseUrl}/v1/accounts`);
    if (!response.ok) throw new Error(`http_${response.status}`);
    return (await response.json()).content ?? [];
  }

  /** اختيار الحساب هو الدخول. لا كلمة مرور ولا خطوة تحقق. */
  async function signIn(userId) {
    const response = await fetch(`${baseUrl}/v1/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const payload = await response.json();
    // يُقرأ قبل الكتابة: المقارنة بعدها تتساوى دائمًا
    const previousId = user?.userId ?? null;
    token = payload.token;
    user = payload.user;
    // حساب مختلف على نفس الجهاز: المرآة والـcursor يُبنيان من الصفر، وإلا
    // ظهرت مكتبة المستخدم السابق لهذا. نفس الحساب يحفظ مرآته فيفتح فورًا.
    if (previousId && previousId !== user.userId) reset();
    localStorage.setItem(TOKEN_KEY, token);
    writeJson(USER_KEY, user);
    emit(['session']);
    return user;
  }

  function signOut() {
    token = null;
    user = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    reset();
    emit(['session']);
  }

  function reset() {
    cursor = 0;
    mirror = {};
    queue = [];
    localStorage.setItem(CURSOR_KEY, '0');
    persistMirror();
    persistQueue();
  }

  // ───────────────────────── السحب ─────────────────────────

  /**
   * يسحب الفروقات ويطبّقها.
   *
   * التطبيق أولًا ثم الـcursor: العكس يفقد دفعة عند سقوط الشبكة. و`more`
   * تعني دفعة مقطوعة عند السقف، فنُكمل فورًا بلا انتظار الدورة القادمة.
   */
  async function pull() {
    if (!token || pulling) return;
    pulling = true;
    try {
      for (let round = 0; round < 20; round += 1) {
        const payload = await request(`/v1/sync?since=${cursor}`);
        if (!payload) break;

        if (payload.reset) {
          // عدّاد الخادم رجع (استعادة نسخة احتياطية): نُعيد البناء لا نتوقف
          reset();
          continue;
        }

        const touched = [];
        for (const [table, rows] of Object.entries(payload.changes ?? {})) {
          const keyOf = KEYS[table];
          if (!keyOf || !Array.isArray(rows) || rows.length === 0) continue;
          const bucket = (mirror[table] ??= {});
          for (const row of rows) bucket[keyOf(row)] = row;
          touched.push(table);
        }

        persistMirror();
        cursor = Number(payload.cursor ?? cursor) || cursor;
        localStorage.setItem(CURSOR_KEY, String(cursor));
        if (touched.length > 0) emit(touched);
        if (!payload.more) break;
      }
    } finally {
      pulling = false;
    }
  }

  // ───────────────────────── الكتابة ─────────────────────────

  /**
   * يسجّل عملية ويرسلها.
   *
   * الـop_id يُولَّد مرة واحدة هنا ويبقى ثابتًا عبر كل إعادة إرسال — هذا ما
   * يمنع احتساب الفصل مرتين بعد انقطاع.
   */
  function enqueue(kind, payload = {}) {
    const op = { opId: crypto.randomUUID(), kind, payload };
    queue.push(op);
    // الأقدم يُسقط أولًا: طابور ممتلئ يعني انقطاعًا طويلًا، وأحدث نية أهم
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    persistQueue();
    void push();
    return op.opId;
  }

  async function push() {
    if (!token || pushing || queue.length === 0) return;
    pushing = true;
    try {
      while (queue.length > 0) {
        const batch = queue.slice(0, 100);
        const payload = await request('/v1/ops', { method: 'POST', body: { ops: batch } });
        const settled = new Set([...(payload?.applied ?? []), ...(payload?.skipped ?? [])]);
        // يُزال المؤكَّد فقط. ما لم يُذكر يبقى في الطابور لدورة قادمة.
        queue = queue.filter((op) => !settled.has(op.opId));
        persistQueue();
        if (settled.size === 0) break;
      }
      // الكتابة تُنتج revs جديدة: نسحبها فورًا حتى يرى الجهاز أثر كتابته
      await pull();
    } catch {
      // الشبكة ساقطة: الطابور محفوظ، والدورة القادمة تُعيد المحاولة
    } finally {
      pushing = false;
    }
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
      return (await request('/v1/presence'))?.content ?? [];
    } catch {
      return [];
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

  // ───────────────────────── القراءة المحلية ─────────────────────────

  /** صفوف جدول من المرآة، مُرشَّحة اختياريًا. */
  function rows(table, predicate) {
    const bucket = mirror[table];
    if (!bucket) return [];
    const all = Object.values(bucket);
    return predicate ? all.filter(predicate) : all;
  }

  function row(table, key) {
    return mirror[table]?.[key] ?? null;
  }

  return {
    get user() {
      return user;
    },
    get signedIn() {
      return Boolean(token);
    },
    get pendingWrites() {
      return queue.length;
    },
    accounts,
    signIn,
    signOut,
    pull,
    push,
    enqueue,
    beat,
    presence,
    stats,
    rows,
    row,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
