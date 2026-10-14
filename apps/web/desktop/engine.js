/** AnimeEngine desktop: البيانات تأتي من adapter، واختيار التشغيل صريح. */
export function createDesktopEngine({ bridge = globalThis.VantaraDesktop, getRuntime } = {}) {
  const sessions = new Map(), listeners = new Map();
  const emit = (name, event) => { for (const fn of listeners.get(name) ?? []) { try { fn(event); } catch { /* المستمع لا يوقف تنظيف الجلسة */ } } };
  const snapshot = s => ({ copies: [...s.copies.values()], routes: [...s.routes.values()].map(r => ({ ...r, candidates: [...r.candidates] })), done: s.done, retryAt: 0 });
  const current = s => !s.closed && sessions.get(s.id) === s;
  const routeUpdate = (s, route) => {
    if (!current(s)) return;
    s.routes.set(route.id, route);
    emit('route', { session: s.id, route: { ...route }, retryAt: 0 });
  };
  const choices = (s, route = null) => [...s.candidates.values()].filter(c => (!route || c.route === route) && s.routes.get(c.route)?.state === 'READY')
    .sort((a, b) => Math.abs((a.quality ?? s.quality) - s.quality) - Math.abs((b.quality ?? s.quality) - s.quality));
  const sessionOf = id => {
    const s = sessions.get(id);
    if (!s || s.closed) throw new Error('الجلسة انتهت؛ افتح السيرفرات من جديد');
    return s;
  };
  async function finish(s, { stop = false } = {}) {
    if (!current(s)) return;
    s.closed = true; s.controller.abort(); sessions.delete(s.id);
    s.snapshot?.release();
    if (s.playing) emit('playback', { ...s.context, session: s.id, ...s.progress, final: true });
    emit('sessionClosed', { session: s.id });
    if (stop && s.playing) await bridge.stopPlayback({ session: s.id });
  }
  bridge?.onEvent?.(event => {
    const s = sessions.get(event.session);
    if (!s || !s.playing || !current(s)) return;
    if (event.type === 'playback/closed' && s.ignorePreviousClose) { s.ignorePreviousClose = false; return; }
    emit('desktopPlayback', event);
    if (event.type === 'playback/progress') {
      s.progress = { position: event.position, duration: event.duration };
      emit('playback', { ...s.context, ...s.progress, session: s.id, final: false });
    } else if (event.type === 'playback/error') {
      emit('playerError', { session: s.id, message: event.message ?? 'تعذر تشغيل الفيديو' });
      void finish(s);
    } else if (event.type === 'playback/closed') void finish(s);
  });
  async function startCopies(s, copies) {
    const runtime = await getRuntime(); await runtime.ready; await runtime.addons.ready;
    if (!current(s)) return 0;
    const jobs = [];
    for (const copy of copies ?? []) {
      if (!copy.sourceId?.startsWith('addon|')) continue;
      const key = `${copy.sourceId}|${copy.id ?? copy.url}`;
      if (s.copies.has(key)) continue;
      s.copies.set(key, copy);
      const source = runtime.addons.sources.source(copy.sourceId);
      if (!source) continue;
      const base = { id: `${key}|episode:${s.episode}`, sourceId: copy.sourceId, sourceName: runtime.addons.sources.def(copy.sourceId)?.label ?? copy.title ?? 'إضافة', server: copy.title ?? 'إضافة', code: 'ADDON', quality: null, variant: s.variant, state: 'RESOLVING', candidates: [], probed: null, runtimeReady: false };
      routeUpdate(s, base);
      jobs.push((async () => {
        try {
          const eps = await source.episodes(copy, { signal: s.controller.signal });
          const ep = eps.find(e => Number(e.number) === s.episode && (copy.requestedSeason == null || Number(e.season ?? copy.requestedSeason) === Number(copy.requestedSeason)));
          if (!ep) throw new Error('الحلقة المطلوبة غير متاحة في هذه الإضافة');
          const servers = await source.servers(ep, { signal: s.controller.signal });
          if (!servers.length) throw new Error('الإضافة لا توفر سيرفرات لهذا العمل');
          let count = 0;
          for (let index = 0; index < servers.length; index++) {
            const server = servers[index];
            const streams = await source.streams(server, undefined, { signal: s.controller.signal });
            if (!current(s)) return;
            for (const st of streams) {
              if (st.status && st.status !== 'RESOLVED' || !(st.url || st.infoHash || st.magnet)) continue;
              const id = count === 0 ? base.id : `${base.id}|${index}|${count}`;
              count++;
              const candidate = { ...st, id, route: id, sourceId: copy.sourceId, sourceName: base.sourceName, server: server.name, code: 'ADDON', variant: s.variant };
              s.candidates.set(id, candidate);
              routeUpdate(s, { ...base, id, server: server.name, quality: st.quality ?? null, label: st.title ?? st.filename ?? st.name ?? null, state: 'READY', runtimeReady: true, candidates: [id] });
            }
          }
          if (!count) routeUpdate(s, { ...base, state: 'UNAVAILABLE', reason: 'الإضافة لم تُرجع رابطًا صالحًا' });
        } catch (error) {
          if (current(s)) routeUpdate(s, { ...base, state: 'UNAVAILABLE', reason: String(error?.message ?? error) });
        }
      })());
    }
    s.running += jobs.length;
    await Promise.all(jobs);
    s.running -= jobs.length;
    if (current(s) && s.running === 0) { s.done = true; emit('prepared', { session: s.id, ...snapshot(s) }); }
    return jobs.length;
  }
  const engine = {
    async configure() { return { ok: true, errors: [] }; },
    async sources() { const r = await getRuntime(); await r.addons.ready; return { sources: r.addons.sources.list().map(d => ({ id: d.id, name: d.label, content: d.content, enabled: true })) }; },
    async health() { return { records: [] }; },
    async search() { return { works: [] }; },
    async searchStream({ searchId }) { queueMicrotask(() => emit('searchDone', { searchId })); return { searchId }; },
    async cancelSearch() {},
    async details({ anime }) { return { anime }; },
    async episodes({ anime }) { const r = await getRuntime(); await r.addons.ready; return { episodes: await r.addons.sources.source(anime.sourceId)?.episodes(anime) ?? [] }; },
    async prepare({ copies = [], episode, quality = 1080, variant = 'SUB', session }) {
      const id = session ?? `desktop-${globalThis.crypto.randomUUID()}`;
      if (sessions.has(id)) await finish(sessions.get(id), { stop: true });
      const r = await getRuntime(); await r.addons.ready;
      const s = { id, episode: Number(episode), quality, variant, copies: new Map(), routes: new Map(), candidates: new Map(), done: false, closed: false, playing: false, running: 0, controller: new AbortController(), snapshot: r.addons.registry.snapshot(), progress: {} };
      sessions.set(id, s); void startCopies(s, copies).catch(error => { if (current(s)) { s.done = true; emit('prepared', { session: id, ...snapshot(s), error: error.message }); } });
      return { session: id, ...snapshot(s) };
    },
    async extend({ session, copies }) { const s = sessionOf(session); s.done = false; return { added: await startCopies(s, copies) }; },
    async routes({ session }) { const s = sessions.get(session); return s ? snapshot(s) : { routes: [], done: true, retryAt: 0 }; },
    async best({ session, prefer = null, waitMs = 45000 }) {
      const s = sessionOf(session), end = Date.now() + waitMs;
      while (!choices(s).length && !s.done && current(s) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 50));
      const c = choices(s).find(c => c.code === prefer) ?? choices(s)[0];
      return { candidate: c?.id ?? null, route: c?.route ?? null, code: c?.code ?? null };
    },
    async pick({ session, route }) { return { candidate: choices(sessionOf(session), route)[0]?.id ?? null }; },
    async play(args) {
      const s = sessionOf(args.session), c = s.candidates.get(args.candidate);
      if (!c || s.routes.get(c.route)?.state !== 'READY') throw new Error('المرشح غير متاح؛ اختر السيرفر من جديد');
      s.context = { animeId: args.animeId, episode: args.episode ?? s.episode, code: c.code };
      s.ignorePreviousClose = s.playing;
      s.playing = true;
      try {
        const out = await bridge.startPlayback({ session: s.id, candidate: c, title: args.title ?? 'VANTARA', position: args.position ?? 0 });
        if (!out?.started) throw new Error('لم يبدأ المشغل');
        s.ignorePreviousClose = false;
        return out;
      } catch (error) {
        emit('playerError', { session: s.id, message: error.message ?? 'تعذر تشغيل الفيديو' });
        await finish(s, { stop: true }); throw error;
      }
    },
    async closeSession({ session }) { const s = sessions.get(session); if (s) await finish(s, { stop: true }); },
    async outbox() { return { items: [] }; },
    async unblock() {}, async crawl() {}, async stopCrawl() {},
    async verify() { return { ok: false, error: 'التحقق اليدوي لمصادر Android غير متاح على ويندوز' }; },
    async diagnose() { return { steps: [{ label: 'المصدر', state: 'warn', detail: 'افحص الإضافة من مدير الإضافات' }] }; },
    addListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return { remove: async () => listeners.get(name)?.delete(fn) }; },
  };
  return engine;
}
