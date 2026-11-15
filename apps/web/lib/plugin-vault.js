/**
 * Plugin Vault للويب والويندوز (docs/addons/PERSISTENT_PLUGINS.md §3.1، قرار 1).
 *
 * المتصفح لا يشغّل كود إضافات منزّل: ما «يُثبَّت» على الويب بيانات — تعريفات مصادر المانجا
 * (defs.json ومواقع المستخدم) وmanifests الإضافات. هذا المخزن يحفظ كل نسخة منها بعنوان محتواها
 * (sha256 لنص JSON قانوني)، في قاعدة IndexedDB خاصة به لا يكنسها كنس الكاش، فالتشغيل يقرأ من هنا
 * ولا يحتاج المستودع ولا رابطه.
 *
 * قواعد:
 *  - الكتابة مرة واحدة: العنوان بصمة المحتوى، فلا تُستبدل نسخة بأخرى تحت العنوان نفسه.
 *  - القراءة تتحقق: نص لا يطابق بصمته (تلف القرص أو عبث) يُعامل كغائب، والمستدعي يرجع لـLKG.
 *  - حدود صلبة للحجم والعمق وعدد العقد قبل أي حساب أو كتابة، ولا مفاتيح خطرة (`__proto__`).
 *  - محلي وخاص بالمستخدم: لا شيء هنا يُزامَن ولا يُرسل لأي خادم.
 */

export const VAULT_LIMITS = Object.freeze({ bytes: 256 * 1024, depth: 32, nodes: 20_000 });
const SHA = /^[0-9a-f]{64}$/;
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

/** خطأ مخزن بكود ثابت (`VAULT_LIMIT`، `VAULT_UNSAFE`، `VAULT_WRITE`، `VAULT_CRYPTO`). */
export function vaultError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * نص JSON قانوني: المفاتيح مرتبة، بلا undefined ولا دوال، ومرفوض ما يتجاوز الحدود.
 * نفس القيمة ⇒ نفس النص ⇒ نفس البصمة، مهما كان ترتيب الحقول عند الناشر.
 */
export function canonicalJson(value, limits = VAULT_LIMITS) {
  let nodes = 0;
  const walk = (v, depth) => {
    if (++nodes > limits.nodes) throw vaultError('VAULT_LIMIT', 'بيانات الإضافة أكبر من الحد المسموح');
    if (depth > limits.depth) throw vaultError('VAULT_LIMIT', 'بيانات الإضافة متشعبة أكثر من الحد المسموح');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw vaultError('VAULT_UNSAFE', 'رقم غير صالح في بيانات الإضافة');
      return JSON.stringify(v);
    }
    if (Array.isArray(v)) return `[${v.map((x) => walk(x === undefined ? null : x, depth + 1)).join(',')}]`;
    if (typeof v === 'object') {
      const keys = Object.keys(v).filter((k) => v[k] !== undefined && typeof v[k] !== 'function').sort();
      for (const k of keys) if (UNSAFE.has(k)) throw vaultError('VAULT_UNSAFE', 'بيانات JSON غير آمنة');
      return `{${keys.map((k) => `${JSON.stringify(k)}:${walk(v[k], depth + 1)}`).join(',')}}`;
    }
    throw vaultError('VAULT_UNSAFE', 'نوع غير مدعوم في بيانات الإضافة');
  };
  const text = walk(value, 0);
  if (new TextEncoder().encode(text).length > limits.bytes) throw vaultError('VAULT_LIMIT', 'بيانات الإضافة أكبر من الحد المسموح');
  return text;
}

/** sha256 لنص UTF-8 بحروف ست عشرية صغيرة. */
export async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw vaultError('VAULT_CRYPTO', 'المتصفح لا يوفر التحقق من البصمة (يلزم اتصال آمن HTTPS)');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** بصمة قيمة JSON (بعد تقنينها). */
export async function fingerprint(value, limits) {
  return sha256Hex(canonicalJson(value, limits));
}

const blobKey = (sha) => `blob:${sha}`;

/**
 * @param {{ store: { get: Function, set: Function, delete?: Function }, ns?: string, limits?: typeof VAULT_LIMITS }} deps
 *   `store` بواجهة lib/idb-store.js (أو مخزن ويندوز المحلي). `ns` مساحة بلا انتهاء صلاحية.
 */
export function createPluginVault({ store, ns = 'vault', limits = VAULT_LIMITS } = {}) {
  if (!store) throw new Error('مخزن الإضافات المحلي غير متاح');
  /** sha → قيمة متحقق منها في هذه الجلسة (الكتابة مرة واحدة تجعل الكاش آمنًا) */
  const verified = new Map();

  /** يحفظ قيمة ويرجع بصمتها. لا يكتب إن كانت موجودة سليمة. */
  async function put(value) {
    const text = canonicalJson(value, limits);
    const sha = await sha256Hex(text);
    if (verified.has(sha)) return sha;
    const existing = await store.get(ns, blobKey(sha)).catch(() => null);
    if (typeof existing?.value === 'string' && existing.value === text) {
      verified.set(sha, JSON.parse(text));
      return sha;
    }
    if ((await store.set(ns, blobKey(sha), text)) === false) throw vaultError('VAULT_WRITE', 'تعذر حفظ نسخة الإضافة على الجهاز (المساحة ممتلئة أو التخزين مرفوض)');
    verified.set(sha, JSON.parse(text));
    return sha;
  }

  /** القيمة المحفوظة بهذه البصمة بعد التحقق منها، أو null (غائبة أو تالفة). نسخة جديدة كل مرة. */
  async function get(sha) {
    if (typeof sha !== 'string' || !SHA.test(sha)) return null;
    if (verified.has(sha)) return structuredClone(verified.get(sha));
    const hit = await store.get(ns, blobKey(sha)).catch(() => null);
    const text = hit?.value;
    if (typeof text !== 'string' || text.length > limits.bytes * 4) return null;
    let ok = false;
    try {
      ok = (await sha256Hex(text)) === sha;
    } catch {
      return null;
    }
    if (!ok) return null;
    let value;
    try {
      value = JSON.parse(text, (key, v) => {
        if (UNSAFE.has(key)) throw new Error('unsafe');
        return v;
      });
    } catch {
      return null;
    }
    verified.set(sha, value);
    return structuredClone(value);
  }

  /** يحذف كل نسخة لا تشير إليها بصمة حية. `live`: بصمات ما زالت مستعملة (فعّالة أو LKG). */
  async function sweep(live, all = []) {
    const keep = new Set(live);
    let removed = 0;
    for (const sha of all) {
      if (keep.has(sha) || !SHA.test(String(sha))) continue;
      await store.delete?.(ns, blobKey(sha));
      verified.delete(sha);
      removed += 1;
    }
    return removed;
  }

  return { put, get, sweep, ns };
}

/** مقارنة إصدارين: أعداد صحيحة أو semver (x.y.z). يرجع سالبًا/صفرًا/موجبًا، أو null إن لم تُقارن. */
export function compareVersions(a, b) {
  if (Number.isInteger(a) && Number.isInteger(b)) return a - b;
  const parse = (v) => {
    const m = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]+))?/.exec(String(v ?? ''));
    return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null } : null;
  };
  const x = parse(a), y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i += 1) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  // 1.0.0-beta أقدم من 1.0.0 (semver)
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}
