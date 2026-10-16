export const DESKTOP_DEFAULT_ADDONS_VERSION = 2;
// بيانات وصفية فقط من manifest(config بلا Debrid)؛ Type.ANIME في المصدر يساوي anime.
// لا توضع استجابات stream/catalog في الحزمة ولا يُشغّل كود المصدر داخل VANTARA.
export const TORRENTIO_BUNDLED_PROVENANCE = Object.freeze({
  commit: '0d75331f3cd7f1873279f7a3a57fc1591a21013f',
  manifest: 'https://github.com/TheBeastLT/torrentio-scraper/blob/0d75331f3cd7f1873279f7a3a57fc1591a21013f/addon/lib/manifest.js',
  types: 'https://github.com/TheBeastLT/torrentio-scraper/blob/0d75331f3cd7f1873279f7a3a57fc1591a21013f/addon/lib/types.js',
});
export const TORRENTIO_BUNDLED_MANIFEST = Object.freeze({
  id: 'com.stremio.torrentio.addon', version: '0.0.15', name: 'Torrentio',
  types: ['movie', 'series', 'anime', 'other'], catalogs: [],
  resources: [{ name: 'stream', types: ['movie', 'series', 'anime'], idPrefixes: ['tt', 'kitsu'] }],
  behaviorHints: { configurable: true, configurationRequired: false },
  logo: 'https://torrentio.strem.fun/images/logo_v1.png',
});
export const DESKTOP_DEFAULT_ADDONS = Object.freeze([
  Object.freeze({ id: 'torrentio', name: 'Torrentio', manifestId: 'com.stremio.torrentio.addon', capability: 'streams', url: 'https://torrentio.strem.fun/manifest.json', configureUrl: 'https://torrentio.strem.fun/configure' }),
  Object.freeze({ id: 'cinemeta', name: 'Cinemeta', manifestId: 'com.linvo.cinemeta', capability: 'catalog', url: 'https://v3-cinemeta.strem.io/manifest.json' }),
  Object.freeze({ id: 'opensubtitles', name: 'OpenSubtitles v3', manifestId: 'org.stremio.opensubtitlesv3', capability: 'subtitles', url: 'https://opensubtitles-v3.strem.io/manifest.json' }),
  Object.freeze({ id: 'arabic-subtitles', name: 'الترجمة العربية المجمعة', manifestId: 'org.arabicsubs.combined', capability: 'subtitles', url: 'https://arabic-subtitle-stremio.lovable.app/api/public/manifest.json' }),
]);
const MARKER = 'desktop.defaultAddons.v1';
const tasks = new WeakMap();
const messages = {
  pending: 'تنتظر تهيئة الإضافات', loading: 'جارٍ فحص الإضافة العامة',
  installed: 'تم تثبيت الإضافة العامة؛ التشغيل لم يُختبر بعد',
  preserved: 'احتُفظ بإضافتك وإعداداتها الحالية', skipped: 'احتُفظ باختيارك السابق لهذه الإضافة',
  setup: 'تحتاج الخدمة إلى إعداد قبل الاستخدام',
  failed: 'تعذر جلب الإضافة العامة أو حفظها؛ يمكنك إعادة المحاولة',
  timeout: 'انتهت مهلة جلب الإضافة العامة؛ يمكنك إعادة المحاولة', cancelled: 'أُلغيت تهيئة الإضافة',
  bundled: 'Torrentio مضمّن؛ تعذر الاتصال بالخدمة الآن',
};

/** يعيد مهمة خلفية فورًا؛ لا تربط done ببوابة إقلاع الواجهة أو addons.ready. */
export function startDesktopDefaultAddons({ runtime, onStatus = () => {}, timeoutMs = 10000 } = {}) {
  if (tasks.has(runtime)) return tasks.get(runtime);
  if (!runtime?.store || !runtime?.addons?.registry) throw new Error('مخزن الإضافات وسجلها غير متاحين');
  const { addons } = runtime, store = runtime.addonStore ?? runtime.store, registry = addons.registry;
  const statuses = new Map(DESKTOP_DEFAULT_ADDONS.map(provider => [provider.id, { id: provider.id, name: provider.name, state: 'pending', message: messages.pending }]));
  const controllers = new Set();
  let marker = { version: DESKTOP_DEFAULT_ADDONS_VERSION, providers: {} }, bundles = {}, writes = Promise.resolve(), closed = false;
  const emit = (provider, state, extra = {}) => {
    const row = { id: provider.id, name: provider.name, state, message: messages[state], ...extra };
    statuses.set(provider.id, row);
    try { onStatus({ ...row }); } catch { /* تعطل العرض لا يمنع بقية الإضافات. */ }
  };
  const remember = (provider, handled) => {
    const write = writes.then(async () => {
      const next = { version: DESKTOP_DEFAULT_ADDONS_VERSION, providers: { ...marker.providers, [provider.id]: handled }, bundled: { ...bundles } };
      if ((await store.set('state', MARKER, next)) === false) throw new Error('تعذر حفظ خيارات الإضافات');
      marker = next;
    });
    writes = write.catch(() => {});
    return write;
  };
  const existing = (provider, manifestId = provider.manifestId, exceptKey) => registry.list().find(row =>
    !row.bundled && row.key !== exceptKey && row.id === manifestId);
  const ownedBundle = provider => {
    const info = bundles[provider.id];
    if (!info || provider.id !== 'torrentio') return null;
    const row = registry.list().find(row => row.key === info.key && row.cacheEpoch === info.epoch && row.enabled !== false);
    if (!row) return null;
    try { return registry.connection(row.key).manifestUrl === provider.url ? row : null; }
    catch { return null; }
  };

  async function install(provider) {
    if (closed) { emit(provider, 'cancelled'); return; }
    const controller = new AbortController();
    controllers.add(controller);
    const bundle = ownedBundle(provider);
    let timer, reserved = false, fallbackError = null;
    try {
      if (existing(provider, provider.manifestId, bundle?.key)) {
        delete bundles[provider.id];
        await remember(provider, true);
        emit(provider, 'preserved');
        return;
      }
      if (bundles[provider.id] && !bundle) {
        emit(provider, 'skipped');
        return;
      }
      emit(provider, 'loading');
      // قد يرد النقل الأصلي بعد الإلغاء؛ نفحص ملكية الطلب مجددًا قبل التثبيت.
      const cancelled = new Promise((_, reject) => controller.signal.addEventListener('abort', () =>
        reject(new DOMException('ألغي الجلب', closed ? 'AbortError' : 'TimeoutError')), { once: true }));
      timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
      let preview;
      try {
        preview = await Promise.race([registry.inspect(provider.url, { signal: controller.signal }), cancelled]);
      } catch (error) {
        if (provider.id !== 'torrentio' || error?.name === 'AbortError' || closed) throw error;
        fallbackError = error;
        const rows = await registry.inspectData(JSON.stringify({ manifest: TORRENTIO_BUNDLED_MANIFEST, transportUrl: provider.url }));
        if (!rows[0]?.preview) throw new Error('بيانات Torrentio المضمنة غير متوافقة');
        preview = rows[0].preview;
      }
      clearTimeout(timer);
      if (preview.manifest.id !== provider.manifestId) throw new Error('هوية الإضافة لا تطابق المزود');
      if (preview.manifest.configuration?.required && !preview.manifest.configuration.configured) {
        emit(provider, 'setup', provider.configureUrl ? { configureUrl: provider.configureUrl } : {});
        return;
      }
      if (!preview.manifest.capabilities.includes(provider.capability)) throw new Error('قدرات الإضافة لا تطابق المزود');
      if (existing(provider, preview.manifest.id, bundle?.key)) {
        delete bundles[provider.id];
        await remember(provider, true);
        emit(provider, 'preserved');
        return;
      }
      // نحفظ قبل التثبيت لحماية حذف المستخدم حتى عند سقوط التطبيق بعده مباشرة.
      // بقية المزودات لا تملك بيانات مضمنة، وفشل جلبها يُعاد عند الإقلاع التالي.
      await remember(provider, true);
      reserved = true;
      if (closed || (controller.signal.aborted && !fallbackError)) throw new DOMException('ألغي الجلب', closed ? 'AbortError' : 'TimeoutError');
      if (existing(provider, preview.manifest.id, bundle?.key)) {
        reserved = false;
        emit(provider, 'preserved');
        return;
      }
      const installed = await registry.install(preview, { replace: Boolean(bundle && !fallbackError), expectedCacheEpoch: bundle?.cacheEpoch });
      reserved = false;
      if (!installed) {
        delete bundles[provider.id];
        await remember(provider, true).catch(() => {});
        emit(provider, existing(provider) ? 'preserved' : 'skipped');
        return;
      }
      let preserved = installed.enabled === false;
      try { preserved ||= registry.connection(installed.key).manifestUrl !== provider.url; }
      catch { preserved = true; }
      if (fallbackError && !preserved) {
        const httpStatus = Number.isInteger(fallbackError.status) && fallbackError.status >= 100 && fallbackError.status <= 599 ? fallbackError.status : null;
        const evidence = { connectionState: fallbackError.name === 'TimeoutError' ? 'timeout' : 'failed', ...(httpStatus ? { httpStatus } : {}) };
        bundles[provider.id] = { key: installed.key, epoch: installed.cacheEpoch, ...evidence };
        await remember(provider, true).catch(() => {});
        emit(provider, 'bundled', evidence);
      } else {
        delete bundles[provider.id];
        if (bundle) await remember(provider, true).catch(() => {});
        emit(provider, preserved ? 'preserved' : 'installed');
      }
    } catch (error) {
      // التثبيت المرفوض يرجع سجل الإضافات إلى حالته السابقة، فلا نعتبره اختيار حذف.
      if (reserved) await remember(provider, false).catch(() => {});
      const state = error?.name === 'TimeoutError' ? 'timeout' : error?.name === 'AbortError' ? 'cancelled' : 'failed';
      const httpStatus = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : null;
      emit(provider, state, httpStatus ? { httpStatus } : {});
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }

  const task = {
    statuses: () => [...statuses.values()].map(row => ({ ...row })),
    cancel() { closed = true; for (const controller of controllers) controller.abort(); },
    async retry(id) {
      await task.done;
      if (closed) return task.statuses();
      await Promise.all(DESKTOP_DEFAULT_ADDONS.filter(provider => (!id || provider.id === id) &&
        ['failed', 'timeout', 'cancelled', 'bundled'].includes(statuses.get(provider.id).state)).map(install));
      return task.statuses();
    },
  };
  task.done = Promise.resolve().then(async () => {
    try {
      await addons.ready;
      const saved = await store.get('state', MARKER);
      if (saved?.value?.providers && typeof saved.value.providers === 'object' && !Array.isArray(saved.value.providers))
        marker.providers = { ...saved.value.providers };
      if (saved?.value?.bundled && typeof saved.value.bundled === 'object' && !Array.isArray(saved.value.bundled))
        bundles = { ...saved.value.bundled };
      await Promise.all(DESKTOP_DEFAULT_ADDONS.map(provider => {
        if (marker.providers[provider.id] === true) {
          if (ownedBundle(provider)) return install(provider);
          emit(provider, existing(provider) ? 'preserved' : 'skipped');
          return;
        }
        return install(provider);
      }));
    } catch {
      for (const provider of DESKTOP_DEFAULT_ADDONS) emit(provider, 'failed');
    }
    return task.statuses();
  });
  tasks.set(runtime, task);
  return task;
}
