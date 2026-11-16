/**
 * إشعارات الجوال (Android) والتطبيق مغلق: الواجهة تأخذ من الخادم «رمز إشعارات» ضيقًا لهذا
 * الجهاز وتسلّمه للفحص الدوري الأصلي (com.vantara.notify)، ولا تحفظه هي. الرمز لا يقرأ إلا
 * إشعارات صاحبه غير المعروضة. يُلغى بالخروج أو تبديل الحساب أو إطفاء «إشعارات الجوال».
 *
 * بلا FCM: الجديد يصل والتطبيق مغلق خلال 15 دقيقة (أقل ما يسمح به Android)، وفورًا والتطبيق
 * مفتوح (المنبثق داخله).
 */

const KEY = 'vantara.phoneNotify.v1';

function read(storage) {
  try {
    return JSON.parse(storage?.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}
function write(storage, value) {
  try {
    if (value) storage?.setItem(KEY, JSON.stringify(value));
    else storage?.removeItem(KEY);
  } catch {
    // تخزين محجوب: يُطلب رمز جديد في المرة القادمة، والخادم يُسقط الأقدم فوق السقف
  }
}

/** هل يريد صاحب الحساب إشعارات الجوال؟ مفعّلة ما لم يطفئها صراحة. */
export function phoneWanted(settingsRow) {
  let data = {};
  try {
    const raw = settingsRow?.data;
    data = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {});
  } catch {
    data = {};
  }
  return data?.notifications?.phone !== false;
}

/**
 * @param {{ plugin: any, endpoint: string, authHeader: () => string|null, fetchImpl?: typeof fetch, storage?: Storage }} deps
 */
export function createPhoneNotify({ plugin, endpoint, authHeader, fetchImpl = globalThis.fetch?.bind(globalThis), storage = globalThis.localStorage }) {
  const native = Boolean(plugin?.configure);
  let running = null;

  async function stop() {
    write(storage, null);
    await plugin?.clear?.().catch?.(() => {});
  }

  async function start(userId) {
    const auth = authHeader();
    if (!auth || !endpoint?.startsWith('https://')) return false;
    const res = await fetchImpl(`${endpoint}/v1/notify/device`, { method: 'POST', headers: { authorization: auth } });
    if (!res.ok) return false;
    const { token } = await res.json();
    if (typeof token !== 'string') return false;
    await plugin.configure({ endpoint, token });
    write(storage, { userId });
    return true;
  }

  /** يطابق الجهاز مع الحالة: الحساب الحالي وإعداده. آمن للنداء بعد كل مزامنة. */
  function ensure(userId, wanted) {
    if (!native) return Promise.resolve(false);
    if (running) return running;
    running = (async () => {
      const saved = read(storage);
      if (!userId || !wanted) {
        if (saved) await stop();
        return false;
      }
      if (saved?.userId === userId) {
        const status = await plugin.status?.().catch?.(() => null);
        if (status?.configured) return true;
      } else if (saved) await stop();
      return start(userId);
    })()
      .catch(() => false)
      .finally(() => {
        running = null;
      });
    return running;
  }

  return {
    native,
    ensure,
    stop,
    /** ذهب التطبيق للخلفية ووصل جديد: فحص الآن بدل انتظار الدورة. */
    nudge: () => void plugin?.checkNow?.().catch?.(() => {}),
    status: () => (native ? plugin.status().catch(() => null) : Promise.resolve(null)),
    requestPermission: () => (native ? plugin.requestPermission().catch(() => null) : Promise.resolve(null)),
    openSettings: () => void plugin?.openSettings?.().catch?.(() => {}),
  };
}

/**
 * رابط إشعار الجوال (vantara://…?n=<id>): إلى أين يفتح، وأي إشعار يُعلَّم مقروءًا.
 * null لغير روابط الإشعارات (ربط الأجهزة مثلًا يمر من sync.js).
 */
export function notificationLinkTarget(url) {
  if (typeof url !== 'string' || !url.startsWith('vantara://')) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.searchParams.has('pair')) return null;
  const read = parsed.searchParams.get('n');
  const together = /#together=([A-Z0-9]{6})/.exec(url)?.[1] ?? null;
  // URL لا يعرف المخطط المخصص: المضيف والمسار يُقرآن من النص نفسه
  const rest = url.slice('vantara://'.length).split(/[?#]/)[0];
  const [host, ...parts] = rest.split('/');
  const decode = (v) => {
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  if (together) return { read, open: { name: 'together', code: together } };
  if (host === 'series' && parts[0]) return { read, open: { name: 'series', ref: decode(parts[0]) } };
  if (host === 'frame' && parts[0]) return { read, open: { name: 'frame', id: decode(parts[0]) } };
  if (host === 'majlis') return { read, open: { name: 'majlis' } };
  return { read, open: { name: 'notifications' } };
}
