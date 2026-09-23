/**
 * الأغلفة: من أين تُجلب، وأين تُحفظ.
 *
 * كان الغلاف رابطًا واحدًا يطلبه `<img>` مباشرة. مصادر تطلب `Referer` أو كوكي
 * Cloudflare (AriaToon مثلًا) تردّ 403، فيظهر الحرف الأول مكان الغلاف، ولا
 * يظهر الغلاف إلا بعد فتح العمل. وما نزل لا يبقى: بلا شبكة يختفي كل شيء.
 *
 * الآن:
 *   - المرشّحون كل أغلفة العمل من كل نسخه، لا غلاف أول مصدر وحده.
 *   - في التطبيق يُجلب الغلاف بمحرّك مصدره (ترويساته وكوكيه) ويُحفظ على
 *     الجهاز (`ExtensionEngine.cover`)، والفهرس هنا يحفظ أين: فتحة التطبيق
 *     التالية تعرض الغلاف من الملف فورًا ولو بلا شبكة.
 *   - ستة أغلفة معًا على الأكثر: شبكة من ستين بطاقة لا تخنق المصدر.
 */

import engine from '../lib/extension-engine.js';

const INDEX_KEY = 'vantara.covers.v1';
const MAX_INDEX = 3000;
const MAX_PARALLEL = 6;

let index = (() => {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
})();
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const keys = Object.keys(index);
    if (keys.length > MAX_INDEX) for (const k of keys.slice(0, keys.length - MAX_INDEX)) delete index[k];
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify(index));
    } catch {
      // الفهرس تسريع لا حقيقة: ضياعه يعني جلبًا من الملف المحفوظ مرة ثانية
    }
  }, 500);
}

/** كل أغلفة العمل، ومصدر كل واحد: الغلاف المعروض أولًا، ثم غلاف كل نسخة. */
export function coverCandidates(work) {
  const editions = work?._work?.editions ?? [];
  const sourceOf = (url) => editions.find((e) => e.manga?.thumbnailUrl === url)?.sourceId ?? editions[0]?.sourceId ?? null;
  const urls = [work?.coverImage?.extraLarge, work?.coverImage?.large, work?.bannerImage, ...editions.map((e) => e.manga?.thumbnailUrl)];
  const seen = new Set();
  const out = [];
  for (const url of urls) {
    if (typeof url !== 'string' || !url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, sourceId: sourceOf(url) });
  }
  return out;
}

export const cachedCover = (url) => index[url] ?? null;
export function forgetCover(url) {
  if (!(url in index)) return;
  delete index[url];
  save();
}

let active = 0;
const waiting = [];
function limited(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      active += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          waiting.shift()?.();
        });
    };
    if (active < MAX_PARALLEL) run();
    else waiting.push(run);
  });
}

const inflight = new Map();
/** الغلاف بمحرّك مصدره، محفوظًا. `null` إن تعذّر. مرة واحدة لكل رابط في الجلسة. */
export function nativeCover(url, sourceId) {
  if (!engine.isAvailable()) return Promise.resolve(null);
  if (inflight.has(url)) return inflight.get(url);
  const promise = limited(() => engine.cover(sourceId, url))
    .then((src) => {
      index[url] = src;
      save();
      return src;
    })
    .catch(() => {
      // فشلٌ اليوم قد ينجح غدًا: لا يُحفظ
      inflight.delete(url);
      return null;
    });
  inflight.set(url, promise);
  return promise;
}
