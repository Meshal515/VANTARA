/**
 * تنزيل فصل مانجا: كل صفحاته بترتيبها، محفوظة في مخزن التنزيلات الدائم.
 *
 * - المصدر نفسه الذي يقرأ منه القارئ (`engine.pages` ثم `engine.pageImage`): نفس الترويسات
 *   والفك، فما يُقرأ يُنزَّل. لا مصدر ثانٍ يُخلط داخل الفصل الواحد.
 * - الاستئناف: الصفحة المحفوظة لا تُنزَّل ثانية؛ الإيقاف يبقي ما حُفظ. لكن قائمة صفحات تغيّرت عند المصدر
 *   (عدد آخر أو ملفات أخرى) تُسقط ما حُفظ: صفحة 7 من قائمة قديمة ليست صفحة 7 من الجديدة.
 * - التوازي داخل الفصل ثلاث صفحات، ويهبط إلى واحدة حين يحدّ الموقع الطلبات (429، صفحة حجب بدل الصورة).
 * - الصفحة الواحدة تُعاد بهدوء قبل أن يُحكم على الفصل: انقطاع لحظي لا يُسقط فصلًا من ستين صفحة.
 * - سبب الفشل من رمز المحرك الأصلي (SITE_HTTP_404، SITE_HTTP_429، SITE_NETWORK…) لا «المصدر رفض الطلب» لكل شيء.
 * - الذكي: فصل بلا صفحات أو مصدر رفضه يُجرَّب من نسخة أخرى للعمل عندها الفصل نفسه (`request.alternates`).
 *   اليدوي لا يُستبدل مصدره.
 * - السلامة: كل صفحة توقيعها صورة، وبنيتها مكتملة (نهاية JPEG/PNG/GIF/WebP في مكانها: ملف مبتور
 *   لا يمر)، وتُفك فعلًا حيث يوجد فاكّ (WebView)، قبل أن تُحفظ.
 * - الفصل لا يُعلن جاهزًا إلا وكل صفحة محفوظة وغير فارغة وطولها كما كُتب، وعدد الصفحات يطابق قائمة
 *   المصدر. صفحة ناقصة = فصل لم يكتمل (لا قارئ بفجوات).
 */

import { DownloadError } from './model.js';

const PAGE_CONCURRENCY = 3;
const PAGE_ATTEMPTS = 3;
const IMAGE_TYPES = /^image\/(?:jpeg|png|webp|gif|avif|bmp)$/i;

/** نوع الصورة من أول بايتاتها: المضيفات ترسل أحيانًا application/octet-stream. */
export function sniffImageType(bytes) {
  const b = new Uint8Array(bytes.slice ? bytes.slice(0, 12) : bytes);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'image/avif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  return null;
}

/**
 * هل الملف مكتمل البنية؟ يمسك الصورة المبتورة (اتصال انقطع وسط الجسم، أو كاش نصف مكتوب) التي يقبلها
 * فحص التوقيع وحده ثم تظهر في القارئ نصفها رمادي أو لا تظهر. `null` = سليم، وإلا السبب.
 */
export function imageIntegrity(bytes, type) {
  const b = new Uint8Array(bytes);
  const n = b.length;
  if (n < 64) return 'too-small';
  const tail = (k) => b.subarray(Math.max(0, n - k));
  switch (type) {
    case 'image/jpeg': {
      // EOI (FFD9) بعد آخر مسح (FFDA). لا يظهر FFD9 داخل بيانات المسح (FF فيها محشوّة FF00)، فوجوده بعد
      // آخر FFDA يعني أن الملف اكتمل ولو ألحق المضيف بعده بيانات (علامة مائية، حشو). صورة EXIF المصغّرة
      // لها FFDA/FFD9 قبل مسح الصورة نفسها، فلا تخدع القاعدة. المبتور: آخر FFD9 قبل آخر FFDA أو لا FFD9.
      let lastSos = -1;
      let lastEoi = -1;
      for (let i = 2; i < n - 1; i++) {
        if (b[i] !== 0xff) continue;
        const m = b[i + 1];
        if (m === 0xda) lastSos = i;
        else if (m === 0xd9) lastEoi = i;
      }
      return lastEoi > lastSos && lastEoi > 0 ? null : 'jpeg-truncated';
    }
    case 'image/png': {
      // قطعة IEND (قد يليها حشو)
      for (let i = n - 4; i >= 8; i--) if (b[i] === 0x49 && b[i + 1] === 0x45 && b[i + 2] === 0x4e && b[i + 3] === 0x44) return null;
      return 'png-truncated';
    }
    case 'image/webp': {
      // طول RIFF المعلن + 8 = طول الملف (أو أقل منه بحشو)
      const declared = (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0;
      return declared + 8 <= n ? null : 'webp-truncated';
    }
    case 'image/gif': {
      const t = tail(16);
      return t.includes(0x3b) ? null : 'gif-truncated';
    }
    default:
      return null;
  }
}

/** فك فعلي حيث يوجد (WebView/المتصفح): صورة سليمة البنية قد تبقى غير قابلة للعرض. */
async function defaultDecode(bytes, type) {
  if (typeof globalThis.createImageBitmap !== 'function' || typeof globalThis.Blob !== 'function') return { ok: true, skipped: true };
  try {
    const bitmap = await globalThis.createImageBitmap(new Blob([bytes], { type }));
    const ok = bitmap.width > 0 && bitmap.height > 0;
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return { ok, ...size };
  } catch (error) {
    // AVIF وغيره قد لا يفكه createImageBitmap في WebView قديم؛ الحكم للبنية حينها
    if (type === 'image/avif') return { ok: true, skipped: true };
    return { ok: false, reason: String(error?.message ?? error) };
  }
}

async function defaultFetchBytes(src, signal) {
  const res = await fetch(src, { signal });
  if (!res.ok) throw new DownloadError(res.status === 404 || res.status === 410 ? 'SOURCE' : 'NETWORK', `HTTP ${res.status}`, { retryable: res.status >= 500 || res.status === 429 });
  return { bytes: await res.arrayBuffer(), type: res.headers.get('content-type') };
}

const RATE_CODES = new Set(['SITE_HTTP_429', 'HOST_COOLING', 'SITE_NOT_IMAGE']);
const NETWORK_CODES = new Set(['SITE_NETWORK', 'SITE_TIMEOUT', 'OPERATION_TIMEOUT', 'SITE_DNS', 'SITE_UNREACHABLE', 'SITE_TLS']);
const EXTENSION_CODES = new Set(['EXTENSION_PARSE', 'EXTENSION_FAILED', 'PAGE_NO_IMAGE', 'ENGINE_INCOMPATIBLE', 'RECOVERED_TO_LKG', 'REPORTED']);

/**
 * خطأ المحرك (رفض Capacitor برمزه، أو خطأ JS) ⇒ خطأ تنزيل برمز صادق.
 * `retryable`: هل تستحق إعادة؟ `switchable`: هل يُجرَّب مصدر آخر للفصل (عطل المصدر لا الشبكة)؟
 */
export function classifyEngineError(error, { online = true } = {}) {
  if (error instanceof DownloadError) return error;
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? error ?? '');
  const make = (c, { retryable = false, switchable = false, retryAfterMs = 0 } = {}) => {
    const e = new DownloadError(c, message || undefined, { retryable });
    e.engineCode = code || null;
    e.switchable = switchable;
    if (retryAfterMs) e.retryAfterMs = retryAfterMs;
    return e;
  };
  if (!online) return make('NETWORK', { retryable: true });
  if (error?.name === 'QuotaExceededError' || /quota/i.test(message)) return new DownloadError('NO_SPACE');
  if (/CloudflareBypassException$/.test(code) || code === 'SITE_VERIFICATION' || code === 'VERIFICATION_REQUIRED') return make('VERIFICATION', { retryable: false, switchable: true });
  if (RATE_CODES.has(code)) return make('RATE_LIMIT', { retryable: true, retryAfterMs: 8000 });
  if (NETWORK_CODES.has(code)) return make('NETWORK', { retryable: true });
  const http = /^SITE_HTTP_(\d{3})$/.exec(code)?.[1] ?? /\bHTTP (\d{3})\b/.exec(message)?.[1];
  if (http) {
    const status = Number(http);
    if (status === 404 || status === 410) return make('SOURCE', { switchable: true });
    if (status === 401 || status === 403) return make('SOURCE', { retryable: true, switchable: true });
    if (status === 429) return make('RATE_LIMIT', { retryable: true, retryAfterMs: 8000 });
    if (status >= 500) return make('SOURCE', { retryable: true, switchable: true });
    return make('SOURCE', { switchable: true });
  }
  if (code === 'UNSUPPORTED_CAPABILITY' || code === 'CAPABILITY_UNSUPPORTED') return make('UNSUPPORTED', { switchable: true });
  if (code === 'SOURCE_NOT_ADDED' || code === 'SOURCE_NOT_INSTALLED' || code === 'PACKAGE_NOT_INSTALLED' || code === 'SOURCE_DISABLED') return make('NO_ROUTE', { switchable: true });
  if (EXTENSION_CODES.has(code)) return make('EXTENSION', { retryable: true, switchable: true });
  if (/failed to fetch|network|timeout|timed out|connection|ECONN|aborted/i.test(message)) return make('NETWORK', { retryable: true });
  return make('SOURCE', { retryable: true, switchable: true });
}

/** بصمة قائمة الصفحات: العدد وآخر جزء من مسار كل صفحة (بلا استعلام: روابط موقّعة تتجدد كل طلب). */
export function pageListSignature(list) {
  const parts = (list ?? []).map((p) => {
    const raw = String(p?.imageUrl || p?.url || '');
    const path = raw.split('#')[0].split('?')[0];
    return path.slice(path.lastIndexOf('/') + 1) || String(p?.index ?? '');
  });
  let h = 0x811c9dc5;
  const s = `${parts.length}|${parts.join('|')}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${parts.length}:${(h >>> 0).toString(36)}`;
}

const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) return resolve();
  const t = setTimeout(resolve, ms);
  signal?.addEventListener?.('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

/**
 * @param {{ store: object, engine: () => ({ pages: Function, pageImage: Function }),
 *   fetchBytes?: (src: string, signal: AbortSignal) => Promise<{ bytes: ArrayBuffer, type?: string|null }>,
 *   decode?: (bytes: ArrayBuffer, type: string) => Promise<{ ok: boolean, reason?: string }>,
 *   online?: () => boolean, wait?: (ms: number, signal: AbortSignal) => Promise<void> }} deps
 */
export function createMangaDriver(deps) {
  const fetchBytes = deps.fetchBytes ?? defaultFetchBytes;
  const decode = deps.decode ?? defaultDecode;
  const online = deps.online ?? (() => globalThis.navigator?.onLine !== false);
  const wait = deps.wait ?? sleep;

  /** صفحة واحدة: تُجلب وتُفحص وتُحفظ، بمحاولات هادئة لما يستحق الإعادة. */
  async function savePage(item, ctl, engine, sourceId, page, index, pace) {
    let last = null;
    for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
      if (ctl.signal.aborted) return null;
      try {
        const image = await engine.pageImage(sourceId, page);
        if (ctl.signal.aborted) return null;
        const got = await fetchBytes(image?.src ?? image, ctl.signal);
        const size = got?.bytes?.byteLength ?? 0;
        const type = size ? sniffImageType(got.bytes) ?? (IMAGE_TYPES.test(String(got.type ?? '')) ? got.type : null) : null;
        if (!type) throw new DownloadError('VERIFY', `الصفحة ${index + 1} ليست صورة (${size} بايت)`, { retryable: true });
        const broken = imageIntegrity(got.bytes, type);
        if (broken) throw new DownloadError('VERIFY', `الصفحة ${index + 1} مبتورة (${broken})`, { retryable: true });
        const decoded = await decode(got.bytes, type);
        if (!decoded?.ok) throw new DownloadError('VERIFY', `الصفحة ${index + 1} لا تُفك كصورة${decoded?.reason ? `: ${decoded.reason}` : ''}`, { retryable: true });
        await deps.store.putPage(item.id, index, { bytes: size, type, data: got.bytes, ...(decoded.width ? { width: decoded.width, height: decoded.height } : {}) });
        return size;
      } catch (error) {
        if (ctl.signal.aborted) return null;
        if (error?.name === 'QuotaExceededError' || /quota/i.test(String(error?.message))) throw new DownloadError('NO_SPACE');
        last = classifyEngineError(error, { online: online() });
        if (last.code === 'NO_SPACE' || !last.retryable || last.code === 'NETWORK' && !online()) throw last;
        if (last.code === 'RATE_LIMIT') pace.slow();
        if (attempt < PAGE_ATTEMPTS) await wait(last.code === 'RATE_LIMIT' ? 3000 * attempt : 900 * attempt, ctl.signal);
      }
    }
    throw last;
  }

  /** فصل كامل من مصدر واحد. يرمي خطأ تنزيل مصنّفًا. */
  async function fromSource(item, ctl, engine, route, { fresh }) {
    const { sourceId, chapter } = route;
    let list;
    try {
      list = await engine.pages(sourceId, chapter);
    } catch (error) {
      throw classifyEngineError(error, { online: online() });
    }
    if (ctl.signal.aborted) return null;
    if (!Array.isArray(list) || !list.length) {
      const e = new DownloadError('EMPTY', 'الفصل بلا صفحات عند المصدر (مقفل أو أزيل أو تغيّر الموقع)');
      e.switchable = true;
      throw e;
    }
    const total = list.length;
    const signature = pageListSignature(list);
    // قائمة أخرى غير التي بدأ بها التنزيل (أو مصدر آخر): ما حُفظ منها لا يُخلط بهذه
    const prior = item.pagesSignature;
    if (fresh || (prior && prior !== signature) || (item.pagesTotal != null && item.pagesTotal !== total && (item.pages ?? 0) > 0)) {
      await deps.store.deletePages(item.id);
    }
    // المصدر الذي تُنزَّل منه الصفحات الآن: به يُستأنف، والطلب الأصلي (وبدائله) يبقى كما اختير
    ctl.update({ pagesTotal: total, pagesSignature: signature, transport: 'pages', resumable: true, source: { ...item.source, sourceId }, request: { ...item.request, active: { sourceId, chapter } } });

    let saved = 0;
    let bytes = 0;
    const missing = [];
    for (let i = 0; i < total; i++) {
      const page = await deps.store.getPage(item.id, i);
      if (page?.bytes > 0 && page.data?.byteLength === page.bytes) {
        saved++;
        bytes += page.bytes;
      } else missing.push(i);
    }
    ctl.progress({ pages: saved, bytes, total: null });

    let cursor = 0;
    let failure = null;
    let limit = Math.min(PAGE_CONCURRENCY, missing.length);
    const pace = { slow: () => { limit = 1; } };
    const worker = async (slot) => {
      while (!failure && !ctl.signal.aborted && cursor < missing.length) {
        // الموقع طلب التمهّل: العمّال الزائدون يخرجون، ويكمل واحد
        if (slot >= limit) return;
        const index = missing[cursor++];
        try {
          const size = await savePage(item, ctl, engine, sourceId, list[index], index, pace);
          if (size == null) return;
          saved++;
          bytes += size;
          ctl.progress({ pages: saved, bytes });
        } catch (error) {
          if (!ctl.signal.aborted) failure ??= error;
        }
      }
    };
    await Promise.all(Array.from({ length: limit }, (_, slot) => worker(slot)));
    if (ctl.signal.aborted) return null;
    if (failure) {
      // صفحة ما زالت تفشل بعد محاولاتها: المصدر لا يعطيها (لا انقطاع)، فيصح تجريب نسخة أخرى
      if (failure.switchable == null) failure.switchable = failure.code !== 'NETWORK' && failure.code !== 'NO_SPACE';
      throw failure;
    }

    // التحقق: كل صفحة موجودة بترتيبها وغير فارغة وطولها كما كُتب
    ctl.update({ state: 'verifying' });
    let verifiedBytes = 0;
    for (let i = 0; i < total; i++) {
      const page = await deps.store.getPage(item.id, i);
      if (!(page?.bytes > 0) || !page.type || page.data?.byteLength !== page.bytes) throw new DownloadError('VERIFY', `الصفحة ${i + 1} ناقصة`, { retryable: true });
      verifiedBytes += page.bytes;
    }
    return {
      pages: total,
      pagesTotal: total,
      pagesSignature: signature,
      bytes: verifiedBytes,
      total: verifiedBytes,
      storage: { kind: 'pages', bytes: verifiedBytes, verified: true, location: 'مخزن التطبيق' },
    };
  }

  return {
    async run(item, ctl) {
      const engine = deps.engine();
      if (!engine?.pages || !engine?.pageImage) throw new DownloadError('UNSUPPORTED', 'محرك المانجا غير متاح هنا');
      const { sourceId, chapter } = item.request ?? {};
      if (!sourceId || !chapter) throw new DownloadError('NO_ROUTE', 'الفصل بلا مصدر');
      // الذكي وحده يبدّل المصدر؛ اختيارك اليدوي يُحترم ولو فشل
      const smart = item.source?.mode !== 'manual';
      const routes = [];
      const add = (r) => {
        if (r?.sourceId && r?.chapter && !routes.some((x) => x.sourceId === r.sourceId && x.chapter?.url === r.chapter?.url)) routes.push({ sourceId: r.sourceId, chapter: r.chapter, sourceName: r.sourceName ?? null });
      };
      // ما بدأ منه التنزيل أولًا (فيُستأنف بصفحاته)، ثم الطلب الأصلي، ثم بدائل الذكي
      const active = item.request?.active;
      if (smart) add(active);
      add({ sourceId, chapter });
      if (smart) for (const alt of item.request?.alternates ?? []) add(alt);
      const sameRoute = (a, b) => a && b && a.sourceId === b.sourceId && a.chapter?.url === b.chapter?.url;
      const tried = [];
      for (let i = 0; i < routes.length; i++) {
        const route = routes[i];
        try {
          // مصدر غير الذي حُفظت منه الصفحات: يبدأ من الصفر، لا خلط صفحات مصدرين في فصل
          const fresh = i > 0 || (active ? !sameRoute(active, route) : false);
          const result = await fromSource(item, ctl, engine, route, { fresh });
          if (result && tried.length) result.source = { ...item.source, sourceId: route.sourceId, sourceName: route.sourceName ?? item.source?.sourceName ?? null, fallbackFrom: tried.map((t) => t.sourceId) };
          return result;
        } catch (error) {
          if (ctl.signal.aborted) return null;
          tried.push({ sourceId: route.sourceId, code: error?.code, message: error?.message });
          const last = i === routes.length - 1;
          if (last || !error?.switchable) {
            if (tried.length > 1 && error instanceof DownloadError) error.message = `${error.message} — جُرّب ${tried.length} مصادر`;
            throw error;
          }
          ctl.update({ stage: `المصدر ${i + 1} لم يعطِ الفصل، نجرّب نسخة أخرى` });
        }
      }
      return null;
    },

    async remove(item) {
      await deps.store.deletePages(item.id);
    },
  };
}

/** صفحات فصل محفوظ لقارئ بلا اتصال: روابط Blob بترتيبها، ودالة تحريرها عند الخروج. */
export async function localChapterPages(store, item) {
  const urls = [];
  const total = Number(item.pagesTotal ?? item.pages ?? 0);
  for (let i = 0; i < total; i++) {
    const page = await store.getPage(item.id, i);
    if (!page?.data) break;
    urls.push(URL.createObjectURL(new Blob([page.data], { type: page.type })));
  }
  return { urls, complete: urls.length === total, release: () => urls.forEach((u) => URL.revokeObjectURL(u)) };
}
