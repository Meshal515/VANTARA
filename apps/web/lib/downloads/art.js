/**
 * فن الأعمال المحفوظة: الغلاف والبنر والشعار على الجهاز، مرة لكل عمل لا مع كل حلقة.
 *
 * «على الجهاز» تفتح بلا إنترنت كاملة بأغلفتها: لا اعتماد على AniList أو أي خادم عند العرض.
 * الصور تُصغَّر قبل الحفظ (غلاف 360px، بنر 1080px) فلا يأكل الفن مساحة الحلقات.
 */

const SIZES = { cover: 360, banner: 1080, logo: 600 };
const urls = new Map();
const pending = new WeakMap();
const retryTimers = new WeakMap();
const RETRY_MS = [15_000, 120_000, 1_800_000];

/** مؤقت مستقل لكل صورة: يحترم زمن التراجع المحفوظ ولا يكرر عملًا أو يغيّر ملف الفيديو. */
function scheduleArtRetry(store, work, kind, src, options, retryAt) {
  let tasks = retryTimers.get(store);
  if (!tasks) retryTimers.set(store, tasks = new Map());
  const key = `${work.ref}|${kind}`;
  const current = tasks.get(key);
  if (current) current.timers.clearTimeout?.(current.id);
  tasks.delete(key);
  if (!Number.isFinite(retryAt)) return;
  const timers = options.timers ?? globalThis;
  const request = Object.hasOwn(SIZES, kind) ? { ref: work.ref, [kind]: src } : { ref: work.ref };
  const extras = Object.hasOwn(SIZES, kind) ? {} : { [kind]: src };
  const task = { timers, id: null };
  task.id = timers.setTimeout?.(async () => {
    if (tasks.get(key) !== task) return;
    tasks.delete(key);
    if (globalThis.navigator?.onLine === false) return scheduleArtRetry(store, work, kind, src, options, Date.now() + 60_000);
    await saveWorkArt(store, request, { ...options, extras });
  }, Math.max(0, retryAt - Date.now()));
  task.id?.unref?.(); // اختبارات Node لا تبقى معلقة بسبب مؤقت الفن
  if (task.id != null) tasks.set(key, task);
}

function clearArtRetry(store, key) {
  const tasks = retryTimers.get(store);
  const task = tasks?.get(key);
  if (task) task.timers.clearTimeout?.(task.id);
  tasks?.delete(key);
}

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
  const res = await fetchImpl(src, { signal: globalThis.AbortSignal?.timeout?.(12_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return blob?.size && /^image\//.test(blob.type) ? blob : null;
}

/**
 * يحفظ ما لم يُحفظ بعد من فن العمل. الفشل لا يوقف التنزيل: البطاقة تعرض لون العمل بدل الغلاف.
 * `local(src)`: نسخة محلية بمحرّك المصدر (غلاف المانجا: الموقع يحتاج Referer/كوكي ولا يرسل CORS، فطلب
 * الواجهة المباشر يفشل دائمًا — لذلك غابت أغلفة المانجا وحدها عن «على الجهاز»). يرجع عدد الصور المحفوظة.
 */
export async function saveWorkArt(store, work, { fetchImpl = globalThis.fetch, local = null, extras = {}, timers = globalThis } = {}) {
  if (!store?.putArt || !work?.ref) return 0;
  let inflight = pending.get(store);
  if (!inflight) pending.set(store, inflight = new Map());
  const previous = inflight.get(work.ref);
  const saving = (async () => {
    // دفعة لاحقة لنفس العمل قد تحمل صور حلقات أخرى أو غلافًا وصل حديثًا.
    if (previous) await previous;
    let saved = 0;
    for (const [kind, src] of [...Object.keys(SIZES).map((kind) => [kind, work[kind]]), ...Object.entries(extras)]) {
      if (!src || typeof src !== 'string') continue;
      const key = `${work.ref}|${kind}`;
      try {
        const existing = await store.getArt(key);
        if (existing?.data) { clearArtRetry(store, key); continue; }
        if (existing?.src === src && existing.retryAt > Date.now()) {
          scheduleArtRetry(store, work, kind, src, { fetchImpl, local, timers }, existing.retryAt);
          continue;
        }
        try {
          let fetchError;
          let blob = await imageBlob(src, fetchImpl).catch((error) => { fetchError = error; return null; });
          if (!blob && local) {
            const copy = await local(src, kind);
            if (copy) blob = await imageBlob(copy, fetchImpl);
          }
          if (!blob) throw fetchError ?? new Error('لم يصل ملف صورة صالح');
          blob = await shrink(blob, SIZES[kind] ?? 480);
          if (!blob?.size || !/^image\//.test(blob.type)) throw new Error('ملف الصورة غير صالح');
          await store.putArt(key, { type: blob.type, data: await blob.arrayBuffer(), at: Date.now() });
          clearArtRetry(store, key);
          saved++;
        } catch (error) {
          const attempts = (existing?.src === src ? existing.attempts ?? 0 : 0) + 1;
          const retryAt = Date.now() + RETRY_MS[Math.min(attempts - 1, RETRY_MS.length - 1)];
          await store.putArt(key, { src, attempts, retryAt, error: error?.message ?? 'تعذّر حفظ الصورة' });
          scheduleArtRetry(store, work, kind, src, { fetchImpl, local, timers }, retryAt);
        }
      } catch { /* عطل في مخزن الصور: ملف الوسائط مستقل عنه */ }
    }
    return saved;
  })();
  inflight.set(work.ref, saving);
  try {
    return await saving;
  } finally {
    if (inflight.get(work.ref) === saving) inflight.delete(work.ref);
  }
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
  await pending.get(store)?.get(ref);
  for (const key of [...(retryTimers.get(store)?.keys() ?? [])]) if (key.startsWith(`${ref}|`)) clearArtRetry(store, key);
  for (const [key, url] of urls) {
    if (!key.startsWith(`${ref}|`)) continue;
    URL.revokeObjectURL(url);
    urls.delete(key);
  }
  await store?.deleteArt?.(`${ref}|`).catch?.(() => {});
}
