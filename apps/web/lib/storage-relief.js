/**
 * تخزين الجهاز الصغير (localStorage) ممتلئ: الكاش يُفسح لما يحفظه المستخدم قبل أن يُقال له شيء.
 *
 * بلاغ المالك (20 نوفمبر): بعد التحديث ظهرت «مساحة التخزين ممتلئة». السبب قائم من قبل (كانت الكتابة تفشل بصمت)،
 * والتحذير كشفه. الآن أي حفظ يفشل: تُمسح ذاكرات مؤقتة خالصة تُبنى من جديد وحدها (أغلفة محفوظة، صور غرف المشاهدة،
 * أرقام IMDb، أوقات المقدمة، ملخصات السينما، صور تصنيفات الأنمي)، ثم يُعاد الحفظ مرة. التحذير فقط إن فشل بعدها.
 * لا يُمس هنا شيء من بياناتك: المكتبة، والتقدم، والإعدادات، وقرارات الأغلفة، وأسماء الأعمال، والطابور.
 */

/** مفاتيح ذاكرات مؤقتة خالصة: مفتاح كامل، أو بادئة تنتهي بنقطة. */
export const DISPOSABLE = Object.freeze([
  'vantara.tgart.', 'vantara.covers.v1', 'vantara.covers.work.v1', 'vantara.anime.imdb.v2.', 'vantara.skip.',
  'vantara.cinema.overviews.v1', 'vantara.anime.genre-art.v1',
]);

const disposable = (key) => DISPOSABLE.some((d) => (d.endsWith('.') ? key.startsWith(d) : key === d));

/** المفاتيح وأحجامها التقريبية (بايت، UTF-16) من الأكبر. */
export function storageReport(storage = globalThis.localStorage) {
  const out = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key == null) continue;
      out.push({ key, bytes: (key.length + (storage.getItem(key)?.length ?? 0)) * 2 });
    }
  } catch { /* تخزين غير متاح */ }
  return out.sort((a, b) => b.bytes - a.bytes);
}

/** يمسح الذاكرات المؤقتة الخالصة. يعيد البايتات المحررة. */
export function relieveStorage(storage = globalThis.localStorage) {
  let freed = 0;
  for (const { key, bytes } of storageReport(storage)) {
    if (!disposable(key)) continue;
    try { storage.removeItem(key); freed += bytes; } catch { /* */ }
  }
  return freed;
}

/**
 * حفظ مع إفساح: يحاول، ثم يمسح الذاكرات المؤقتة ويحاول مرة. `false` = التخزين ممتلئ بما ليس كاشًا، فيُعلن
 * (`vantara:storage-full`) ليقوله التطبيق مرة.
 */
export function saveWithRelief(storage, key, value) {
  if (!storage) return false;
  try { storage.setItem(key, value); return true; } catch { /* ممتلئ غالبًا */ }
  if (relieveStorage(storage) > 0) {
    try { storage.setItem(key, value); return true; } catch { /* ما زال ممتلئًا */ }
  }
  try { globalThis.dispatchEvent?.(new CustomEvent('vantara:storage-full', { detail: { key } })); } catch { /* بيئة بلا أحداث */ }
  return false;
}
