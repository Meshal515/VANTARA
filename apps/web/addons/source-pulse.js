/**
 * نبض المصدر: هل يعمل هذا المصدر المدمج الآن؟ دليل فعلي لا افتراض.
 *
 * كان كل مصدر مدمج يُعرض «مصدر مدمج» فقط، سواء كان شغّالًا أو ميتًا منذ أيام.
 * الآن كل طلب حقيقي (آخر التحديثات، البحث، فحص يدوي أو تلقائي) يُسجَّل:
 *   ok     ← أعاد أعمالًا
 *   empty  ← استجاب بقائمة فارغة (قد يكون بحثًا بلا نتائج؛ ليس عطلًا)
 *   verification ← طلب تحقق بشري مؤكد من المحرك
 *   failed ← خطأ أو انتهاء مهلة
 * ويُحفظ على الجهاز نفسه (مفتاح لكل مصدر)، فيظهر في صفحة الإضافات: «يعمل · قبل 3 د».
 *
 * الإصلاح الذاتي: `due()` تقول أي مصدر يستحق فحصًا الآن — لم يُفحص قط، أو مضى على
 * نجاحه 30 دقيقة، أو فشل ومضت مهلة تتضاعف مع تكرار الفشل (1، 2، 4… حتى 60 دقيقة)،
 * فالمصدر العائد يعود أخضر وحده، والميت لا يُطرق بلا توقف.
 */

const KEY = 'vantara.sourcePulse.v1';
const FRESH_MS = 30 * 60_000;
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 60 * 60_000;

// Only confirmed interactive evidence requests verification; HTTP 403 alone does not.
function confirmedVerification(value) {
  if (value?.needsHuman === true || value?.blocked === 'cloudflare_interactive' || (value?.code === 'challenge' && value?.challenge === 'interactive')) return true;
  const native = /(?:^|\.)CloudflareBypassException$/.test(String(value?.code ?? value?.name ?? ''));
  return native && (value?.interactive === true || (value?.interactive !== false && /^Cloudflare wants a human check for [^;]+; open the site in the WebView to pass it$/.test(value?.message ?? '')));
}
function browseItems(out) {
  const list = out?.mangas ?? out?.items ?? (Array.isArray(out) ? out : null);
  const reference = item => item?.url ?? item?.id;
  if (out?.error || Number(out?.status) >= 400 || !Array.isArray(list) || list.some(item =>
    !item || typeof item !== 'object' ||
    !((typeof reference(item) === 'string' && reference(item).trim()) || (typeof reference(item) === 'number' && Number.isFinite(reference(item)))) ||
    typeof (item.title ?? item.name) !== 'string' || !(item.title ?? item.name).trim()))
    throw Object.assign(new Error('لم يُرجع المصدر قائمة أعمال صالحة.'), { code: 'INVALID_SOURCE_RESPONSE' });
  return list;
}
const boundedCount = value => Number.isInteger(value) && value > 0 ? Math.min(value, 50) : 0;
const hasBrowseEvidence = p => Number.isInteger(p?.items) && (p.state === 'ok' ? p.items > 0 : p.state === 'empty' && p.items === 0);

function readAll(storage) {
  try {
    const value = JSON.parse(storage?.getItem(KEY) ?? '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export function createSourcePulse({ storage = globalThis.localStorage, now = () => Date.now() } = {}) {
  let all = readAll(storage);
  const listeners = new Set();
  const save = () => {
    try { storage?.setItem(KEY, JSON.stringify(all)); } catch {}
    for (const fn of listeners) try { fn(); } catch {}
  };
  const get = (key) => all[key] ? {...all[key], successfulBrowseCount: boundedCount(all[key].successfulBrowseCount)} : null;

  function record(key, state, { ms = null, items = null, error = null, version = null, cacheEpoch = null, capability = "browse" } = {}) {
    const old = all[key] ?? {};
    const sameRelease = old.version === version && old.cacheEpoch === cacheEpoch && old.capability === capability;
    const recent = Number.isFinite(old.lastOkAt) && old.lastOkAt <= now() && now() - old.lastOkAt <= FRESH_MS;
    const previousCount = sameRelease && recent && !["failed", "verification"].includes(old.state) ? boundedCount(old.successfulBrowseCount) : 0;
    const failures = state === 'failed' ? (old.failures ?? 0) + 1 : 0;
    all = {
      ...all,
      [key]: {
        state,
        version,
        cacheEpoch,
        capability,
        successfulBrowseCount: state === 'ok' && Number.isInteger(items) && items > 0
          ? Math.min(50, previousCount + 1)
          : state === 'empty' ? previousCount : 0,
        at: now(),
        ms: Number.isFinite(ms) ? Math.round(ms) : null,
        items: Number.isFinite(items) ? items : null,
        error: ['failed', 'verification'].includes(state) ? String(error ?? 'تعذّر الطلب').slice(0, 160) : null,
        failures,
        lastOkAt: ['ok', 'empty'].includes(state) ? now() : old.lastOkAt ?? null,
      },
    };
    save();
    return all[key];
  }

  /** يقيس تصفحًا أو بحثًا: النجاح يحتاج أعمالًا صالحة، والفراغ الصالح مستقل عن الفشل. */
  async function measure(key, run, { signal, timeoutMs = 20_000, version = null, cacheEpoch = null, capability = "browse" } = {}) {
    const started = now();
    let timer, abort;
    try {
      if (signal?.aborted) throw new DOMException('ألغي الطلب', 'AbortError');
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new DOMException('انتهت مهلة المصدر', 'TimeoutError')), timeoutMs);
        abort = () => reject(new DOMException('ألغي الطلب', 'AbortError'));
        signal?.addEventListener('abort', abort, { once: true });
      });
      // بعض الجسور الأصلية لا تدعم AbortSignal؛ نتيجتها المتأخرة لا تغيّر النبض.
      const out = await Promise.race([Promise.resolve().then(run), deadline]);
      if (signal?.aborted) throw new DOMException('ألغي الطلب', 'AbortError');
      if (confirmedVerification(out)) throw Object.assign(new Error('المصدر يطلب تحققًا منك.'), { code: 'VERIFICATION_REQUIRED', needsHuman: true });
      const list = browseItems(out);
      record(key, list.length === 0 ? 'empty' : 'ok', { ms: now() - started, items: list.length, version, cacheEpoch, capability });
      return out;
    } catch (error) {
      if (error?.name !== 'AbortError') record(key, confirmedVerification(error) ? 'verification' : 'failed', { ms: now() - started, error: error?.message, version, cacheEpoch, capability });
      throw error;
    } finally {
      clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
    }
  }

  /** هل يستحق المصدر فحصًا الآن؟ */
  function due(key) {
    const p = all[key];
    if (!p || (['ok', 'empty'].includes(p.state) && !hasBrowseEvidence(p))) return true;
    if (p.state !== 'failed') return now() - p.at >= FRESH_MS;
    return now() - p.at >= Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, p.failures - 1));
  }

  return {
    get,
    record,
    measure,
    due,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

const MIN = 60_000;
/** «الآن»، «قبل 3 د»، «قبل ساعتين»… مختصر لسطر الحالة. */
export function agoShort(at, now = Date.now()) {
  const d = Math.max(0, now - at);
  if (d < MIN) return 'الآن';
  if (d < 60 * MIN) return `قبل ${Math.floor(d / MIN)} د`;
  if (d < 24 * 60 * MIN) return `قبل ${Math.floor(d / (60 * MIN))} س`;
  return `قبل ${Math.floor(d / (24 * 60 * MIN))} يوم`;
}

/**
 * ما يراه المستخدم: {level, label, detail}. level ∈ ok | empty | verification | failed | checking | unknown.
 * المصدر الذي فشل الآن لكنه نجح قبل قليل «متعثّر» لا «معطّل».
 */
export function pulseView(p, { checking = false, now = Date.now() } = {}) {
  if (checking) return { level: 'checking', label: 'يُفحص الآن…', detail: null };
  if (!p || (['ok', 'empty'].includes(p.state) && !hasBrowseEvidence(p))) return { level: 'unknown', label: 'لم يُفحص بعد', detail: null };
  const when = agoShort(p.at, now);
  if (p.state === 'ok') return { level: 'ok', label: 'يعمل', detail: [p.ms != null ? `${(p.ms / 1000).toFixed(1)} ث` : null, when].filter(Boolean).join(' · ') };
  if (p.state === 'empty') return { level: 'empty', label: 'يستجيب بلا نتائج', detail: when };
  if (p.state === 'verification') return { level: 'verification', label: 'يحتاج تحققًا', detail: when };
  const recent = p.lastOkAt && now - p.lastOkAt < 6 * 60 * MIN;
  return { level: 'failed', label: recent ? 'متعثّر' : 'لا يستجيب', detail: [when, p.failures > 1 ? `${p.failures} محاولات` : null].filter(Boolean).join(' · ') };
}
