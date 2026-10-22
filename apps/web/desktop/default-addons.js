export const DESKTOP_DEFAULT_ADDONS_VERSION = 3;
// Torrentio requires an explicit choice in Explore. Recognize existing installs
// here, but never fetch, replace, or fabricate its manifest during startup.
export const DESKTOP_DEFAULT_ADDONS = Object.freeze([
  Object.freeze({ id: 'torrentio', requiresChoice: true, name: 'Torrentio', manifestId: 'com.stremio.torrentio.addon', capability: 'streams', url: 'https://torrentio.strem.fun/manifest.json', configureUrl: 'https://torrentio.strem.fun/configure' }),
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
};

/** يعيد مهمة خلفية فورًا؛ لا تربط done ببوابة إقلاع الواجهة أو addons.ready. */
export function startDesktopDefaultAddons({ runtime, onStatus = () => {}, timeoutMs = 10000 } = {}) {
  if (tasks.has(runtime)) return tasks.get(runtime);
  if (!runtime?.store || !runtime?.addons?.registry) throw new Error('مخزن الإضافات وسجلها غير متاحين');
  const { addons } = runtime, store = runtime.addonStore ?? runtime.store, registry = addons.registry;
  const statuses = new Map(DESKTOP_DEFAULT_ADDONS.map(provider => [provider.id, { id: provider.id, name: provider.name, state: 'pending', message: messages.pending }]));
  const controllers = new Set();
  let marker = { version: DESKTOP_DEFAULT_ADDONS_VERSION, providers: {} }, writes = Promise.resolve(), closed = false;
  const emit = (provider, state, extra = {}) => {
    const row = { id: provider.id, name: provider.name, state, message: messages[state], ...extra };
    statuses.set(provider.id, row);
    try { onStatus({ ...row }); } catch { /* تعطل العرض لا يمنع بقية الإضافات. */ }
  };
  const remember = (provider, handled) => {
    const write = writes.then(async () => {
      const next = { version: DESKTOP_DEFAULT_ADDONS_VERSION, providers: { ...marker.providers, [provider.id]: handled } };
      if ((await store.set('state', MARKER, next)) === false) throw new Error('تعذر حفظ خيارات الإضافات');
      marker = next;
    });
    writes = write.catch(() => {});
    return write;
  };
  const existing = (provider, manifestId = provider.manifestId) => registry.list().find(row =>
    !row.bundled && row.id === manifestId);

  async function install(provider) {
    if (closed) { emit(provider, 'cancelled'); return; }
    if (provider.requiresChoice) {
      emit(provider, existing(provider) ? 'preserved' : 'setup', { configureUrl: provider.configureUrl });
      return;
    }
    const controller = new AbortController();
    controllers.add(controller);
    let timer, reserved = false;
    try {
      if (existing(provider)) {
        await remember(provider, true);
        emit(provider, 'preserved');
        return;
      }
      emit(provider, 'loading');
      // قد يرد النقل الأصلي بعد الإلغاء؛ نفحص ملكية الطلب مجددًا قبل التثبيت.
      const cancelled = new Promise((_, reject) => controller.signal.addEventListener('abort', () =>
        reject(new DOMException('ألغي الجلب', closed ? 'AbortError' : 'TimeoutError')), { once: true }));
      timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
      const preview = await Promise.race([registry.inspect(provider.url, { signal: controller.signal }), cancelled]);
      clearTimeout(timer);
      if (preview.manifest.id !== provider.manifestId) throw new Error('هوية الإضافة لا تطابق المزود');
      if (preview.manifest.configuration?.required && !preview.manifest.configuration.configured) {
        emit(provider, 'setup', provider.configureUrl ? { configureUrl: provider.configureUrl } : {});
        return;
      }
      if (!preview.manifest.capabilities.includes(provider.capability)) throw new Error('قدرات الإضافة لا تطابق المزود');
      if (existing(provider, preview.manifest.id)) {
        await remember(provider, true);
        emit(provider, 'preserved');
        return;
      }
      // نحفظ قبل التثبيت لحماية حذف المستخدم حتى عند سقوط التطبيق بعده مباشرة.
      await remember(provider, true);
      reserved = true;
      if (closed || controller.signal.aborted) throw new DOMException('ألغي الجلب', closed ? 'AbortError' : 'TimeoutError');
      if (existing(provider, preview.manifest.id)) {
        reserved = false;
        emit(provider, 'preserved');
        return;
      }
      const installed = await registry.install(preview, { replace: false });
      reserved = false;
      let preserved = installed.enabled === false;
      try { preserved ||= registry.connection(installed.key).manifestUrl !== provider.url; }
      catch { preserved = true; }
      emit(provider, preserved ? 'preserved' : 'installed');
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
        (provider.requiresChoice || ['failed', 'timeout', 'cancelled'].includes(statuses.get(provider.id).state))).map(install));
      return task.statuses();
    },
  };
  task.done = Promise.resolve().then(async () => {
    try {
      await addons.ready;
      const saved = await store.get('state', MARKER);
      if (saved?.value?.providers && typeof saved.value.providers === 'object' && !Array.isArray(saved.value.providers))
        marker.providers = { ...saved.value.providers };
      await Promise.all(DESKTOP_DEFAULT_ADDONS.map(provider => {
        if (provider.requiresChoice) return install(provider);
        if (marker.providers[provider.id] === true) {
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
