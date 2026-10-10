/**
 * أدلة هوية تأتي مع النسخة نفسها، لا من صفحة العمل:
 *
 * 1. أسماء MangaDex البديلة. واجهته العامة تعيدها مع كل عمل (`altTitles`)، وإضافة
 *    الـAPK لا تمرّرها في القوائم؛ فتُسأل الواجهة مرة لكل صفحة قائمة (`ids[]`، طلب
 *    واحد لعشرين عملًا) وتُحفظ على الجهاز. بها يلتحق «Hoegwihan Yongbyeong-eun Da
 *    Gyehoek-i Itda» بـ«The Regressed Mercenary’s Machinations» (`canonicalIndex`).
 *
 * 2. نسخٌ بلا فصول. MangaDex يعدّ العمل «مترجمًا للعربية» ولو حُجبت فصوله كلها
 *    (`isUnavailable`)، فيظهر في القوائم بلا فصل واحد. نسخةٌ ردّت بلا فصول تُذكر
 *    يومين؛ وعمل كل نسخه كذلك لا يُعرض في القوائم بطاقةً «لا فصول متاحة».
 */

const DEX_KEY = 'vantara.mangadex.names.v1';
const EMPTY_KEY = 'vantara.manga.emptyEditions.v1';
const EMPTY_TTL_MS = 2 * 24 * 3600e3;
const MAX_KEPT = 3000;

const read = (key) => {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null') ?? {};
  } catch {
    return {};
  }
};
const write = (key, value) => {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // تخزين ممتلئ: الذاكرة للجلسة تكفي
  }
};
const trim = (obj) => {
  const keys = Object.keys(obj);
  if (keys.length > MAX_KEPT) for (const k of keys.slice(0, keys.length - MAX_KEPT)) delete obj[k];
  return obj;
};

// ───────── MangaDex ─────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOf = (url) => String(url ?? '').split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? '';
export const isMangaDex = (sourceId) => /(?:^|\.)mangadex$/i.test(String(sourceId ?? '').split('@')[0]);

/** كل أسماء عمل MangaDex: عنوانه بكل لغاته وأسماؤه البديلة. */
export function mangaDexNames(m) {
  const a = m?.attributes ?? {};
  const out = [...Object.values(a.title ?? {}), ...(a.altTitles ?? []).flatMap((t) => Object.values(t ?? {}))];
  return [...new Set(out.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim()))];
}

let dexNames = null;
const dexCache = () => (dexNames ??= read(DEX_KEY));

/**
 * صفحة قائمة من MangaDex بأسمائها البديلة. ما حمل أسماءه (محرك الـPWA) يبقى كما هو،
 * وما لا يُعرف يُسأل عنه دفعة واحدة. فشل الطلب لا يُسقط القائمة: تعود كما وصلت.
 */
export async function withMangaDexNames(sourceId, value, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const mangas = value?.mangas;
  if (!isMangaDex(sourceId) || !Array.isArray(mangas) || !mangas.length) return value;
  const cache = dexCache();
  const need = [...new Set(mangas.filter((m) => !m?.altNames?.length).map((m) => uuidOf(m?.url)).filter((id) => UUID.test(id) && !cache[id]))];
  if (need.length && typeof fetchImpl === 'function') {
    const url = new URL('https://api.mangadex.org/manga');
    url.searchParams.set('limit', '100');
    for (const id of need.slice(0, 100)) url.searchParams.append('ids[]', id);
    for (const r of ['safe', 'suggestive', 'erotica', 'pornographic']) url.searchParams.append('contentRating[]', r);
    try {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = setTimeout(() => controller?.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url.toString(), { signal: controller?.signal, headers: { Accept: 'application/json' } });
        if (res?.ok) {
          const data = await res.json();
          for (const m of data?.data ?? []) if (UUID.test(m?.id ?? '')) cache[m.id] = mangaDexNames(m);
          write(DEX_KEY, trim(cache));
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // أدلة إضافية لا شرط: القائمة تُعرض كما هي
    }
  }
  return {
    ...value,
    mangas: mangas.map((m) => (m?.altNames?.length || !cache[uuidOf(m?.url)] ? m : { ...m, altNames: cache[uuidOf(m.url)] })),
  };
}

// ───────── نسخ بلا فصول ─────────

let empty = null;
const emptyCache = () => (empty ??= read(EMPTY_KEY));
const editionId = (family, url) => `${family}|${String(url ?? '')}`;

/** ما ردّت به نسخة: صفر يُذكر، وأي فصل يمحو الذكر. `family`: عائلة المرايا. */
export function noteEditionChapters(family, url, count) {
  if (!url) return;
  const cache = emptyCache();
  const id = editionId(family, url);
  if (count > 0) {
    if (!(id in cache)) return;
    delete cache[id];
  } else cache[id] = Date.now();
  write(EMPTY_KEY, trim(cache));
}

/** هل كل نسخ العمل ردّت حديثًا بلا فصول؟ `familyOf`: sourceId ← عائلته. */
export function knownEmpty(work, familyOf = (s) => s, now = Date.now()) {
  const editions = work?.editions ?? [];
  if (!editions.length) return false;
  const cache = emptyCache();
  return editions.every((e) => {
    const at = cache[editionId(familyOf(e.sourceId), e.manga?.url)];
    return Number.isFinite(at) && now - at < EMPTY_TTL_MS;
  });
}

/** للاختبار فقط. */
export function _reset() {
  dexNames = null;
  empty = null;
}
