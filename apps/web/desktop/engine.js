import { discoverSubtitles } from '../addons/subtitles.js';
import { createDesktopTogetherPlayer } from './together-player.js';
import { publicUrl } from '../addons/manifest.js';
/** AnimeEngine desktop: البيانات تأتي من adapter، واختيار التشغيل صريح. */
export function createDesktopEngine({ bridge = globalThis.VantaraDesktop, getRuntime } = {}) {
  const sessions = new Map(), listeners = new Map(), searches = new Map();
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
    s.closed = true; s.controller.abort(); s.subtitleController?.abort(); sessions.delete(s.id);
    s.together?.close();emit('desktopTogether',{session:s.id,closed:true});
    s.snapshot?.release();
    if (s.playing) emit('playback', { ...s.context, session: s.id, ...s.progress, final: true });
    emit('sessionClosed', { session: s.id });
    if (stop && s.playing) await bridge.stopPlayback({ session: s.id });
  }
  bridge?.onEvent?.(event => {
    const s = sessions.get(event.session);
    if (!s || !s.playing || !current(s)) return;
    if (event.type === 'playback/closed' && s.ignorePreviousClose) { s.ignorePreviousClose = false; return; }
    if(event.type==='playback/ready'){
      s.nativeReady=true;
      if(s.resumeAfterDetach){s.resumeAfterDetach=false;void bridge.playbackCommand({session:s.id,command:'pause',value:false}).catch(()=>{});}
    }
    s.together?.progressEvent(event);
    emit('desktopPlayback', event);
    if (event.type === 'playback/progress') {
      s.progress = { position: event.position, duration: event.duration };
      emit('playback', { ...s.context, ...s.progress, session: s.id, final: false });
    } else if (event.type === 'playback/error') {
      emit('playerError', { session: s.id, message: event.message ?? 'تعذر تشغيل الفيديو' });
      void finish(s);
    } else if (event.type === 'playback/closed') void finish(s);
  });
  const sourceCall = (runtime, id, fn) => runtime.addons.sources.call
    ? runtime.addons.sources.call(id, fn)
    : fn(runtime.addons.sources.source(id));
  const fold = value => String(value ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const videoDefs = (runtime, content) => runtime.addons.sources.list(content).filter(d => d.content !== 'manga' && d.engine !== 'remote-addon');
  async function searchSource(runtime, def, query, signal) {
    if (signal?.aborted) return [];
    const fetch = () => sourceCall(runtime, def.id, source => source.search(query, { signal }));
    const result = runtime.store?.cached
      ? (await runtime.store.cached('source', `${def.id}|desktop-vsearch|${fold(query)}`, fetch, { ttlMs: 30 * 60 * 1000 })).value
      : await fetch();
    return (Array.isArray(result) ? result : []).filter(it => it && typeof it.title === 'string' && typeof (it.url ?? it.id) === 'string')
      .slice(0, 500).map(it => ({ ...it, sourceId: def.id }));
  }
  async function startCopies(s, copies) {
    const generation = s.prepareGeneration ?? 0, episode = s.episode, signal = s.controller.signal;
    const valid = () => current(s) && !signal.aborted && (s.prepareGeneration ?? 0) === generation;
    const runtime = await getRuntime(); await runtime.ready; await runtime.addons.ready;
    if (!valid()) return 0;
    const jobs = [];
    for (let copy of copies ?? []) {
      if (!copy?.sourceId) continue;
      if (copy.sourceId.startsWith('addon|')) copy = { ...copy, episode, identity: copy.identity ? { ...copy.identity, episode } : copy.identity };
      const key = `${copy.sourceId}|${copy.id ?? copy.url}`;
      if (s.copies.has(key)) continue;
      s.copies.set(key, copy);
      const source = runtime.addons.sources.source(copy.sourceId), def = runtime.addons.sources.def(copy.sourceId);
      if (!source || def?.content === 'manga') continue;
      const code = copy.sourceId.startsWith('addon|') ? 'ADDON' : (def?.code ?? copy.sourceId.slice(0, 3).toUpperCase());
      const base = { id: `${key}|episode:${episode}`, sourceId: copy.sourceId, sourceName: def?.label ?? copy.title ?? 'مصدر', server: copy.title ?? 'مصدر', code, quality: null, variant: s.variant, state: 'RESOLVING', candidates: [], probed: null, runtimeReady: false };
      routeUpdate(s, base);
      jobs.push((async () => {
        try {
          if (runtime.addons.sources.cooling?.(copy.sourceId)) throw new Error('المصدر يرتاح بعد أعطال؛ جرّب لاحقًا');
          const eps = await sourceCall(runtime, copy.sourceId, src => src.episodes(copy, { signal }));
          if (!valid()) return;
          const matches = eps.filter(e => Number(e.number) === episode && (copy.requestedSeason == null || e.season == null || Number(e.season) === Number(copy.requestedSeason)));
          const ep = episode < 0 ? eps[0] : matches.length === 1 ? matches[0] : null;
          if (!ep) throw new Error('الحلقة المطلوبة غير متاحة في هذا المصدر');
          const servers = await sourceCall(runtime, copy.sourceId, src => src.servers(ep, { signal }));
          if (!valid()) return;
          if (!servers.length) throw new Error('المصدر لا يوفر سيرفرات لهذا العمل');
          let count = 0;
          const seen = new Set();
          for (let index = 0; index < servers.length; index++) {
            if (!valid()) return;
            const server = servers[index]; if (server.unsupported) continue;
            let accepting = true;
            const publish = streams => {
              if (!accepting || !valid()) return;
              for (const st of streams ?? []) {
                if (!st || st.status && st.status !== 'RESOLVED' || !(st.url || st.infoHash || st.magnet)) continue;
                if (st.url) { try { publicUrl(st.url); } catch { continue; } }
                const key = `${st.url ?? st.infoHash ?? st.magnet}|${st.fileIdx ?? ''}|${st.quality ?? server.quality ?? ''}`;
                if (seen.has(key)) continue; seen.add(key);
                const id = count === 0 ? base.id : `${base.id}|${index}|${count}`; count++;
                const headers = { ...(st.headers ?? {}) };
                if (st.referer && !Object.keys(headers).some(k => k.toLowerCase() === 'referer')) headers.Referer = st.referer;
                const candidate = { ...st, headers, quality: st.quality ?? server.quality ?? null, id, route: id, sourceId: copy.sourceId, sourceName: base.sourceName, server: server.name, code: server.code ?? code, variant: server.variant ?? s.variant,
                  identity: st.identity ?? { ...copy.identity, externalIds: copy.externalIds, kind: copy.type ?? (def?.content === 'anime' ? 'anime' : undefined), season: ep.season ?? copy.requestedSeason, episode: ep.number } };
                s.candidates.set(id, candidate);
                routeUpdate(s, { ...base, id, server: server.name, code: candidate.code, quality: candidate.quality, label: st.title ?? st.filename ?? st.name ?? null, state: 'READY', runtimeReady: true, candidates: [id] });
              }
            };
            try {
              const streams = await sourceCall(runtime, copy.sourceId, src => src.streams(server, publish, { signal }));
              publish(streams);
            } catch (error) { if (!count && index === servers.length - 1) throw error; }
            finally { accepting = false; }
          }
          if (valid() && !count) routeUpdate(s, { ...base, state: 'UNAVAILABLE', reason: 'المصدر لم يُرجع رابطًا صالحًا' });
        } catch (error) {
          if (valid()) routeUpdate(s, { ...base, state: 'UNAVAILABLE', reason: String(error?.message ?? error) });
        }
      })());
    }
    s.running += jobs.length;
    await Promise.all(jobs);
    if (!valid()) return jobs.length;
    s.running -= jobs.length;
    if (s.running === 0) { s.done = true; emit('prepared', { session: s.id, ...snapshot(s) }); }
    return jobs.length;
  }
  async function startSubtitles(s, candidate, identity, generation) {
    try {
      const runtime = await getRuntime(); await runtime.addons.ready;
      if (!current(s) || generation !== s.playGeneration) return;
      let context = { ...identity, ...Object.fromEntries(Object.entries(candidate.identity ?? {}).filter(([key, value]) => value != null && key !== 'externalIds')), externalIds: { ...identity?.externalIds, ...candidate.identity?.externalIds } };
      if (!['movie', 'series', 'anime'].includes(context.kind)) context.kind = identity?.kind;
      // Anime subtitle providers often index Kitsu/IMDb, not the visible title.
      // Enrich exact MAL/AniList mappings in the background; failure never blocks video.
      if (context.kind === 'anime' && !context.externalIds?.kitsu && typeof runtime.addons.enrichAnimeIdentity === 'function') {
        try { context = await runtime.addons.enrichAnimeIdentity(context, { signal: s.subtitleController.signal }); }
        catch { /* Keep existing identity when exact ID service is unavailable. */ }
      }
      if (!current(s) || generation !== s.playGeneration || s.subtitleController.signal.aborted) return;
      await discoverSubtitles({ identity: context, stream: candidate, providers: runtime.addons.subtitleProviders?.() ?? [], signal: s.subtitleController.signal,
        onHealth: (key, ok) => { if (!current(s) || generation !== s.playGeneration) return; const health = runtime.addons.registry.health; if (ok) health?.success?.(key, 'subtitles', 'desktop'); else health?.failure?.(key, 'subtitles', 'desktop'); },
        onResult: result => {
          if (!current(s) || generation !== s.playGeneration) return;
          void bridge.playbackCommand({ session: s.id, command: 'subtitle-load', value: { url: result.url, lang: result.lang, label: `${result.label} · ${result.provider}` } }).catch(() => {});
        } });
    } catch { /* تعطل مزود الترجمة لا يوقف الفيديو */ }
  }
  const engine = {
    async configure() { return { ok: true, errors: [] }; },
    async sources() { const r = await getRuntime(); await r.addons.ready; return { sources: r.addons.sources.list().filter(d => d.content !== 'manga').map(d => ({ id: d.id, name: d.label, content: d.content, enabled: true })) }; },
    async health() { return { records: [] }; },
    async search({ query, content = 'anime' }) {
      const runtime = await getRuntime(); await runtime.ready; await runtime.addons.ready;
      const lists = await Promise.all(videoDefs(runtime, content).map(def => searchSource(runtime, def, query).catch(() => [])));
      const works = new Map();
      for (const item of lists.flat()) { const key = fold(item.title), work = works.get(key) ?? { key, title: item.title, thumbnail: item.thumbnail ?? null, copies: [] }; if (!work.copies.some(c => c.sourceId === item.sourceId && c.url === item.url)) work.copies.push(item); works.set(key, work); }
      return { works: [...works.values()] };
    },
    async searchStream({ query, content = 'anime', searchId, timeoutMs = 25000 }) {
      searches.get(searchId)?.abort(); const controller = new AbortController(); searches.set(searchId, controller);
      void (async () => {
        const runtime = await getRuntime(); await runtime.ready; await runtime.addons.ready;
        await Promise.all(videoDefs(runtime, content).map(async def => {
          const started = Date.now(); let timer, items = [], error = null, skipped = false;
          try {
            if (runtime.addons.sources.cooling?.(def.id)) { skipped = true; throw new Error('المصدر يرتاح بعد أعطال'); }
            items = await Promise.race([searchSource(runtime, def, query, controller.signal), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('لم يرد المصدر في الوقت المحدد')), Math.min(60000, Math.max(100, timeoutMs))); })]);
          } catch (e) { error = e.message ?? String(e); }
          finally { clearTimeout(timer); }
          if (!controller.signal.aborted && searches.get(searchId) === controller) emit('searchHit', { searchId, sourceId: def.id, items, error, skipped, ms: Date.now() - started });
        }));
        if (searches.get(searchId) === controller) { searches.delete(searchId); if (!controller.signal.aborted) emit('searchDone', { searchId }); }
      })().catch(() => { if (searches.get(searchId) === controller) { searches.delete(searchId); if (!controller.signal.aborted) emit('searchDone', { searchId }); } });
      return { searchId };
    },
    async cancelSearch({ searchId }) { searches.get(searchId)?.abort(); searches.delete(searchId); },
    async details({ anime }) { return { anime }; },
    async episodes({ anime }) { const r = await getRuntime(); await r.ready; await r.addons.ready; return { episodes: r.addons.sources.source(anime.sourceId) ? await sourceCall(r, anime.sourceId, source => source.episodes(anime)) : [] }; },
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
    async playerState({session}) {
      const s=sessionOf(session);
      return {title:s.playArgs?.title??'VANTARA',candidate:s.playArgs?.candidate,position:s.progress.position??0,
        sources:choices(s).map(c=>({id:c.id,label:[c.sourceName,c.server,c.quality?`${c.quality}p`:null,c.label].filter(Boolean).join(' · ')})),together:!!s.together,videoOffsetMs:s.together?.getVideoOffset()??0};
    },
    async playerCommand({session,command,value}) {
      const s=sessionOf(session);
      if(command==='pause'&&s.together?.playPause(!value))return;
      if(command==='seek'&&s.together?.seek(value))return;
      return bridge.playbackCommand({session,command,value});
    },
    async switchSource({session,candidate,position}){const s=sessionOf(session);return engine.play({...s.playArgs,candidate,position:position??s.progress.position??0});},
    openPlayerRoom({session}){sessionOf(session).playArgs?.together?.hub?.openPanel?.();},
    setVideoOffset({session,ms}) {
      const s=sessionOf(session);
      if(!s.together)throw new Error('توقيت الفيديو متاح فقط أثناء المشاهدة مع الأصدقاء');
      if(!s.together.setVideoOffset(ms))throw new Error('قيمة توقيت الفيديو غير صالحة');
      return {videoOffsetMs:s.together.getVideoOffset()};
    },
    async play(args) {
      const s = sessionOf(args.session), c = s.candidates.get(args.candidate);
      if (!c || s.routes.get(c.route)?.state !== 'READY') throw new Error('المرشح غير متاح؛ اختر السيرفر من جديد');
      s.playArgs={...args};
      s.subtitleController?.abort(); s.subtitleController = new AbortController();
      const generation = s.playGeneration = (s.playGeneration ?? 0) + 1;
      s.context = { animeId: args.animeId, episode: args.episode ?? s.episode, code: c.code };
      s.ignorePreviousClose = s.playing;
      s.playing = true;s.nativeReady=false;s.resumeAfterDetach=false;
      try {
        s.together?.close();s.together=null;
        if(args.together?.session?.room){
          let coordinator;
          coordinator=createDesktopTogetherPlayer({together:args.together,bridge,session:s.id,episode:()=>s.context.episode??s.episode,source:()=>c.sourceName,
            onLobby:lobby=>emit('desktopTogether',{session:s.id,...lobby}),message:message=>emit('desktopNotice',{session:s.id,message}),
            onDetach:()=>{
              if(s.together!==coordinator)return;
              if(!s.nativeReady||!args.together.session.room.timeline?.started){s.resumeAfterDetach=true;if(s.nativeReady){s.resumeAfterDetach=false;void bridge.playbackCommand({session:s.id,command:'pause',value:false}).catch(()=>{});}}
              s.transitionGeneration=(s.transitionGeneration??0)+1;s.prepareGeneration=(s.prepareGeneration??0)+1;
              s.controller.abort();s.controller=new AbortController();s.running=0;s.done=true;s.together=null;
              emit('desktopTogether',{session:s.id,closed:true});
            },
            onEpisode:async n=>{
              const transition=s.transitionGeneration=(s.transitionGeneration??0)+1;
              const owned=()=>current(s)&&s.together===coordinator&&s.transitionGeneration===transition;
              s.episodeCopies??=[...s.copies.values()];
              const copies=s.episodeCopies.map(copy=>({...copy,episode:n,identity:copy.identity?{...copy.identity,episode:n}:copy.identity}));
              s.prepareGeneration=(s.prepareGeneration??0)+1;s.controller.abort();s.controller=new AbortController();s.running=0;
              try{
                s.subtitleController?.abort();s.ignorePreviousClose=true;await bridge.stopPlayback({session:s.id});if(!owned())return;
                s.episode=n;s.copies.clear();s.routes.clear();s.candidates.clear();s.done=false;await startCopies(s,copies);
                if(!owned())return;const next=choices(s).find(next=>next.sourceId===c.sourceId)??choices(s)[0];
                if(!next)throw new Error('لا يوجد مصدر للحلقة الجديدة؛ اختر مصدرًا من التطبيق');
                await engine.play({...args,candidate:next.id,episode:n,position:0,subtitleIdentity:args.subtitleIdentity?{...args.subtitleIdentity,episode:n}:null});
              }catch(error){if(owned()){coordinator.failed();emit('desktopNotice',{session:s.id,message:error.message});}}
            }});
          s.together=coordinator;
        }
        const synced=args.together?.session?.room&&(args.together.session.room.info?.mode??args.together.session.mode)==='sync';
        const out = await bridge.startPlayback({ session: s.id, candidate: c, title: args.title ?? 'VANTARA', position: args.position ?? 0,...(synced?{pause:true}:{}) });
        if (!out?.started) throw new Error('لم يبدأ المشغل');
        if (!current(s) || generation !== s.playGeneration) throw new Error('انتهى تشغيل الجلسة');
        s.ignorePreviousClose = false;
        void startSubtitles(s, c, args.subtitleIdentity, generation);
        return out;
      } catch (error) {
        if (current(s) && generation === s.playGeneration) { emit('playerError', { session: s.id, message: error.message ?? 'تعذر تشغيل الفيديو' }); await finish(s, { stop: true }); }
        throw error;
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
