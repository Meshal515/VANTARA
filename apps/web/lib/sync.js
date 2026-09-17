/**
 * عميل المزامنة.
 *
 * النموذج: الواجهة تقرأ من مرآة محلية دائمًا، والشبكة تُصحّح المرآة في
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
const DEVICE_ID_KEY = 'vantara.device.id';
const DEVICE_CREDENTIAL_KEY = 'vantara.device.credential';

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

function randomSecret(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * إثبات الجهاز يُنشأ مرة واحدة ويبقى محليًا. الـWorker لا يخزّن القيمة نفسها،
 * بل HMAC لها فقط. حذفه من التخزين يعني أن الجهاز يحتاج pairing جديدًا.
 */
function deviceProof() {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  let deviceCredential = localStorage.getItem(DEVICE_CREDENTIAL_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  if (!deviceCredential) {
    deviceCredential = randomSecret();
    localStorage.setItem(DEVICE_CREDENTIAL_KEY, deviceCredential);
  }
  return { deviceId, deviceCredential };
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

  async function sessionPayload(userId) {
    const response = await fetch(`${baseUrl}/v1/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, ...deviceProof() }),
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    return response.json();
  }

  function persistSession(payload) {
    token = payload.token;
    user = payload.user;
    localStorage.setItem(TOKEN_KEY, token);
    writeJson(USER_KEY, user);
  }

  async function request(path, options = {}, allowRefresh = true) {
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
          persistSession(await sessionPayload(user.userId));
          return request(path, options, false);
        } catch {
          // revoke أو credential مفقود: هنا فقط نعود لشاشة الاختيار/pairing.
        }
      }
      token = null;
      localStorage.removeItem(TOKEN_KEY);
      emit(['session']);
      throw new Error('unauthorized');
    }
    if (!response.ok) throw new Error(`http_${response.status}`);
    return response.status === 204 ? null : response.json();
  }

  // ───────────────────────── الجلسة ─────────────────────────

  async function pairDevice(pairingToken) {
    const response = await fetch(`${baseUrl}/v1/device/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairingToken, ...deviceProof() }),
    });
    if (!response.ok) throw new Error(`pair_${response.status}`);
    return response.json();
  }

  /** رابط Owner من نوع `?pair=...` يُستهلك مرة واحدة بلا form أو PIN. */
  async function consumePairingFromUrl() {
    if (typeof location === 'undefined') return;
    const url = new URL(location.href);
    const pairingToken = url.searchParams.get('pair');
    if (!pairingToken) return;
    await pairDevice(pairingToken);
    url.searchParams.delete('pair');
    if (typeof history !== 'undefined') {
      history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }

  /** قائمة الحسابات للشاشة الأولى. بلا توكن: تُطلب قبل أي جلسة. */
  async function accounts() {
    await consumePairingFromUrl();
    const response = await fetch(`${baseUrl}/v1/accounts`);
    if (!response.ok) throw new Error(`http_${response.status}`);
    return (await response.json()).content ?? [];
  }

  /** اختيار الحساب هو الدخول. لا كلمة مرور ولا PIN ولا form. */
  async function signIn(userId) {
    const previousId = user?.userId ?? null;
    const payload = await sessionPayload(userId);
    persistSession(payload);
    if (previousId && previousId !== user.userId) reset();
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

  async function logoutDevice() {
    if (token) await request('/v1/device/logout', { method: 'POST' }, false).catch(() => {});
    signOut();
  }

  async function logoutAll() {
    if (token) await request('/v1/device/logout-all', { method: 'POST' }, false).catch(() => {});
    signOut();
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

  async function pull() {
    if (!token || pulling) return;
    pulling = true;
    try {
      for (let round = 0; round < 20; round += 1) {
        const payload = await request(`/v1/sync?since=${cursor}`);
        if (!payload) break;

        if (payload.reset) {
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

  function enqueue(kind, payload = {}) {
    const op = { opId: crypto.randomUUID(), kind, payload };
    queue.push(op);
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
        queue = queue.filter((op) => !settled.has(op.opId));
        persistQueue();
        if (settled.size === 0) break;
      }
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
    pairDevice,
    signIn,
    signOut,
    logoutDevice,
    logoutAll,
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
