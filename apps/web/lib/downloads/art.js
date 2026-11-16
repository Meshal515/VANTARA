/**
 * فن الأعمال المحفوظة: الغلاف والبنر والشعار على الجهاز، مرة لكل عمل لا مع كل حلقة.
 *
 * «على الجهاز» تفتح بلا إنترنت كاملة بأغلفتها: لا اعتماد على AniList أو أي خادم عند العرض.
 * الصور تُصغَّر قبل الحفظ (غلاف 360px، بنر 1080px) فلا يأكل الفن مساحة الحلقات.
 */

const SIZES = { cover: 360, banner: 1080, logo: 600 };
const urls = new Map();

async function shrink(blob, maxWidth) {
  try {
    if (typeof createImageBitmap !== 'function') return blob;
    const bitmap = await createImageBitmap(blob);
    if (bitmap.width <= maxWidth) {
      bitmap.close?.();
      return blob;
    }
    const w = maxWidth;
    const h = Math.round((bitmap.height * maxWidth) / bitmap.width);
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    // الشعار شفاف: PNG؛ الباقي WebP صغير
    const type = blob.type === 'image/png' ? 'image/png' : 'image/webp';
    if (canvas.convertToBlob) return await canvas.convertToBlob({ type, quality: 0.86 });
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? blob), type, 0.86));
  } catch {
    return blob;
  }
}

async function imageBlob(src, fetchImpl) {
  const res = await fetchImpl(src);
  if (!res.ok) return null;
  const blob = await res.blob();
  return blob?.size && /^image\//.test(blob.type) ? blob : null;
}

/**
 * يحفظ ما لم يُحفظ بعد من فن العمل. الفشل لا يوقف التنزيل: البطاقة تعرض لون العمل بدل الغلاف.
 * `local(src)`: نسخة محلية بمحرّك المصدر (غلاف المانجا: الموقع يحتاج Referer/كوكي ولا يرسل CORS، فطلب
 * الواجهة المباشر يفشل دائمًا — لذلك غابت أغلفة المانجا وحدها عن «على الجهاز»). يرجع عدد الصور المحفوظة.
 */
export async function saveWorkArt(store, work, { fetchImpl = globalThis.fetch, local = null } = {}) {
  if (!store?.putArt || !work?.ref) return 0;
  let saved = 0;
  for (const kind of ['cover', 'banner', 'logo']) {
    const src = work[kind];
    if (!src || typeof src !== 'string') continue;
    const key = `${work.ref}|${kind}`;
    try {
      if (await store.getArt(key)) continue;
      let blob = await imageBlob(src, fetchImpl).catch(() => null);
      if (!blob && local) {
        const copy = await Promise.resolve(local(src, kind)).catch(() => null);
        if (copy) blob = await imageBlob(copy, fetchImpl).catch(() => null);
      }
      if (!blob) continue;
      blob = await shrink(blob, SIZES[kind]);
      if (!blob?.size || !/^image\//.test(blob.type)) continue;
      await store.putArt(key, { type: blob.type, data: await blob.arrayBuffer(), at: Date.now() });
      saved++;
    } catch {
      /* صورة واحدة فشلت لا تمنع البقية */
    }
  }
  return saved;
}

/** رابط محلي لصورة محفوظة (يُعاد استعماله)، أو null. */
export async function artUrl(store, ref, kind) {
  const key = `${ref}|${kind}`;
  if (urls.has(key)) return urls.get(key);
  const art = await store?.getArt?.(key).catch?.(() => null);
  if (!art?.data) return null;
  const url = URL.createObjectURL(new Blob([art.data], { type: art.type }));
  urls.set(key, url);
  return url;
}

/** حُذف العمل كله: صوره وروابطها. */
export async function dropWorkArt(store, ref) {
  for (const kind of Object.keys(SIZES)) {
    const key = `${ref}|${kind}`;
    const url = urls.get(key);
    if (url) URL.revokeObjectURL(url);
    urls.delete(key);
  }
  await store?.deleteArt?.(`${ref}|`).catch?.(() => {});
}
