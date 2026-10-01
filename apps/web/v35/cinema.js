/** Film-first Cinema UI; shared native preparation, independent identity and history. */
import * as engine from '../lib/cinema-engine.js';
import * as metadata from '../lib/cinema-meta.js';
import { readCinema, toggleSaved, recordCinema, readProgress } from '../lib/cinema-library.js';
import { flushFollowTime } from '../lib/follow-time.js';
import { glyph } from './icons.js';

export function createCinema(deps) {
  const { q, el, toast } = deps;
  const owner = () => deps.sync?.user?.userId ?? null;
  const active = () => deps.root.dataset.section === 'cinema';
  const state = { home: null, homeFlight: null, homeGeneration: 0, detail: null, detailGeneration: 0, seasonGeneration: 0, browseGeneration: 0, browse: { type: 'movie', query: '', source: 'cinema-tuktuk', page: 1, items: [], hasNext: false }, playing: null };
  const subscriptions = [];
  let cancelPreparation = null;
  const button = (text, run, cls = 'ci-btn') => {
    const b = el('button', cls, text); b.type = 'button'; b.onclick = run; return b;
  };
  const iconButton = (icon, label, run) => {
    const b = button('', run, 'ci-icon'); b.innerHTML = glyph(icon); b.setAttribute('aria-label', label); return b;
  };
  const image = (url, cls = '', eager = false) => {
    const wrap = el('span', `ci-art ${cls}`);
    if (!url || !/^https?:\/\//i.test(url)) { wrap.classList.add('ci-art--empty'); return wrap; }
    const img = el('img'); img.alt = ''; img.loading = eager ? 'eager' : 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer'; img.src = metadata.artworkURL(url);
    img.onerror = () => { img.remove(); wrap.classList.add('ci-art--empty'); };
    wrap.append(img); return wrap;
  };
  const text = (tag, cls, value) => { const n = el(tag, cls, value); n.dir = 'auto'; return n; };
  const status = (host, message, retry) => {
    const block = el('div', 'ci-status'); block.setAttribute('role', 'status'); block.append(el('p', null, message));
    if (retry) block.append(button('أعد المحاولة', retry, 'ci-btn ci-btn--soft'));
    host.replaceChildren(block);
  };
  const facts = (work) => [work.type === 'movie' ? 'فيلم' : 'مسلسل', work.year, work.runtime, work.rating && `★ ${work.rating}`].filter(Boolean).join(' · ');
  const entry = (work) => readCinema(owner())[work.id];
  const sourceLabel = (id) => id === 'cinema-egydead' ? 'EgyDead' : 'TukTuk';
  const dedupe = (items) => {
    const found = new Map();
    for (const item of items) {
      const key = `${item.type}:${metadata.foldTitle(item.title)}:${item.year ?? item.id}`;
      if (!found.has(key)) found.set(key, item);
    }
    return [...found.values()];
  };
  const sectionHead = (title, sub, action) => {
    const row = el('div', 'ci-section-head'), copy = el('div'); copy.append(el('h2', null, title));
    if (sub) copy.append(el('p', null, sub));
    row.append(copy); if (action) row.append(button('عرض الكل', action, 'ci-link')); return row;
  };
  function poster(work) {
    const b = button('', () => void openWork(work), 'ci-poster');
    b.append(image(work.poster, 'ci-poster-art'), text('b', 'ci-poster-title', work.title), el('span', 'ci-poster-meta', facts(work)));
    b.setAttribute('aria-label', `${work.title}، ${facts(work)}`);
    return b;
  }
  function rail(title, items, action, sub) {
    const section = el('section', 'ci-section'); section.append(sectionHead(title, sub, action));
    const strip = el('div', 'ci-poster-rail'); strip.append(...items.slice(0, 20).map(poster)); section.append(strip); return section;
  }
  async function sourcePage(type, source = 'cinema-tuktuk', page = 1, query = '') {
    if (!engine.available()) return { items: await metadata.catalog(type, { query, skip: (page - 1) * 100 }), hasNext: false };
    const result = await engine.page(source, query ? 'search' : type === 'series' ? 'series' : 'popular', page, query);
    return { items: dedupe((result?.items ?? []).map(metadata.normalizeSource).filter((x) => x.type === type)), hasNext: Boolean(result?.hasNext) };
  }
  function continueSection() {
    const entries = Object.values(readCinema(owner())).filter((x) => x.work && x.latest && x.progress?.[x.latest]?.position > 0).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 10);
    if (!entries.length) return null;
    const section = el('section', 'ci-section'); section.append(sectionHead('المشهد لم ينتهِ', 'كمل من حيث توقفت'));
    const strip = el('div', 'ci-tickets');
    for (const saved of entries) {
      const p = saved.progress[saved.latest];
      const b = button('', () => void openWork(saved.work, { resume: p }), 'ci-ticket');
      const copy = el('span', 'ci-ticket-copy'); copy.append(text('b', null, saved.work.title), el('small', null, saved.work.type === 'movie' ? 'تابع الفيلم' : `الموسم ${p.season} · الحلقة ${p.episode}`));
      const track = el('span', 'ci-progress'); const fill = el('i'); fill.style.width = `${Math.min(100, p.position / p.duration * 100)}%`; track.append(fill);
      copy.append(track, el('small', null, `${engine.clock(p.position)} / ${engine.clock(p.duration)}`)); b.append(image(saved.work.poster, 'ci-ticket-art'), copy); strip.append(b);
    }
    section.append(strip); return section;
  }
  function renderHome() {
    const host = q('cinemaHome'); if (!host) return;
    if (!state.home) return status(host, 'نجهّز لك ليلة سينما…');
    const { movies, series, failures } = state.home;
    const wrap = el('main', 'ci-home');
    const first = movies[0] ?? series[0];
    if (first) {
      const hero = el('section', 'ci-tonight'); hero.append(image(first.banner ?? first.poster, 'ci-tonight-art', true));
      const copy = el('div', 'ci-tonight-copy'); copy.append(el('span', 'ci-eyebrow', 'VANTARA  /  اختيار الليلة'), text('h1', null, first.title), el('p', 'ci-facts', facts(first)));
      const actions = el('div', 'ci-actions'); const watch = button('ابدأ المشاهدة', () => void openWork(first), 'ci-btn ci-btn--primary'); watch.insertAdjacentHTML('afterbegin', glyph('play')); actions.append(watch, iconButton('plus', 'أضف إلى قائمتي', () => { const on = toggleSaved(owner(), first); toast(on ? 'أضيف إلى قائمتك' : 'أزيل من قائمتك'); }));
      copy.append(actions); hero.append(copy); wrap.append(hero);
    }
    const intro = el('div', 'ci-intro'); intro.append(el('span', 'ci-eyebrow', 'لكل ليلة حكاية'), el('h2', null, 'وش ودك تشوف اليوم؟'));
    const choices = el('div', 'ci-choices');
    for (const [type, title, sub, mark] of [['movie', 'فيلم الليلة', 'حكاية في جلسة واحدة', '01'], ['series', 'مسلسل جديد', 'عالم ترجع له كل يوم', '02']]) {
      const b = button('', () => openDiscover({ type }), `ci-choice ci-choice--${type}`); b.append(el('small', 'ci-eyebrow', mark), el('b', null, title), el('span', null, sub), el('i', null, '←')); choices.append(b);
    }
    intro.append(choices); wrap.append(intro);
    const history = continueSection(); if (history) wrap.append(history);
    if (movies.length) wrap.append(rail('على شاشة الليلة', movies, () => openDiscover({ type: 'movie' }), 'أفلام من مصادر المشاهدة'));
    if (series.length) wrap.append(rail('حلقة… ثم حلقة', series, () => openDiscover({ type: 'series' }), 'مسلسلات تستحق وقتك'));
    if (failures.length) { const note = el('div', 'ci-status'); note.append(el('p', null, 'بعض قوائم المصادر لم تستجب الآن.'), button('تحديث القوائم', () => void loadHome(true), 'ci-link')); wrap.append(note); }
    if (!first) wrap.append(button('ابحث عن فيلم أو مسلسل', () => openDiscover(), 'ci-btn ci-btn--primary'));
    if (!engine.available()) wrap.append(el('p', 'ci-footnote', 'الدليل متاح هنا. تشغيل الفيديو داخل تطبيق VANTARA على أندرويد.'));
    host.replaceChildren(wrap);
  }
  async function loadHome(force = false) {
    if (state.homeFlight && !force) return state.homeFlight;
    if (state.home && !force) return renderHome();
    const generation = ++state.homeGeneration;
    status(q('cinemaHome'), 'نجهّز لك ليلة سينما…');
    const job = (async () => {
      const results = await Promise.allSettled([sourcePage('movie'), sourcePage('series')]);
      if (generation !== state.homeGeneration) return;
      state.home = { movies: results[0].status === 'fulfilled' ? results[0].value.items : [], series: results[1].status === 'fulfilled' ? results[1].value.items : [], failures: results.filter((r) => r.status === 'rejected') };
      if (!state.home.movies.length && !state.home.series.length) status(q('cinemaHome'), 'تعذّر تحميل قائمة المشاهدة الآن.', () => void loadHome(true));
      else {
        renderHome();
        const chosen = state.home.movies[0] ?? state.home.series[0];
        if (chosen?.native) void metadata.enrich(chosen).then((enriched) => {
          if (generation !== state.homeGeneration || !enriched.banner) return;
          const list = chosen.type === 'movie' ? state.home.movies : state.home.series;
          const index = list.findIndex((item) => item.id === chosen.id);
          if (index >= 0) list[index] = enriched;
          if (active() && deps.currentPage() === 'home') renderHome();
        }).catch(() => {});
      }
    })().finally(() => { if (state.homeFlight === job) state.homeFlight = null; });
    state.homeFlight = job; return job;
  }
  async function openWork(initial, { resume } = {}) {
    const generation = ++state.detailGeneration;
    ++state.seasonGeneration;
    deps.showPage('cinema');
    const host = q('cinema'); status(host, 'نرتّب تفاصيل الحكاية…');
    state.detail = null;
    try {
      let work = initial;
      if (initial.native && initial.copies?.length) {
        const source = await engine.details(initial.copies[0]);
        work = { ...metadata.normalizeSource(source), banner: initial.banner, imdbId: initial.imdbId };
      } else {
        work = (await metadata.detail(initial.type, initial.id)) ?? initial;
      }
      if (generation !== state.detailGeneration) return;
      state.detail = { work, source: work.copies?.[0] ?? null, seasons: [], season: 1, episodes: [], pending: true, resume };
      renderDetail();
      if (!work.native) {
        state.detail.pending = false; renderDetail(); return;
      }
      const seasons = work.type === 'series' ? await engine.seasons(work.copies[0]) : [];
      if (generation !== state.detailGeneration) return;
      state.detail.seasons = seasons.filter((s) => s.seasonNumber > 0).sort((a, b) => a.seasonNumber - b.seasonNumber);
      const wanted = resume?.season ?? entry(work)?.progress?.[entry(work)?.latest]?.season;
      const selected = state.detail.seasons.find((s) => s.seasonNumber === wanted) ?? state.detail.seasons[0] ?? work.copies[0];
      await selectSeason(selected, generation);
      // Enrichment cannot block native source selection or alter identity.
      void metadata.enrich(work).then((enriched) => {
        if (generation !== state.detailGeneration || state.detail?.work.id !== work.id) return;
        state.detail.work = enriched; renderDetail();
      }).catch(() => {});
    } catch (error) {
      if (generation === state.detailGeneration) status(host, `تعذّر فتح العمل: ${error?.message ?? error}`, () => void openWork(initial, { resume }));
    }
  }
  async function selectSeason(source, detailGeneration = state.detailGeneration) {
    const generation = ++state.seasonGeneration;
    const detail = state.detail;
    if (!detail) return;
    detail.pending = true; detail.error = null; detail.source = source; detail.season = source.seasonNumber > 0 ? source.seasonNumber : 1; detail.episodes = []; renderDetail();
    try {
      const eps = await engine.episodes(source);
      if (generation !== state.seasonGeneration || detailGeneration !== state.detailGeneration) return;
      detail.episodes = eps.filter((e) => Number.isFinite(e.number) && e.number > 0).sort((a, b) => a.number - b.number);
      detail.pending = false;
      if (!detail.episodes.length) detail.error = 'لا توجد حلقات مشاهدة لهذا الاختيار الآن.';
      renderDetail();
    } catch (error) {
      if (generation !== state.seasonGeneration || detailGeneration !== state.detailGeneration) return;
      detail.pending = false; detail.error = `تعذّر جمع الحلقات: ${error?.message ?? error}`; renderDetail();
    }
  }
  function renderDetail() {
    const detail = state.detail; if (!detail) return;
    const { work } = detail;
    const host = q('cinema'), wrap = el('main', 'ci-detail');
    const top = el('div', 'ci-detail-top'); top.append(iconButton('back', 'رجوع', () => deps.goBack()), el('span', 'ci-eyebrow', 'VANTARA CINEMA'), iconButton('heart', 'احفظ في قائمتي', () => { toggleSaved(owner(), work); renderDetail(); }));
    top.lastChild.setAttribute('aria-pressed', String(Boolean(entry(work)?.saved)));
    const art = el('div', 'ci-detail-art'); art.append(image(work.banner ?? work.poster, 'ci-detail-backdrop', true), image(work.poster, 'ci-detail-poster', true));
    const copy = el('div', 'ci-detail-copy'); copy.append(el('span', 'ci-eyebrow', work.type === 'movie' ? 'ليلة، فيلم، حكاية' : 'حكاية على امتداد الحلقات'), text('h1', null, work.title), el('p', 'ci-facts', facts(work)));
    const saved = entry(work), latest = detail.resume ?? saved?.progress?.[saved.latest];
    const first = detail.episodes.find((e) => e.number === latest?.episode && detail.season === latest?.season) ?? detail.episodes[0];
    const watch = button(detail.pending ? 'نجهّز الحلقات…' : work.type === 'movie' ? latest?.position > 5000 ? 'تابع الفيلم' : 'شاهد الفيلم' : `شاهد الحلقة ${first?.number ?? '—'}`, () => first && play(detail, first), 'ci-btn ci-btn--primary ci-watch');
    watch.insertAdjacentHTML('afterbegin', glyph('play')); watch.disabled = detail.pending || !first || !work.native;
    copy.append(watch);
    if (work.description) copy.append(text('p', 'ci-synopsis', work.description));
    if (work.genres?.length) { const tags = el('div', 'ci-tags'); for (const genre of work.genres.slice(0, 5)) tags.append(text('span', null, deps.genreAr?.(genre) ?? genre)); copy.append(tags); }
    if (!work.native) {
      const hint = el('div', 'ci-status'); hint.append(el('p', null, engine.available() ? 'هذا العمل من الدليل. ابحث عنه في مصادر المشاهدة لاختيار النسخة المطابقة.' : 'افتح نسخة أندرويد للمشاهدة.'), button('ابحث في مصادر المشاهدة', () => openDiscover({ query: work.title, type: work.type }), 'ci-btn ci-btn--soft')); copy.append(hint);
    }
    wrap.append(top, art, copy);
    if (work.native && work.type === 'series') {
      const section = el('section', 'ci-section ci-episodes'); section.append(sectionHead('الحلقات', `الموسم ${detail.season}`));
      if (detail.seasons.length) {
        const select = el('select', 'ci-season'); select.setAttribute('aria-label', 'الموسم');
        for (const [i, season] of detail.seasons.entries()) { const option = el('option', null, `الموسم ${season.seasonNumber}`); option.value = String(i); option.selected = season.url === detail.source.url; select.append(option); }
        select.onchange = () => void selectSeason(detail.seasons[Number(select.value)]); section.append(select);
      }
      if (detail.pending) section.append(el('p', 'ci-muted', 'نجمع حلقات هذا الموسم…'));
      const list = el('div', 'ci-episode-list');
      for (const episode of detail.episodes) {
        const row = button('', () => play(detail, episode), 'ci-episode'); const p = readProgress(owner(), work, detail.season, episode.number);
        const episodeMeta = work.videos?.find((v) => v.season === detail.season && v.episode === episode.number);
        const info = el('span', 'ci-episode-copy'); info.append(el('small', 'ci-eyebrow', `الحلقة ${episode.number}`), text('b', null, episodeMeta?.title ?? episode.name), el('small', null, p?.position > 0 ? `تابع من ${engine.clock(p.position)}` : 'ابدأ المشاهدة'));
        row.append(image(episode.preview ?? episodeMeta?.thumbnail ?? work.banner ?? work.poster, 'ci-episode-art'), info, el('span', 'ci-episode-play', '▶')); list.append(row);
      }
      section.append(list); wrap.append(section);
    }
    if (detail.error) { const error = el('div', 'ci-status'); error.append(el('p', null, detail.error), button('أعد المحاولة', () => void selectSeason(detail.source), 'ci-link')); wrap.append(error); }
    wrap.append(el('p', 'ci-footnote', work.native ? `مصدر المشاهدة: ${sourceLabel(detail.source.sourceId)}${work.imdbId ? ' · معلومات Cinemeta' : ''}` : 'معلومات Cinemeta'));
    host.replaceChildren(wrap);
  }
  function play(detail, episode) {
    if (!engine.available()) return toast('المشاهدة داخل تطبيق أندرويد');
    const launchOwner = owner(), work = detail.work, season = detail.season, copies = [detail.source];
    const progress = readProgress(launchOwner, work, season, episode.number);
    const view = { session: null, closed: false, launched: false, routes: [], done: false, busy: false, generation: 0, retryAt: 0 };
    deps.openSheet((body) => {
      body.classList.add('ci-player-sheet');
      const head = el('div', 'ci-sheet-top'); head.append(iconButton('back', 'إلغاء المشاهدة', () => deps.closeSheet()), el('span', 'ci-eyebrow', 'غرفة العرض'));
      const title = text('h2', null, work.title), caption = el('p', 'ci-facts', work.type === 'movie' ? 'فيلم' : `الموسم ${season} · الحلقة ${episode.number}`);
      const message = el('p', 'ci-preparation', 'نجهّز السيرفرات، يبدأ العرض عند جاهزية الأفضل…'); message.setAttribute('role', 'status');
      const best = button('تجهيز الأفضل…', () => void selectBest(), 'ci-btn ci-btn--primary'); best.disabled = true;
      const list = el('div', 'ci-routes'); const routeNodes = new Map();
      body.append(head, title, caption, best, message, list, el('p', 'ci-footnote', 'تقدر تختار سيرفرًا جاهزًا، أو تنتظر التشغيل التلقائي.'));
      const paint = () => {
        if (view.closed) return;
        const ready = view.routes.filter((r) => r.state === 'READY').length;
        const resolving = view.routes.filter((r) => r.state === 'RESOLVING').length;
        best.disabled = !view.session || view.busy;
        best.textContent = view.busy ? 'نفتح العرض…' : ready ? `شغّل الأفضل · ${ready} جاهز` : view.done ? 'أعد تجهيز السيرفرات' : 'بانتظار أول سيرفر…';
        message.textContent = ready ? `${ready} سيرفر جاهز${resolving ? ` · ${resolving} قيد التجهيز` : ''}` : view.done ? 'لم يجهز رابط مشاهدة الآن. جرّب إعادة التجهيز أو مصدرًا آخر.' : 'السيرفرات تظهر تباعًا؛ نتحقق من روابط الفيديو.';
        for (const route of view.routes) {
          let b = routeNodes.get(route.id);
          if (!b) { b = button('', () => {}, 'ci-route'); b.append(el('b'), el('span')); routeNodes.set(route.id, b); list.append(b); }
          b.dataset.state = route.state;
          b.firstChild.textContent = `${route.server || route.code}${route.quality ? ` · ${route.quality}p` : ''}`;
          b.lastChild.textContent = { READY: 'جاهز للمشاهدة', RESOLVING: 'نجهّزه…', FAILED: 'تعذّر التجهيز', UNAVAILABLE: 'غير متاح' }[route.state] ?? route.state;
          b.disabled = view.busy || route.state !== 'READY';
          b.onclick = () => void selectRoute(route);
        }
      };
      const launch = async (candidate, code, operation) => {
        if (view.closed || operation !== view.generation || owner() !== launchOwner) return;
        view.busy = true; paint();
        const resume = {};
        for (const p of Object.values(readCinema(launchOwner)[work.id]?.progress ?? {})) if (p.season === season && p.position > 5000) resume[p.episode] = p.position;
        state.playing = { work, owner: launchOwner, season, episode: episode.number, session: view.session };
        try {
          await engine.open({ session: view.session, candidate, prefer: code, title: work.title, content: 'cinema', mediaType: work.type, contentId: work.id, animeId: work.id, usageUserId: launchOwner, episode: episode.number, season, total: work.type === 'movie' ? 0 : Math.max(0, ...detail.episodes.map((e) => e.number)), position: progress?.position ?? 0, poster: work.poster, copies, resume });
          if (view.closed) return;
          view.launched = true; deps.closeSheet();
        } catch (error) {
          state.playing = null; view.busy = false; paint(); toast(`تعذّر فتح المشغّل: ${error?.message ?? error}`);
        }
      };
      async function selectRoute(route) {
        if (view.closed || view.busy) return;
        const operation = ++view.generation;
        try { const candidate = await engine.pick(view.session, route.id); if (candidate) await launch(candidate, route.code, operation); else toast('انتهى هذا الرابط؛ جرّب سيرفرًا آخر'); }
        catch (error) { if (!view.closed) toast(`تعذّر التشغيل: ${error?.message ?? error}`); }
      }
      async function selectBest() {
        if (view.closed || view.busy || !view.session) return;
        if (view.done && !view.routes.some((r) => r.state === 'READY')) {
          if (view.retryAt > Date.now()) return toast(`انتظر ${Math.ceil((view.retryAt - Date.now()) / 1000)} ثانية ثم جرّب`);
          deps.closeSheet(); play(detail, episode); return;
        }
        const operation = ++view.generation;
        try { const out = await engine.best(view.session); if (out?.candidate) await launch(out.candidate, out.code, operation); else if (!view.closed && operation === view.generation) { view.done = true; paint(); } }
        catch (error) { if (!view.closed && operation === view.generation) toast(`تعذّر تجهيز الأفضل: ${error?.message ?? error}`); }
      }
      const off = [engine.on('route', (event) => {
        if (view.closed || event.session !== view.session || !event.route) return;
        view.routes = engine.upsertRoute(view.routes, event.route); view.retryAt = Math.max(view.retryAt, event.retryAt ?? 0); paint();
      }), engine.on('prepared', (event) => { if (!view.closed && event.session === view.session) { view.done = true; view.retryAt = Math.max(view.retryAt, event.retryAt ?? 0); paint(); } })];
      void (async () => {
        try {
          const out = await engine.prepare({ copies, episode: episode.number });
          if (view.closed) { if (out?.session) await engine.closeSession(out.session); return; }
          view.session = out.session;
          const snapshot = await engine.routes(view.session);
          if (view.closed) return;
          view.routes = snapshot?.routes ?? out.routes ?? []; view.done = Boolean(snapshot?.done ?? out.done); view.retryAt = snapshot?.retryAt ?? out.retryAt ?? 0; paint();
          if (view.routes.some((r) => r.state === 'READY') || !view.done) void selectBest();
        } catch (error) { if (!view.closed) { view.done = true; message.textContent = `تعذّر التجهيز: ${error?.message ?? error}`; best.textContent = 'أعد المحاولة'; best.disabled = false; best.onclick = () => { deps.closeSheet(); play(detail, episode); }; } }
      })();
      const cleanup = () => {
        if (view.closed) return;
        view.closed = true; ++view.generation;
        for (const cancel of off) cancel();
        if (!view.launched && view.session) void engine.closeSession(view.session).catch(() => {});
        if (cancelPreparation === cleanup) cancelPreparation = null;
      };
      cancelPreparation = cleanup;
      return cleanup;
    }, { tone: 'cinema', full: true });
  }
  function renderDiscover() {
    const host = q('cinemaDiscover');
    const wrap = el('main', 'ci-discover'); wrap.append(el('span', 'ci-eyebrow', 'اتبع فضولك'), el('h2', null, 'الحكاية القادمة'));
    const form = el('form', 'ci-search'), input = el('input'); input.type = 'search'; input.placeholder = 'اسم فيلم أو مسلسل…'; input.setAttribute('aria-label', 'ابحث في السينما'); input.value = state.browse.query;
    const submit = button('بحث', () => {}, 'ci-btn ci-btn--soft'); submit.type = 'submit'; form.append(input, submit); form.onsubmit = (event) => { event.preventDefault(); state.browse.query = input.value.trim(); void loadDiscover(true); };
    const tools = el('div', 'ci-browse-tools'), tabs = el('div', 'ci-tabs');
    for (const [type, label] of [['movie', 'أفلام'], ['series', 'مسلسلات']]) { const b = button(label, () => { state.browse.type = type; renderDiscover(); void loadDiscover(true); }, 'ci-tab'); b.setAttribute('aria-pressed', String(state.browse.type === type)); tabs.append(b); }
    tools.append(tabs);
    if (engine.available()) { const source = el('select', 'ci-source'); source.setAttribute('aria-label', 'مصدر المشاهدة'); for (const [id, name] of [['cinema-tuktuk', 'TukTuk'], ['cinema-egydead', 'EgyDead']]) { const option = el('option', null, name); option.value = id; option.selected = id === state.browse.source; source.append(option); } source.onchange = () => { state.browse.source = source.value; void loadDiscover(true); }; tools.append(source); }
    const grid = el('div', 'ci-grid'); grid.id = 'cinemaBrowseGrid';
    const more = button('المزيد من الحكايات', () => void loadDiscover(false), 'ci-btn ci-btn--soft ci-load-more'); more.id = 'cinemaMore'; more.hidden = true;
    wrap.append(form, tools, grid, more); host.replaceChildren(wrap); paintDiscover();
  }
  function paintDiscover() {
    const grid = q('cinemaBrowseGrid'); if (!grid) return;
    grid.replaceChildren(...state.browse.items.map(poster));
    if (!state.browse.items.length && !state.browse.loading) status(grid, 'ما لقينا أعمالًا هنا. جرّب الاسم الإنجليزي أو مصدرًا آخر.');
    const more = q('cinemaMore'); more.hidden = !state.browse.hasNext; more.disabled = Boolean(state.browse.loading);
  }
  async function loadDiscover(reset = true) {
    const generation = ++state.browseGeneration;
    if (reset) { state.browse.page = 1; state.browse.items = []; }
    state.browse.loading = true;
    const grid = q('cinemaBrowseGrid'); if (reset && grid) status(grid, 'نبحث عن الحكايات…');
    const more = q('cinemaMore'); if (more) more.disabled = true;
    const { type, source, query, page } = state.browse;
    try {
      const result = await sourcePage(type, source, page, query);
      if (generation !== state.browseGeneration) return;
      state.browse.items = dedupe([...state.browse.items, ...result.items]); state.browse.hasNext = result.hasNext; state.browse.page++; state.browse.loading = false; paintDiscover();
    } catch (error) {
      if (generation !== state.browseGeneration) return;
      state.browse.loading = false;
      if (reset && grid) status(grid, `تعذّر البحث: ${error?.message ?? error}`, () => void loadDiscover(true));
      else { toast('تعذّر تحميل المزيد؛ أعد المحاولة'); paintDiscover(); }
    }
  }
  function openDiscover({ type = state.browse.type, query = '' } = {}) {
    state.browse = { ...state.browse, type, query, page: 1, items: [], hasNext: false };
    deps.showPage('discover'); renderDiscover(); void loadDiscover(true);
  }
  function showDiscover() { renderDiscover(); if (!state.browse.items.length && !state.browse.loading) void loadDiscover(true); }
  function renderLibrary() {
    const host = q('cinemaLibrary'), wrap = el('main', 'ci-library'); wrap.append(el('span', 'ci-eyebrow', 'حكاياتك، في مكان واحد'), el('h2', null, 'قائمتي السينمائية'));
    const history = continueSection(); if (history) wrap.append(history);
    const saved = Object.values(readCinema(owner())).filter((x) => x.saved && x.work).map((x) => x.work);
    const grid = el('div', 'ci-grid'); grid.append(...saved.map(poster)); wrap.append(sectionHead('شاهد لاحقًا', `${saved.length} عمل`), grid);
    if (!saved.length) { const note = el('div', 'ci-status'); note.append(el('p', null, 'احفظ الأفلام والمسلسلات التي تستحق ليلة خاصة.'), button('اكتشف حكاية', () => openDiscover(), 'ci-btn ci-btn--primary')); wrap.append(note); }
    wrap.append(el('p', 'ci-footnote', 'قائمة السينما والتقدم محفوظان على هذا الجهاز لكل حساب.')); host.replaceChildren(wrap);
  }
  subscriptions.push(engine.on('playback', (event) => {
    const playing = state.playing;
    if (event.content !== 'cinema' || !playing || playing.owner !== owner() || String(event.contentId ?? event.animeId) !== playing.work.id) return;
    const season = Number(event.season) || playing.season, episode = Number(event.episode) || playing.episode;
    recordCinema(playing.owner, playing.work, { season, episode, position: event.position, duration: event.duration, done: event.watchedRatio >= 0.9 });
    playing.episode = episode; playing.season = season;
    if (event.final) {
      state.playing = null; void flushFollowTime(deps.sync).catch(() => {});
      if (state.detail?.work.id === playing.work.id) renderDetail();
      if (active() && deps.currentPage() === 'library') renderLibrary();
      if (active() && deps.currentPage() === 'home') renderHome();
    }
  }), engine.on('episode', (event) => {
    if (event.content !== 'cinema' || !state.playing || state.playing.owner !== owner() || String(event.contentId ?? event.animeId) !== state.playing.work.id) return;
    state.playing.session = event.session; state.playing.episode = event.episode; state.playing.season = event.season ?? state.playing.season;
  }));
  let renderedOwner = owner();
  const stopAccount = deps.sync?.onChange?.(() => {
    if (owner() === renderedOwner) return;
    renderedOwner = owner(); cancelPreparation?.(); state.playing = null;
    if (!active()) return;
    if (deps.currentPage() === 'library') renderLibrary();
    if (deps.currentPage() === 'home' && state.home) renderHome();
    if (deps.currentPage() === 'cinema' && state.detail) renderDetail();
  });
  if (typeof stopAccount === 'function') subscriptions.push(stopAccount);
  return { show: () => { if (state.home) renderHome(); else void loadHome(); }, showDiscover, openDiscover, openSearch: () => { openDiscover(); setTimeout(() => q('cinemaDiscover')?.querySelector('input')?.focus(), 60); }, renderLibrary, leaveDetail: () => { ++state.detailGeneration; ++state.seasonGeneration; }, destroy: () => { cancelPreparation?.(); state.playing = null; ++state.homeGeneration; ++state.browseGeneration; ++state.detailGeneration; ++state.seasonGeneration; for (const off of subscriptions) off(); } };
}
