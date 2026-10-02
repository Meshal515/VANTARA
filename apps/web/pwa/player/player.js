/**
 * مشغّل الويب (بديل المشغّل الأصلي في الـAPK).
 *
 *   - Safari/iPhone/iPad: HLS أصلي في `<video>` (أخف وأثبت).
 *   - Chrome/Edge/Firefox: hls.js (يُحمَّل عند أول حاجة فقط).
 *   - MP4: `<video>` مباشرة.
 *
 * كل مرشّح يُجرَّب مباشرةً أولًا (بلا Referer)، فإن رفضه المضيف أو لم يبدأ خلال
 * 15 ثانية يُجرَّب عبر جالب الويب بمرجعه الصحيح، وإن فشل يُنتقل للمرشّح التالي
 * تلقائيًا. التقدّم يُبلَّغ كما يبلّغ المشغّل الأصلي (`playback`، `server`،
 * `episode`) فيُحفظ سجل المشاهدة والاستئناف بنفس كود الواجهة.
 */

const START_TIMEOUT_MS = 15_000;
const REPORT_EVERY_MS = 5_000;

let active = null;

function loadCss() {
  if (document.querySelector('link[data-pwa-player]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/pwa/player/player.css';
  link.dataset.pwaPlayer = '';
  document.head.append(link);
}

let hlsPromise = null;
function loadHls() {
  hlsPromise ??= new Promise((resolve, reject) => {
    if (globalThis.Hls) return resolve(globalThis.Hls);
    const s = document.createElement('script');
    s.src = '/vendor/hls.light.min.js';
    s.onload = () => resolve(globalThis.Hls);
    s.onerror = () => {
      hlsPromise = null;
      reject(new Error('تعذّر تحميل مشغّل HLS'));
    };
    document.head.append(s);
  });
  return hlsPromise;
}

const nativeHls = (video) => Boolean(video.canPlayType('application/vnd.apple.mpegurl'));

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const fmt = (q) => (q ? `${q >= 1000 ? 1080 : q >= 700 ? 720 : q >= 460 ? 480 : 360}p` : '');

/**
 * @param {object} args نفس معاملات `play` في الإضافة الأصلية + { runtime, engine, sessionOf, readyCandidates, emit }
 */
export function openPlayer(args) {
  active?.close(false);
  loadCss();
  const { runtime, engine, sessionOf, readyCandidates, emit } = args;
  const state = {
    session: args.session,
    episode: Number(args.episode) || 1,
    total: Number(args.total) || 0,
    tried: new Set(),
    current: null,
    hls: null,
    lastReport: 0,
    closed: false,
    startTimer: null,
  };

  // لا Referer لمضيفات الفيديو: كثير منها يرفض مرجعًا غريبًا ويقبل الغياب
  const meta = document.createElement('meta');
  meta.name = 'referrer';
  meta.content = 'no-referrer';
  document.head.append(meta);

  const root = el('div', 'pwa-player');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', args.title || 'المشغّل');
  const video = el('video', 'pwa-player__video');
  video.controls = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.preload = 'auto';
  if (args.poster) video.poster = args.poster;

  const top = el('div', 'pwa-player__top');
  const close = el('button', 'pwa-player__btn', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'إغلاق');
  const titles = el('div', 'pwa-player__titles');
  const title = el('strong', null, args.title || '');
  const sub = el('small', null, '');
  titles.append(title, sub);
  top.append(titles, close);

  const bar = el('div', 'pwa-player__bar');
  const serverBtn = el('button', 'pwa-player__chip', 'السيرفر');
  serverBtn.type = 'button';
  const nextBtn = el('button', 'pwa-player__chip', 'الحلقة التالية');
  nextBtn.type = 'button';
  bar.append(serverBtn, nextBtn);

  const status = el('div', 'pwa-player__status', 'جارٍ التشغيل…');
  const menu = el('div', 'pwa-player__menu');
  menu.hidden = true;
  root.append(video, top, bar, status, menu);
  document.body.append(root);
  document.documentElement.classList.add('pwa-playing');

  const paintSub = () => {
    const c = state.current;
    sub.textContent = [args.section === 'cinema' && state.total <= 1 ? null : `الحلقة ${state.episode}`, c ? `${c.code}${c.quality ? ` · ${fmt(c.quality)}` : ''}` : null].filter(Boolean).join(' · ');
    nextBtn.hidden = state.total > 0 && state.episode >= state.total;
  };

  function report(final = false) {
    const c = state.current;
    const duration = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0;
    emit('playback', {
      session: state.session,
      candidate: c?.id ?? null,
      sourceId: c?.sourceId ?? null,
      position: Math.round((video.currentTime || 0) * 1000),
      duration,
      final,
      animeId: args.animeId ?? null,
      episode: state.episode,
      code: c?.code ?? null,
      watchedRatio: null,
    });
  }

  function teardownSource() {
    clearTimeout(state.startTimer);
    state.hls?.destroy?.();
    state.hls = null;
    video.removeAttribute('src');
    video.load();
  }

  /** يشغّل رابطًا؛ يرجع وعدًا يُحسم بـtrue عند أول إطار، وfalse عند الفشل. */
  function attempt(url, type) {
    teardownSource();
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(state.startTimer);
        video.removeEventListener('playing', onPlay);
        video.removeEventListener('error', onError);
        resolve(ok);
      };
      const onPlay = () => done(true);
      const onError = () => done(false);
      video.addEventListener('playing', onPlay);
      video.addEventListener('error', onError);
      state.startTimer = setTimeout(() => done(false), START_TIMEOUT_MS);
      const go = () => video.play().catch(() => {
        // تشغيل تلقائي محجوب: الإطار يظهر حين يضغط الشخص تشغيل؛ نعدّه نجاحًا إن جهز
        if (video.readyState >= 2) done(true);
      });
      if (type === 'hls' && !nativeHls(video)) {
        loadHls()
          .then((Hls) => {
            if (settled) return;
            if (!Hls?.isSupported?.()) return done(false);
            const hls = new Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: 30 });
            state.hls = hls;
            hls.on(Hls.Events.ERROR, (_, data) => {
              if (data?.fatal) done(false);
            });
            hls.loadSource(url);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, go);
          })
          .catch(() => done(false));
      } else {
        video.src = url;
        go();
      }
    });
  }

  async function playCandidate(c, { seek = 0 } = {}) {
    state.current = c;
    state.tried.add(c.id);
    paintSub();
    status.hidden = false;
    status.textContent = `جارٍ التشغيل · ${c.code}`;
    await runtime.ensureMedia().catch(() => null);
    const proxied = runtime.fetcher.mediaUrl(c.url, c.referer);
    for (const url of [c.url, proxied]) {
      if (state.closed || state.current !== c) return false;
      if (await attempt(url, c.type)) {
        if (seek > 0 && Number.isFinite(video.duration) && seek < video.duration * 1000 - 5000) video.currentTime = seek / 1000;
        status.hidden = true;
        emit('server', { animeId: args.animeId ?? null, code: c.code, sourceId: c.sourceId, server: c.server, quality: c.quality ?? null });
        report();
        return true;
      }
    }
    return false;
  }

  /** المرشّح المختار ثم الباقي بالترتيب، حتى يعمل واحد. */
  async function playFrom(firstId, seek = 0) {
    const s = sessionOf(state.session);
    if (!s) {
      status.hidden = false;
      status.textContent = 'انتهت الجلسة، افتح الحلقة من جديد';
      return;
    }
    const pool = () => readyCandidates(s, args.prefer ?? null).filter((c) => !state.tried.has(c.id));
    const first = firstId ? s.cands.get(firstId) : null;
    if (first && (await playCandidate(first, { seek }))) return;
    for (;;) {
      if (state.closed) return;
      let next = pool()[0];
      if (!next && !s.done) {
        status.hidden = false;
        status.textContent = 'نجهّز سيرفرًا آخر…';
        const out = await engine.best({ session: state.session, prefer: args.prefer ?? null, waitMs: 30_000 }).catch(() => null);
        next = pool()[0] ?? (out?.candidate && !state.tried.has(out.candidate) ? s.cands.get(out.candidate) : null);
      }
      if (!next) {
        status.hidden = false;
        status.textContent = 'ما اشتغل أي سيرفر لهذي الحلقة. جرّب لاحقًا أو اختر سيرفرًا من القائمة.';
        return;
      }
      if (await playCandidate(next, { seek })) return;
    }
  }

  function showServers() {
    const s = sessionOf(state.session);
    menu.replaceChildren();
    const list = [...(s?.routes.values() ?? [])].filter((r) => r.state === 'READY');
    if (!list.length) menu.append(el('p', 'pwa-player__empty', 'لا سيرفرات جاهزة بعد'));
    for (const r of list) {
      const b = el('button', `pwa-player__item${state.current?.route === r.id ? ' is-on' : ''}`, `${r.code}${r.quality ? ` · ${fmt(r.quality)}` : ''}${r.variant === 'DUB' ? ' · مدبلج' : ''}`);
      b.type = 'button';
      b.onclick = () => {
        menu.hidden = true;
        const c = r.candidates.map((id) => s.cands.get(id)).find(Boolean);
        if (c) {
          state.tried.delete(c.id);
          void playFrom(c.id, Math.round((video.currentTime || 0) * 1000));
        }
      };
      menu.append(b);
    }
    menu.hidden = false;
  }

  async function nextEpisode() {
    const copies = args.copies ?? [];
    if (!copies.length) return;
    report();
    const nextN = state.episode + 1;
    status.hidden = false;
    status.textContent = `نجهّز الحلقة ${nextN}…`;
    teardownSource();
    void engine.closeSession({ session: state.session });
    const prep = await engine.prepare({ copies, episode: nextN, preferredSourceId: state.current?.sourceId ?? null, preferredServer: state.current?.server ?? null });
    state.session = prep.session;
    state.episode = nextN;
    state.tried.clear();
    state.current = null;
    paintSub();
    emit('episode', { animeId: args.animeId ?? null, session: state.session, episode: nextN });
    const best = await engine.best({ session: state.session, prefer: args.prefer ?? null, waitMs: 45_000 }).catch(() => null);
    await playFrom(best?.candidate ?? null);
  }

  function closePlayer(notify = true) {
    if (state.closed) return;
    if (notify) report(true);
    state.closed = true;
    teardownSource();
    root.remove();
    meta.remove();
    document.documentElement.classList.remove('pwa-playing');
    window.removeEventListener('keydown', onKey);
    void engine.closeSession({ session: state.session });
    if (active?.root === root) active = null;
  }

  const onKey = (e) => {
    if (e.key === 'Escape') closePlayer();
  };
  window.addEventListener('keydown', onKey);
  close.onclick = () => closePlayer();
  serverBtn.onclick = () => (menu.hidden ? showServers() : (menu.hidden = true));
  nextBtn.onclick = () => void nextEpisode();
  video.addEventListener('timeupdate', () => {
    const now = Date.now();
    if (now - state.lastReport >= REPORT_EVERY_MS) {
      state.lastReport = now;
      report();
    }
  });
  video.addEventListener('ended', () => {
    report();
    if (!nextBtn.hidden) void nextEpisode();
  });
  video.addEventListener('pause', () => report());

  active = { root, close: closePlayer };
  paintSub();
  void playFrom(args.candidate ?? null, Number(args.position) || 0);
  return active;
}
