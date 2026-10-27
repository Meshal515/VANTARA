/** Source-scoped bridge facade. Does not install, register, migrate, or assess playback health. */
const incompatible = (code, reason) => ({ status: 'incompatible', code, reason });
const failure = (code, message) => Object.assign(new Error(message), { code });
const aborted = () => new DOMException('ألغي طلب المصدر', 'AbortError');
async function nativeCall(run, signal) {
  if (signal?.aborted) throw aborted();
  if (!signal) return run();
  let abort;
  const cancellation = new Promise((_, reject) => {
    abort = () => reject(aborted());
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    const result = await Promise.race([Promise.resolve().then(() => {
      if (signal.aborted) throw aborted();
      return run();
    }), cancellation]);
    if (signal.aborted) throw aborted();
    return result;
  } finally { signal.removeEventListener('abort', abort); }
}
const validId = value => typeof value === 'string' && value.length > 0;

/**
 * Result: ready {addon,adapter,source,sourceId}, select-source {sources}, or incompatible {code,reason}.
 * plugins are the real Capacitor bridges, not a cross-source search facade.
 * sourceId selects only among the installed package's bridge-declared sources.
 */
export async function createNativeCatalog(record, {
  plugins = globalThis.Capacitor?.Plugins ?? {}, sourceId, signal,
} = {}) {
  const family = record?._store?.kind ?? record?.kind;
  if (/cloudstream/i.test(String(record?.protocol ?? record?.engine ?? family)) || !['manga', 'anime', 'cinema'].includes(family))
    return incompatible('UNSUPPORTED_NATIVE_ENGINE', 'لا يوجد محرك تشغيل أصلي متوافق لهذه الإضافة في هذا الإصدار.');
  const manga = family === 'manga';
  if ((manga && record.anime === true) || (!manga && record.anime === false))
    return incompatible('WRONG_NATIVE_ENGINE', 'نوع الإضافة لا يطابق محرك المستودع.');
  const engine = plugins[manga ? 'ExtensionEngine' : 'AnimeEngine'];
  const required = manga ? ['sources', 'catalogue', 'search', 'series', 'chapters', 'pages'] : ['sources', 'page', 'details', 'episodes'];
  if (!engine || required.some(method => typeof engine[method] !== 'function'))
    return incompatible('NATIVE_RUNTIME_UNAVAILABLE', 'واجهة تشغيل هذا المصدر غير متاحة على هذا الجهاز.');
  let declared;
  try { declared = await nativeCall(() => engine.sources(), signal); }
  catch (error) {
    if (error.name === 'AbortError') throw error;
    return incompatible('SOURCE_DISCOVERY_FAILED', 'تعذر قراءة المصادر من المحرك الأصلي.');
  }
  if (!Array.isArray(declared?.sources))
    return incompatible('INVALID_NATIVE_RESPONSE', 'لم يعرض المحرك بيان مصادر صالحًا.');
  const pkg = validId(record.pkg) ? record.pkg : null;
  const explicit = new Set([record.sourceId, ...(Array.isArray(record.sourceIds) ? record.sourceIds : [])].filter(validId));
  const matches = declared.sources.filter(row => {
    if (!validId(row?.id)) return false;
    const owner = row.pkg ?? row.extension?.pkg;
    if (pkg && owner) return owner === pkg;
    if (explicit.has(row.id)) return true;
    // Existing manga bridges explicitly declare these package-qualified IDs.
    // Anime user IDs are opaque: never derive user-<suffix> or compare display names.
    return manga && pkg && (row.id === pkg || row.id.startsWith(pkg + '#') || row.id.startsWith(pkg + '@'));
  });
  const choices = [...new Map(matches.map(row => [row.id, row])).values()];
  if (!choices.length || (sourceId && !choices.some(row => row.id === sourceId)))
    return incompatible('SOURCE_NOT_DECLARED', 'لم يعلن المحرك معرّف مصدر يطابق حزمة الإضافة المثبتة.');
  if (!sourceId && choices.length > 1) return {
    status: 'select-source',
    sources: choices.map(row => ({ sourceId: row.id, name: row.label ?? row.name ?? row.id, pkg, content: manga ? 'manga' : row.content, enabled: row.enabled !== false })),
  };
  const selected = choices.find(row => row.id === sourceId) ?? choices[0];
  if (selected.enabled === false)
    return incompatible('NATIVE_SOURCE_DISABLED', 'هذا المصدر معطّل في المحرك الأصلي.');
  const content = manga ? 'manga' : selected.content ?? record.content;
  if (!['manga', 'anime', 'cinema'].includes(content))
    return incompatible('SOURCE_CONTENT_UNDECLARED', 'لم يحدد المحرك نوع محتوى هذا المصدر.');
  const id = selected.id;
  const types = content === 'cinema' ? ['movie', 'series'] : [content];
  const item = value => {
    if (!value || typeof value !== 'object' || !validId(String(value.url ?? value.id ?? '')) || !validId(value.title ?? value.name) || (value.sourceId != null && value.sourceId !== id))
      throw failure('INVALID_NATIVE_RESPONSE', 'أعاد المحرك عملًا غير صالح أو تابعًا لمصدر آخر.');
    if (value.type != null && !types.includes(value.type))
      throw failure('INVALID_NATIVE_RESPONSE', 'نوع العمل لا يطابق محتوى المصدر.');
    return { ...value, sourceId: id, ...(content !== 'cinema' ? { type: content } : {}) };
  };
  const page = result => {
    const data = manga ? result : result?.page;
    const list = manga ? data?.mangas ?? data?.items : data?.items;
    if (!Array.isArray(list)) throw failure('INVALID_NATIVE_RESPONSE', 'لم يُرجع المصدر قائمة أعمال صالحة.');
    return { ...data, items: list.map(item), hasNextPage: data.hasNextPage ?? data.hasNext ?? false };
  };
  const invoke = (method, args, options = {}) => nativeCall(() => {
    if (typeof engine[method] !== 'function') throw failure('UNSUPPORTED_NATIVE_CAPABILITY', 'هذه الوظيفة غير متاحة من المحرك الأصلي.');
    return engine[method](args);
  }, options.signal);
  const listing = async (name, number = 1, query = '', options = {}) => {
    if (!Number.isInteger(number) || number < 1) throw failure('INVALID_NATIVE_REQUEST', 'رقم صفحة المصدر غير صالح.');
    const result = manga
      ? await invoke(name, { sourceId: id, page: number, ...(name === 'search' ? { query } : {}) }, options)
      : await invoke('page', { sourceId: id, listing: name, page: number, query }, options);
    return page(result);
  };
  const latestMethod = manga && typeof engine.latest !== 'function' ? 'catalogue' : 'latest';
  const adapter = {
    home: (number, options) => listing(latestMethod, number, '', options),
    latest: (number, options) => listing(latestMethod, number, '', options),
    catalogue: (number, options) => listing(manga ? 'catalogue' : 'popular', number, '', options),
    search: (query, number, options) => listing('search', number, String(query ?? ''), options),
  };
  if (!manga || typeof engine.popular === 'function') adapter.popular = (number, options) => listing('popular', number, '', options);
  if (manga) {
    adapter.series = async (work, options) => {
      const result = await invoke('series', { sourceId: id, manga: item(work) }, options);
      if (!result || !Array.isArray(result.chapters)) throw failure('INVALID_NATIVE_RESPONSE', 'لم يُرجع المصدر تفاصيل وفصولًا صالحة.');
      return { ...result, manga: item(result.manga ?? work) };
    };
    adapter.chapters = async (work, options) => {
      const result = await invoke('chapters', { sourceId: id, manga: item(work) }, options);
      if (!Array.isArray(result?.chapters)) throw failure('INVALID_NATIVE_RESPONSE', 'لم يُرجع المصدر فصولًا صالحة.');
      return result.chapters;
    };
    adapter.pages = async (chapter, options) => {
      const result = await invoke('pages', { sourceId: id, chapter }, options);
      if (!Array.isArray(result?.pages)) throw failure('INVALID_NATIVE_RESPONSE', 'لم يُرجع المصدر صفحات صالحة.');
      return result.pages;
    };
  } else {
    adapter.series = async (work, options) => {
      const result = await invoke('details', { anime: item(work) }, options);
      return { work: item(result?.anime) };
    };
    adapter.episodes = async (work, options) => {
      const result = await invoke('episodes', { anime: item(work) }, options);
      if (!Array.isArray(result?.episodes)) throw failure('INVALID_NATIVE_RESPONSE', 'لم يُرجع المصدر حلقات صالحة.');
      return result.episodes;
    };
  }
  const capabilities = ['home', 'search', 'details', ...(manga ? ['pages'] : ['episodes'])];
  const addon = {
    // The caller must resolve this sourceId in the refreshed runtime registry before opening works.
    key: `core|${id}`,
    sourceId: id, pkg, name: selected.label ?? selected.name ?? record.name ?? id,
    version: record.version ?? selected.version ?? '', iconUrl: record.iconUrl ?? selected.iconUrl ?? null,
    protocol: 'native', enabled: true, bundled: false, user: true, contentTypes: types, capabilities,
    compatibility: { apk: true, apkCapabilities: capabilities, pwa: false, desktop: false },
  };
  return { status: 'ready', addon, adapter, source: adapter, sourceId: id };
}
