/**
 * ذاكرة بدء التشغيل على هذا الجهاز: كم استغرق التورنت حتى أول إطار، حسب صفاته (الترميز،
 * الجودة، فرقة الإصدار، الإضافة). الجهاز نفسه يقرر: هاتف بلا فكّ AV1 بالعتاد يبدأ AV1 ببطء
 * مهما كثر المشاركون، فتتأخر هذه الصفة في الترشيح عنده وحده. القيم محلية ولا تُرسل.
 */
const KEY = 'vantara.startMemory.v1';
const MAX_KEYS = 120;
/** انتظار فاشل (خطأ أو انقطاع) يُحسب كبدء بطيء جدًا. */
export const FAIL_MS = 30000;

const read = () => {
  try { return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; }
};
const write = (v) => {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(v)); } catch { /* تخزين محجوب: الترشيح بلا ذاكرة */ }
};

/** صفات صف تورنت تُتذكّر: ما يتكرر بين الحلقات، لا الملف نفسه. */
export function startFeatures(d) {
  if (!d?.torrent) return [];
  const group = d.group ?? null;
  return [
    d.info?.codec ? `codec:${d.info.codec}` : null,
    d.q ? `q:${d.q}` : null,
    group ? `group:${group.toLowerCase()}` : null,
    d.name ? `src:${String(d.name).toLowerCase()}` : null,
  ].filter(Boolean);
}

/** يسجّل بدءًا حقيقيًا (أو فشلًا) لصفات صف. متوسط متحرك يميل لآخر التجارب. */
export function rememberStart(features, ms, ok) {
  if (!features?.length) return;
  const value = ok ? Math.max(0, Math.min(Number(ms) || 0, FAIL_MS)) : FAIL_MS;
  const all = read();
  for (const f of features) {
    const prev = all[f];
    all[f] = prev ? { avg: Math.round(prev.avg * 0.6 + value * 0.4), n: Math.min(prev.n + 1, 50), at: Date.now() } : { avg: Math.round(value), n: 1, at: Date.now() };
  }
  const keys = Object.keys(all);
  if (keys.length > MAX_KEYS) for (const k of keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - MAX_KEYS)) delete all[k];
  write(all);
}

/** أبطأ بدء معروف لصفات الصف (ms)، أو null إن لم يُجرَّب شيء منها هنا بعد. */
export function knownStart(features) {
  const all = read();
  const seen = (features ?? []).map((f) => all[f]).filter(Boolean);
  return seen.length ? Math.max(...seen.map((s) => s.avg)) : null;
}
