/**
 * نبض المصدر: هل يعمل هذا المصدر المدمج الآن؟ دليل فعلي لا افتراض.
 *
 * كان كل مصدر مدمج يُعرض «مصدر مدمج» فقط، سواء كان شغّالًا أو ميتًا منذ أيام.
 * الآن كل طلب حقيقي (آخر التحديثات، البحث، فحص يدوي أو تلقائي) يُسجَّل:
 *   ok     ← أعاد أعمالًا
 *   empty  ← استجاب بقائمة فارغة (قد يكون بحثًا بلا نتائج؛ ليس عطلًا)
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
  const get = (key) => all[key] ?? null;

  function record(key, state, { ms = null, items = null, error = null } = {}) {
    const old = all[key] ?? {};
    const failures = state === 'failed' ? (old.failures ?? 0) + 1 : 0;
    all = {
      ...all,
      [key]: {
        state,
        at: now(),
        ms: Number.isFinite(ms) ? Math.round(ms) : null,
        items: Number.isFinite(items) ? items : null,
        error: state === 'failed' ? String(error ?? 'تعذّر الطلب').slice(0, 160) : null,
        failures,
        lastOkAt: state === 'failed' ? old.lastOkAt ?? null : now(),
      },
    };
    save();
    return all[key];
  }

  /** يغلّف دالة مصدر: يقيس زمنها ويسجّل نتيجتها، ويُرجع النتيجة أو يرمي الخطأ كما هو. */
  async function measure(key, run) {
    const started = now();
    try {
      const out = await run();
      const list = out?.mangas ?? out?.items ?? (Array.isArray(out) ? out : null);
      record(key, list && list.length === 0 ? 'empty' : 'ok', { ms: now() - started, items: list?.length ?? null });
      return out;
    } catch (error) {
      // إلغاء المستخدم (خرج من الصفحة) ليس عطلًا في المصدر
      if (error?.name !== 'AbortError') record(key, 'failed', { ms: now() - started, error: error?.message });
      throw error;
    }
  }

  /** هل يستحق المصدر فحصًا الآن؟ */
  function due(key) {
    const p = all[key];
    if (!p) return true;
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
 * ما يراه المستخدم: {level, label, detail}. level ∈ ok | empty | failed | checking | unknown.
 * المصدر الذي فشل الآن لكنه نجح قبل قليل «متعثّر» لا «معطّل».
 */
export function pulseView(p, { checking = false, now = Date.now() } = {}) {
  if (checking) return { level: 'checking', label: 'يُفحص الآن…', detail: null };
  if (!p) return { level: 'unknown', label: 'لم يُفحص بعد', detail: null };
  const when = agoShort(p.at, now);
  if (p.state === 'ok') return { level: 'ok', label: 'يعمل', detail: [p.ms != null ? `${(p.ms / 1000).toFixed(1)} ث` : null, when].filter(Boolean).join(' · ') };
  if (p.state === 'empty') return { level: 'empty', label: 'يستجيب بلا نتائج', detail: when };
  const recent = p.lastOkAt && now - p.lastOkAt < 6 * 60 * MIN;
  return { level: 'failed', label: recent ? 'متعثّر' : 'لا يستجيب', detail: [when, p.failures > 1 ? `${p.failures} محاولات` : null].filter(Boolean).join(' · ') };
}
