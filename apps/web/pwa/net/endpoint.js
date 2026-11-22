/**
 * من أين يجلب الويب صفحات المصادر وصورها (للـPWA وحدها؛ الجوال وويندوز يجلبان من الجهاز نفسه).
 *
 * قرار المالك (20 نوفمبر 2026): لا محتوى عبر خادم فانتارا. Cloudflare طبقة للخدمات (المزامنة والأصدقاء) لا للمحتوى.
 * ثلاث طرق، بالترتيب:
 *  1. **«جسرك الخاص»** (`bridge`): جالب ينشره المستخدم في حساب Cloudflare الخاص به (apps/web/bridge/vantara-bridge.js)
 *     بمفتاح بينه وبين متصفحه. المحتوى يمر عبر حسابه هو. يُضبط من الإعدادات.
 *  2. **جالب مستضاف صراحة للتجربة** (`hosted`): `localStorage['vantara.fetch.url']` فقط (للمطورين)، بتوكن الحساب.
 *  3. **مباشر** (`direct`): من المتصفح نفسه؛ يعمل مع المصادر التي تسمح بذلك (CORS)، وغيرها يقول بوضوح ما يحتاج.
 */
const BRIDGE_KEY = 'vantara.bridge.v1';
const OVERRIDE_KEY = 'vantara.fetch.url';
export const MIN_BRIDGE_KEY = 24;

const httpsUrl = (u) => { try { const x = new URL(String(u).trim()); return x.protocol === 'https:' ? x.origin + x.pathname.replace(/\/+$/, '') : null; } catch { return null; } };

/** إعداد الجسر المحفوظ `{ url, key }` أو null إن لم يُضبط أو كان غير صالح. */
export function bridgeConfig(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage?.getItem(BRIDGE_KEY) ?? 'null');
    const url = httpsUrl(raw?.url);
    const key = typeof raw?.key === 'string' ? raw.key.trim() : '';
    return url && key.length >= MIN_BRIDGE_KEY ? { url, key } : null;
  } catch {
    return null;
  }
}

/** يحفظ الجسر بعد التحقق من شكله. يرمي برسالة عربية إن لم يصلح. */
export function setBridge({ url, key }, storage = globalThis.localStorage) {
  const clean = httpsUrl(url);
  if (!clean) throw new Error('رابط الجسر يجب أن يبدأ بـhttps://');
  const k = String(key ?? '').trim();
  if (k.length < MIN_BRIDGE_KEY) throw new Error(`مفتاح الجسر قصير: ${MIN_BRIDGE_KEY} حرفًا على الأقل`);
  storage?.setItem(BRIDGE_KEY, JSON.stringify({ url: clean, key: k }));
  return { url: clean, key: k };
}

export function clearBridge(storage = globalThis.localStorage) {
  try { storage?.removeItem(BRIDGE_KEY); } catch { /* */ }
}

/** طريق المحتوى الحالي: `{ mode: 'bridge', base, key }` | `{ mode: 'hosted', base }` | `{ mode: 'direct' }`. */
export function contentRoute(storage = globalThis.localStorage) {
  const bridge = bridgeConfig(storage);
  if (bridge) return { mode: 'bridge', base: bridge.url, key: bridge.key };
  try {
    const override = storage?.getItem(OVERRIDE_KEY);
    if (override && /^https?:\/\//.test(override)) return { mode: 'hosted', base: override.replace(/\/+$/, '') };
  } catch { /* تخزين محجوب */ }
  return { mode: 'direct' };
}

/** أساس الجالب، أو null في الوضع المباشر (لا جالب). */
export function fetchBase(storage = globalThis.localStorage) {
  return contentRoute(storage).base ?? null;
}

/**
 * فحص الجسر قبل حفظه: `/health` يرد `{ ok, bridge: true }`، ثم طلب مصادقة بالمفتاح (`/v1/grant`) يثبت أن المفتاح هو
 * نفسه سر الجسر. يعيد `{ ok, reason }` بالعربية.
 */
export async function testBridge({ url, key }, fetchImpl = (...a) => globalThis.fetch(...a)) {
  const base = httpsUrl(url);
  if (!base) return { ok: false, reason: 'رابط الجسر يجب أن يبدأ بـhttps://' };
  try {
    const health = await fetchImpl(`${base}/health`, { signal: AbortSignal.timeout?.(10_000) });
    const body = await health.json().catch(() => null);
    if (!health.ok || !body?.ok) return { ok: false, reason: 'الرابط لا يرد كجسر فانتارا؛ تأكد من نشر الملف كاملًا' };
    if (!body.bridge) return { ok: false, reason: 'الجسر يعمل لكن السر VANTARA_BRIDGE_KEY غير مضبوط فيه (24 حرفًا فأكثر)' };
    const auth = await fetchImpl(`${base}/v1/grant`, { method: 'POST', headers: { authorization: `Bearer ${String(key).trim()}`, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout?.(10_000) });
    if (auth.status === 401) return { ok: false, reason: 'المفتاح لا يطابق السر المضبوط في الجسر' };
    if (!auth.ok) return { ok: false, reason: `الجسر ردّ بخطأ ${auth.status}` };
    return { ok: true, reason: null };
  } catch (error) {
    return { ok: false, reason: error?.name === 'TimeoutError' ? 'الجسر لم يرد في الوقت' : 'تعذّر الوصول للجسر (الرابط أو الشبكة)' };
  }
}
