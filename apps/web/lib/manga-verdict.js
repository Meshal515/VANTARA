import { normalizeTitle } from './catalog.js';
/**
 * أحكام المحتوى الرسمية للعناوين (lib/manga-meta.js `mangaContentVerdict`)، محفوظة على الجهاز: عمل إنجليزي من مصدر
 * آمن لا يظهر في البحث حتى يُعرف أنه نظيف (قرار المالك، 22 نوفمبر). `unknown` يُعاد سؤاله بعد مدة، والباقي ثابت.
 */
const KEY = 'vantara.manga.verdict.v1';
const MAX = 8000;
export const UNKNOWN_RETRY_MS = 3 * 86_400_000;
let cache = null;
const load = () => {
  if (cache) return cache;
  try {
    cache = new Map(Object.entries(JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') ?? {}));
  } catch {
    cache = new Map();
  }
  return cache;
};
const save = () => {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(Object.fromEntries([...load()].slice(-MAX))));
  } catch {
    // تخزين ممتلئ: الأحكام للجلسة تكفي
  }
};
const VALID = new Set(['clean', 'ecchi', 'adult', 'unknown']);
/** حكم عنوان واحد أو null إن لم يُسأل عنه. */
export function verdictOf(title) {
  return load().get(normalizeTitle(title))?.v ?? null;
}
/** يحفظ أحكام `[[عنوان، حكم]]`. حكم ثابت (نظيف/للكبار) لا يمحوه `unknown` لاحق. */
export function noteVerdicts(entries, now = Date.now()) {
  const map = load();
  let changed = false;
  for (const [title, v] of entries) {
    const k = normalizeTitle(title);
    if (!k || !VALID.has(v)) continue;
    const prev = map.get(k)?.v;
    if (v === 'unknown' && prev && prev !== 'unknown') continue;
    map.delete(k);
    map.set(k, { v, at: now });
    changed = true;
  }
  if (changed) save();
}
/** يحتاج سؤالًا: لم يُسأل، أو مجهول قديم. */
export function needsVerdict(title, now = Date.now()) {
  const hit = load().get(normalizeTitle(title));
  return !hit || (hit.v === 'unknown' && now - (hit.at ?? 0) > UNKNOWN_RETRY_MS);
}
/**
 * حكم عمل من عناوين نسخه: أي عنوان للكبار يحجبه، وأي عنوان نظيف (أو إيتشي) يكفي لإظهاره، وإلا مجهول.
 * @returns {'adult'|'ecchi'|'clean'|null}
 */
export function workVerdict(titles) {
  const all = titles.map(verdictOf);
  if (all.includes('adult')) return 'adult';
  if (all.includes('ecchi')) return 'ecchi';
  if (all.includes('clean')) return 'clean';
  return null;
}
export function _resetVerdicts() { cache = new Map(); }
