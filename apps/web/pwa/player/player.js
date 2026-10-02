/**
 * مشغّل الويب (بديل المشغّل الأصلي في الـAPK) — بنفس تصميمه.
 *
 * التصميم نسخة من `PlayerActivity.kt`: تدرّج أعلى بالرجوع والعنوان والحلقة،
 * وتدرّج أسفل بالوقت وشريط التقدّم، ثم صف: [التالية، الحلقات، السيرفرات] ·
 * [−10، تشغيل دائري، +10] · [الجودة، السرعة، القفل]. الأوراق من الأسفل،
 * والسيرفرات مربعات رموز مجمّعة بالجودة، وألوان القسم (السينما بالأحمر).
 *
 * التشغيل:
 *   - Safari/iPhone/iPad: HLS أصلي. غيره: hls.js (عند أول حاجة)، وMP4 مباشرة.
 *   - كل مرشّح يُجرَّب مباشرةً ثم عبر جالب الويب بمرجعه، ثم المرشّح التالي.
 *   - «اشتغل» لا يكفي: مقطع أقصر من 45 ثانية (صورة «الفيديو غير متاح مؤقتًا»
 *     عند sendvid وأمثاله)، أو صوت بلا صورة (ترميز لا يفكّه المتصفح)، أو توقّف
 *     طويل بعد البداية — كلها فشل، وينتقل وحده للتالي من نفس اللحظة.
 *   - الأعلى جودة أولًا: hls.js يبدأ من أعلى مستوى (1080p) ثم يتكيّف.
 * التقدّم يُبلَّغ كما يبلّغ الأصلي (`playback`، `server`، `episode`).
 */

const START_TIMEOUT_MS = 15_000;
const REPORT_EVERY_MS = 5_000;
/** أقصر من هذا ليس حلقة ولا فيلمًا: صورة خطأ يبثّها المضيف بدل الفيديو. */
export const MIN_REAL_DURATION_S = 45;
/** توقّف بلا تقدّم وهو يُفترض أنه يعمل ⇒ هذا الطريق مات. */
const STALL_MS = 15_000;
const HIDE_AFTER_MS = 3_500;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

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

/** نفس دلاء الـAPK: 1080 / 720 / 480 / 360. */
export const bucket = (q) => (q ? (q >= 1000 ? 1080 : q >= 700 ? 720 : q >= 460 ? 480 : 360) : null);
const fmtQ = (q) => (bucket(q) ? `${bucket(q)}p` : '');
const badgeOf = (q) => (!q ? 'HD' : bucket(q) >= 1080 ? 'FHD' : bucket(q) >= 720 ? 'HD' : 'SD');

export function clock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/**
 * حكم على ما يعرضه الفيديو الآن: هل هو تشغيل حقيقي؟
 * @returns {null|'placeholder'|'no_picture'}
 */
export function judgePlayback({ duration, videoWidth, audioOnlyAllowed = false, minDuration = MIN_REAL_DURATION_S }) {
  if (Number.isFinite(duration) && duration > 0 && duration < minDuration) return 'placeholder';
  if (!audioOnlyAllowed && videoWidth === 0) return 'no_picture';
  return null;
}

// ───────────────────────── الأيقونات (نفس رسوم Glyph في Ui.kt) ─────────────────────────

const svg = (body, { fill = false } = {}) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  back: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  play: svg('<path d="M8 5.5 19 12 8 18.5Z"/>', { fill: true }),
  pause: svg('<rect x="6.5" y="5" width="3.5" height="14" rx="1.2"/><rect x="14" y="5" width="3.5" height="14" rx="1.2"/>', { fill: true }),
  rewind: svg('<path d="M12 3.5a8.5 8.5 0 1 1-7.4 4.3"/><path d="M8 2.2 7.1 5.2l3.1.7"/><text x="12" y="14.7" font-size="7.6" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui">10</text>'),
  forward: svg('<path d="M12 3.5a8.5 8.5 0 1 0 7.4 4.3"/><path d="m16 2.2.9 3-3.1.7"/><text x="12" y="14.7" font-size="7.6" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui">10</text>'),
  more: svg('<circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/>', { fill: true }),
  episodes: svg('<rect x="3" y="4" width="18" height="11" rx="2.5"/><path d="m10.5 7.5 4 2-4 2Z" fill="currentColor"/><path d="M5 19h14"/>'),
  servers: svg('<rect x="3.5" y="4" width="17" height="6.5" rx="2"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="2"/><path d="M12 7.25h5M12 16.75h5"/><circle cx="7.5" cy="7.25" r="1.1" fill="currentColor"/><circle cx="7.5" cy="16.75" r="1.1" fill="currentColor"/>'),
  speed: svg('<path d="M3 14a9 9 0 0 1 18 0"/><path d="m12 14 4.5-5M3 14v4M21 14v4"/><circle cx="12" cy="14" r="1.6" fill="currentColor"/>'),
  fit: svg('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><rect x="7.5" y="9" width="9" height="6" rx="1.5"/>'),
  fill: svg('<path d="M3 9V5h4M17 5h4v4M21 15v4h-4M7 19H3v-4"/>'),
  next: svg('<path d="M5 5.5 15 12 5 18.5Z"/><rect x="16.5" y="5.5" width="2.5" height="13" rx="1"/>', { fill: true }),
  lock: svg('<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M7.5 10.5V9a4.5 4.5 0 0 1 9 0v1.5"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor"/>'),
  unlock: svg('<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M7.5 9a4.5 4.5 0 0 1 8.7-1.6"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor"/>'),
  check: svg('<path d="m5 12.5 5 5L19 7"/>'),
  spark: svg('<path d="M12 3 14 10l7 2-7 2-2 7-2-7-7-2 7-2Z"/>', { fill: true }),
  pip: svg('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><rect x="12" y="11" width="7" height="5.5" rx="1.2" fill="currentColor"/>'),
  full: svg('<path d="M3 9V5h4M17 5h4v4M21 15v4h-4M7 19H3v-4"/>'),
};

function iconButton(name, label, onClick, cls = '') {
  const b = el('button', `pp-icon ${cls}`.trim());
  b.type = 'button';
  b.innerHTML = ICON[name];
  b.setAttribute('aria-label', label);
  b.title = label;
  b.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };
  return b;
}

/**
 * @param {object} args نفس معاملات `play` في الإضافة الأصلية + { runtime, engine, sessionOf, readyCandidates, emit }
 */
export function openPlayer(args) {
  active?.close(false);
  loadCss();
  const { runtime, engine, sessionOf, readyCandidates, emit } = args;
  // للاختبار فقط: مقطع تجربة قصير يُقبل
  const minDuration = Number(args.minRealDuration) || MIN_REAL_DURATION_S;
  const movie = args.section === 'cinema' && (Number(args.episode) < 0 || Number(args.total) <= 1);
  const state = {
    session: args.session,
    episode: Number(args.episode) || 1,
    total: Number(args.total) || 0,
    tried: new Set(),
    failed: new Map(),
    current: null,
    via: null,
    hls: null,
    lastReport: 0,
    closed: false,
    startTimer: null,
    started: false,
    locked: false,
    fill: false,
    speed: 1,
    level: -1,
    lastProgressAt: 0,
    lastTime: 0,
    healing: false,
  };

  // لا Referer لمضيفات الفيديو: كثير منها يرفض مرجعًا غريبًا ويقبل الغياب
  const meta = document.createElement('meta');
  meta.name = 'referrer';
  meta.content = 'no-referrer';
  document.head.append(meta);

  const root = el('div', 'pwa-player');
  root.dataset.tone = args.section === 'cinema' ? 'cinema' : 'anime';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', args.title || 'المشغّل');
  const video = el('video', 'pp-video');
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.preload = 'auto';
  if (args.poster) video.poster = args.poster;

  const gestures = el('div', 'pp-gestures');
  const seekLeft = el('div', 'pp-seek pp-seek--left');
  const seekRight = el('div', 'pp-seek pp-seek--right');
  const spinner = el('div', 'pp-spinner');
  spinner.innerHTML = '<i></i>';
  const pill = el('div', 'pp-pill');
  pill.hidden = true;

  // ── الأعلى ──
  const controls = el('div', 'pp-controls');
  controls.dir = 'ltr';
  const top = el('div', 'pp-top');
  const titles = el('div', 'pp-titles');
  titles.dir = 'auto';
  const titleEl = el('strong', null, args.title || '');
  const subEl = el('small', null, '');
  titles.append(titleEl, subEl);
  const fitBtn = iconButton('fill', 'ملء الشاشة', () => toggleFill());
  top.append(iconButton('back', 'رجوع', () => closePlayer()), titles, fitBtn, iconButton('more', 'المزيد', () => showMore()));

  // ── الأسفل ──
  const bottom = el('div', 'pp-bottom');
  const times = el('div', 'pp-times');
  const timeNow = el('span', null, '0:00');
  const timeTotal = el('span', null, '0:00');
  times.append(timeNow, timeTotal);
  const bar = el('div', 'pp-bar');
  bar.setAttribute('role', 'slider');
  bar.setAttribute('aria-label', 'التقدّم');
  bar.tabIndex = 0;
  const track = el('div', 'pp-track');
  const buffered = el('i', 'pp-buffered');
  const played = el('i', 'pp-played');
  const thumb = el('b', 'pp-thumb');
  track.append(buffered, played);
  bar.append(track, thumb);

  const row = el('div', 'pp-row');
  const left = el('div', 'pp-group');
  const nextBtn = iconButton('next', 'الحلقة التالية', () => void goEpisode(state.episode + 1));
  left.append(nextBtn, iconButton('episodes', 'الحلقات', () => showEpisodes()), iconButton('servers', 'السيرفرات', () => showServers()));
  const center = el('div', 'pp-group pp-center');
  const playBtn = el('button', 'pp-play');
  playBtn.type = 'button';
  playBtn.setAttribute('aria-label', 'تشغيل');
  playBtn.innerHTML = ICON.play;
  playBtn.onclick = (e) => {
    e.stopPropagation();
    togglePlay();
  };
  center.append(iconButton('rewind', 'رجوع 10 ثوانٍ', () => seekBy(-10), 'pp-icon--big'), playBtn, iconButton('forward', 'تقديم 10 ثوانٍ', () => seekBy(10), 'pp-icon--big'));
  const right = el('div', 'pp-group');
  const qualityBtn = el('button', 'pp-quality', 'HD');
  qualityBtn.type = 'button';
  qualityBtn.setAttribute('aria-label', 'الجودة');
  qualityBtn.onclick = (e) => {
    e.stopPropagation();
    showQuality();
  };
  right.append(qualityBtn, iconButton('speed', 'السرعة', () => showSpeed()), iconButton('lock', 'قفل الشاشة', () => setLocked(true)));
  row.append(left, center, right);
  bottom.append(times, bar, row);
  controls.append(el('div', 'pp-shade pp-shade--top'), el('div', 'pp-shade pp-shade--bottom'), top, bottom);

  const unlockBtn = iconButton('unlock', 'فتح القفل', () => setLocked(false), 'pp-unlock');
  unlockBtn.hidden = true;

  // ── الأوراق ──
  const sheetScrim = el('div', 'pp-scrim');
  sheetScrim.hidden = true;
  const sheet = el('div', 'pp-sheet');
  sheet.dir = 'rtl';
  sheet.hidden = true;
  sheetScrim.onclick = () => closeSheet();

  const errorCard = el('div', 'pp-error');
  errorCard.dir = 'rtl';
  errorCard.hidden = true;

  root.append(video, gestures, seekLeft, seekRight, spinner, controls, pill, unlockBtn, errorCard, sheetScrim, sheet);
  document.body.append(root);
  document.documentElement.classList.add('pwa-playing');
  // ملء الشاشة والوضع الأفقي كالـAPK، حيث يسمح المتصفح (لا في آيفون)
  try {
    if (root.requestFullscreen && !/iPhone|iPad|iPod/.test(navigator.userAgent)) {
      root.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
    }
  } catch {
    // لا ملء شاشة: المشغّل يغطي النافذة على أي حال
  }

  // ───────────────────────── الواجهة ─────────────────────────

  const isLast = () => movie || (state.total > 0 && state.episode >= state.total) || !(args.copies ?? []).length;
  function paint() {
    const c = state.current;
    subEl.textContent = [movie ? 'فيلم' : `الحلقة ${state.episode}`, c ? `${c.code}${c.quality ? ` · ${fmtQ(c.quality)}` : ''}` : null].filter(Boolean).join(' · ');
    nextBtn.hidden = isLast();
    qualityBtn.textContent = state.hls && state.level >= 0 ? fmtQ(state.hls.levels?.[state.level]?.height) || badgeOf(c?.quality) : badgeOf(c?.quality ?? currentHeight());
  }
  const currentHeight = () => (video.videoHeight > 0 ? video.videoHeight : null);

  function paintTime() {
    const d = Number.isFinite(video.duration) ? video.duration : 0;
    const t = video.currentTime || 0;
    timeNow.textContent = clock(t);
    timeTotal.textContent = clock(d);
    const p = d ? Math.min(1, t / d) : 0;
    played.style.width = `${p * 100}%`;
    thumb.style.left = `${p * 100}%`;
    let b = 0;
    for (let i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= t) b = Math.max(b, video.buffered.end(i));
    buffered.style.width = `${d ? Math.min(1, b / d) * 100 : 0}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  }

  let hideTimer = 0;
  function showControls(stay = false) {
    if (state.locked) {
      unlockBtn.hidden = false;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => (unlockBtn.hidden = true), HIDE_AFTER_MS);
      return;
    }
    root.classList.add('pp--shown');
    clearTimeout(hideTimer);
    if (!stay && !video.paused) hideTimer = setTimeout(() => root.classList.remove('pp--shown'), HIDE_AFTER_MS);
  }
  const hideControls = () => {
    clearTimeout(hideTimer);
    root.classList.remove('pp--shown');
  };

  let pillTimer = 0;
  function message(text, ms = 2200) {
    pill.textContent = text;
    pill.hidden = false;
    clearTimeout(pillTimer);
    pillTimer = setTimeout(() => (pill.hidden = true), ms);
  }

  function setBusy(on, text) {
    spinner.hidden = !on;
    if (on && text) message(text, 60_000);
    if (!on) pill.hidden = true;
  }

  function togglePlay() {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
    showControls();
  }
  let seekAccum = 0;
  let seekTimer = 0;
  function seekBy(sec) {
    if (!Number.isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration - 0.5, video.currentTime + sec));
    seekAccum += sec;
    const badge = sec < 0 ? seekLeft : seekRight;
    (sec < 0 ? seekRight : seekLeft).classList.remove('pp-seek--on');
    badge.textContent = `${seekAccum > 0 ? '+' : ''}${seekAccum} ث`;
    badge.classList.add('pp-seek--on');
    clearTimeout(seekTimer);
    seekTimer = setTimeout(() => {
      seekAccum = 0;
      seekLeft.classList.remove('pp-seek--on');
      seekRight.classList.remove('pp-seek--on');
    }, 700);
    paintTime();
  }
  function toggleFill() {
    state.fill = !state.fill;
    root.classList.toggle('pp--fill', state.fill);
    fitBtn.innerHTML = state.fill ? ICON.fit : ICON.fill;
    message(state.fill ? 'ملء الشاشة' : 'ملاءمة');
  }
  function setLocked(on) {
    state.locked = on;
    root.classList.toggle('pp--locked', on);
    if (on) {
      hideControls();
      message('الشاشة مقفلة');
      showControls();
    } else {
      unlockBtn.hidden = true;
      showControls();
    }
  }

  // اللمس: لمسة تُظهر/تُخفي، ولمستان على الجانب تقدّم أو ترجع 10 ثوانٍ
  let lastTap = { t: 0, x: 0 };
  gestures.addEventListener('pointerup', (e) => {
    if (sheet.hidden === false) return;
    const now = Date.now();
    const w = gestures.clientWidth;
    const side = e.clientX < w * 0.35 ? -1 : e.clientX > w * 0.65 ? 1 : 0;
    if (!state.locked && now - lastTap.t < 280 && side && Math.sign(lastTap.x) === side) {
      seekBy(side * 10);
      lastTap = { t: now, x: side };
      return;
    }
    lastTap = { t: now, x: side };
    setTimeout(() => {
      if (lastTap.t !== now) return;
      if (state.locked) return showControls();
      root.classList.contains('pp--shown') ? hideControls() : showControls();
    }, 260);
  });

  // شريط التقدّم: سحب ولمس
  let dragging = false;
  const seekToX = (x) => {
    const r = track.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (x - r.left) / r.width));
    if (Number.isFinite(video.duration)) video.currentTime = p * video.duration;
    paintTime();
  };
  bar.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    dragging = true;
    bar.classList.add('pp-bar--drag');
    bar.setPointerCapture?.(e.pointerId);
    seekToX(e.clientX);
    showControls(true);
  });
  bar.addEventListener('pointermove', (e) => dragging && seekToX(e.clientX));
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove('pp-bar--drag');
    showControls();
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);

  // ───────────────────────── الأوراق ─────────────────────────

  function openSheet(title, subtitle, build) {
    sheet.replaceChildren();
    sheet.append(el('i', 'pp-sheet__grip'));
    const head = el('div', 'pp-sheet__head');
    head.append(el('strong', null, title));
    if (subtitle) head.append(el('small', null, subtitle));
    const body = el('div', 'pp-sheet__body');
    sheet.append(head, body);
    build(body);
    sheet.hidden = false;
    sheetScrim.hidden = false;
    hideControls();
    requestAnimationFrame(() => root.classList.add('pp--sheet'));
    return body;
  }
  function closeSheet() {
    root.classList.remove('pp--sheet');
    sheet.hidden = true;
    sheetScrim.hidden = true;
    showControls();
  }
  const sheetRow = (label, sub, { on = false, onClick = null } = {}) => {
    const b = el(onClick ? 'button' : 'div', `pp-row-item${on ? ' is-on' : ''}`);
    if (onClick) {
      b.type = 'button';
      b.onclick = () => onClick();
    }
    const t = el('span', 'pp-row-item__text');
    t.append(el('strong', null, label));
    if (sub) t.append(el('small', null, sub));
    b.append(t);
    if (on) b.insertAdjacentHTML('beforeend', `<span class="pp-row-item__check">${ICON.check}</span>`);
    return b;
  };
  const sectionLabel = (text) => el('div', 'pp-section', text);

  function routeTile(r, isCurrent) {
    const failed = state.failed.get(r.id);
    const status = isCurrent
      ? { text: state.started ? 'يعمل الآن' : 'يبدأ…', tone: 'accent', pulse: !state.started }
      : failed ? { text: failed, tone: 'bad' }
        : r.state === 'RESOLVING' ? { text: 'يتجهّز…', tone: 'warn', pulse: true }
          : r.state === 'READY' ? { text: 'جاهز', tone: 'ok' }
            : { text: 'غير متاح', tone: 'off' };
    const playable = !isCurrent && r.state === 'READY';
    const t = el(playable ? 'button' : 'div', `pp-tile pp-tile--${status.tone}${isCurrent ? ' is-current' : ''}`);
    if (playable) {
      t.type = 'button';
      t.onclick = () => {
        closeSheet();
        const c = r.candidates.map((id) => sessionOf(state.session)?.cands.get(id)).find(Boolean);
        if (!c) return;
        state.tried.delete(c.id);
        state.failed.delete(r.id);
        void playFrom(c.id, Math.round((video.currentTime || 0) * 1000));
      };
    }
    const head = el('span', 'pp-tile__head');
    head.append(el('b', null, r.code));
    if (r.variant === 'DUB') head.append(el('em', null, 'مدبلج'));
    t.append(head);
    const st = el('span', 'pp-tile__state');
    st.append(el('i', `pp-dot${status.pulse ? ' pp-dot--pulse' : ''}`), el('span', null, status.text));
    t.append(st);
    t.title = r.reason ?? '';
    return t;
  }

  function showServers() {
    const s = sessionOf(state.session);
    if (!s) return message('السيرفرات غير متاحة لهذه الجلسة');
    const render = (body) => {
      body.replaceChildren();
      const routes = [...s.routes.values()];
      const ready = routes.filter((r) => r.state === 'READY').length;
      const best = el('button', 'pp-pill-btn pp-pill-btn--primary pp-pill-btn--wide');
      best.type = 'button';
      best.innerHTML = `${ICON.spark}<span>شغّل الأفضل</span>`;
      best.onclick = () => {
        closeSheet();
        state.tried.clear();
        void playFrom(null, Math.round((video.currentTime || 0) * 1000));
      };
      body.append(best, el('p', 'pp-note', !s.done ? `يتجهّز… ${ready} جاهز حتى الآن` : ready ? `${ready} سيرفر جاهز` : 'لم يجهز أي سيرفر لهذه الحلقة'));
      const groups = new Map();
      for (const r of routes.filter((x) => x.state !== 'UNAVAILABLE')) {
        const key = bucket(r.quality) ? `${bucket(r.quality)}p` : 'جودة غير محددة';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }
      const order = (k) => (k.endsWith('p') ? -parseInt(k, 10) : 0);
      for (const [name, list] of [...groups.entries()].sort((a, b) => order(a[0]) - order(b[0]))) {
        body.append(sectionLabel(name));
        const grid = el('div', 'pp-tiles');
        for (const r of list.sort((a, b) => ['READY', 'RESOLVING'].indexOf(a.state) - ['READY', 'RESOLVING'].indexOf(b.state))) grid.append(routeTile(r, r.id === state.current?.route));
        body.append(grid);
      }
      const dead = routes.filter((r) => r.state === 'UNAVAILABLE');
      if (dead.length) {
        body.append(sectionLabel(`غير متاح (${dead.length})`));
        const grid = el('div', 'pp-tiles');
        dead.forEach((r) => grid.append(routeTile(r, false)));
        body.append(grid);
      }
    };
    const body = openSheet('السيرفرات', movie ? 'فيلم' : `الحلقة ${state.episode}`, render);
    // تحديث حي ما دامت الورقة مفتوحة والسيرفرات تتجهّز
    const live = setInterval(() => {
      if (sheet.hidden || state.closed) return clearInterval(live);
      render(body);
    }, 1200);
  }

  function showEpisodes() {
    const total = state.total;
    if (movie || total <= 0 || !(args.copies ?? []).length) return message('قائمة الحلقات من صفحة العمل');
    openSheet('الحلقات', `${total} حلقة`, (body) => {
      const grid = el('div', 'pp-episodes');
      for (let n = 1; n <= total; n++) {
        const b = el('button', `pp-ep${n === state.episode ? ' is-on' : ''}`, String(n));
        b.type = 'button';
        b.onclick = () => {
          closeSheet();
          if (n !== state.episode) void goEpisode(n);
        };
        grid.append(b);
      }
      body.append(grid);
      requestAnimationFrame(() => grid.querySelector('.is-on')?.scrollIntoView({ block: 'center' }));
    });
  }

  function showQuality() {
    openSheet('الجودة', state.current ? `${state.current.code}` : null, (body) => {
      const hls = state.hls;
      if (hls?.levels?.length > 1) {
        const auto = hls.autoLevelEnabled;
        body.append(sheetRow('تلقائي', auto && currentHeight() ? `الآن ${fmtQ(currentHeight())} حسب سرعة اتصالك` : 'حسب سرعة اتصالك', {
          on: auto,
          onClick: () => {
            hls.currentLevel = -1;
            state.level = -1;
            closeSheet();
            paint();
          },
        }));
        [...hls.levels.entries()].sort((a, b) => (b[1].height ?? 0) - (a[1].height ?? 0)).forEach(([i, l]) => {
          const on = !auto && hls.currentLevel === i;
          body.append(sheetRow(fmtQ(l.height) || `${Math.round((l.bitrate ?? 0) / 1000)}kbps`, null, {
            on,
            onClick: () => {
              hls.currentLevel = i;
              state.level = i;
              closeSheet();
              paint();
              message(`الجودة ${fmtQ(l.height)}`);
            },
          }));
        });
      } else {
        body.append(sheetRow(fmtQ(state.current?.quality ?? currentHeight()) || 'جودة السيرفر', 'الجودة الوحيدة في هذا السيرفر', { on: true }));
      }
      // جودات أخرى من سيرفرات أخرى (كما في الـAPK)
      const s = sessionOf(state.session);
      const mine = bucket(state.current?.quality ?? currentHeight());
      const others = [...(s?.routes.values() ?? [])].filter((r) => r.state === 'READY' && r.id !== state.current?.route && bucket(r.quality) && bucket(r.quality) !== mine);
      const seen = new Set();
      const pick = others.sort((a, b) => b.quality - a.quality).filter((r) => !seen.has(bucket(r.quality)) && seen.add(bucket(r.quality)));
      if (pick.length) {
        body.append(sectionLabel('من سيرفر آخر'));
        for (const r of pick) {
          body.append(sheetRow(fmtQ(r.quality), r.code, {
            onClick: () => {
              closeSheet();
              const c = r.candidates.map((id) => s.cands.get(id)).find(Boolean);
              if (c) void playFrom(c.id, Math.round((video.currentTime || 0) * 1000));
            },
          }));
        }
      }
    });
  }

  function showSpeed() {
    openSheet('السرعة', null, (body) => {
      for (const sp of SPEEDS) {
        body.append(sheetRow(sp === 1 ? 'عادية' : `${sp}×`, null, {
          on: state.speed === sp,
          onClick: () => {
            state.speed = sp;
            video.playbackRate = sp;
            closeSheet();
            message(sp === 1 ? 'سرعة عادية' : `السرعة ${sp}×`);
          },
        }));
      }
    });
  }

  function showMore() {
    openSheet('المزيد', null, (body) => {
      body.append(sheetRow('السرعة', state.speed === 1 ? 'عادية' : `${state.speed}×`, { onClick: () => { closeSheet(); showSpeed(); } }));
      body.append(sheetRow('قفل الشاشة', 'يمنع اللمس الخاطئ أثناء المشاهدة', { onClick: () => { closeSheet(); setLocked(true); } }));
      body.append(sheetRow(state.fill ? 'ملاءمة الصورة' : 'ملء الشاشة', 'قصّ الحواف لملء الشاشة أو إظهار الصورة كاملة', { onClick: () => { closeSheet(); toggleFill(); } }));
      if (document.pictureInPictureEnabled || video.webkitSupportsPresentationMode) {
        body.append(sheetRow('صورة داخل صورة', 'تابع المشاهدة فوق التطبيقات الأخرى', {
          onClick: () => {
            closeSheet();
            if (video.requestPictureInPicture) video.requestPictureInPicture().catch(() => message('ما قدرنا نفتح صورة داخل صورة'));
            else video.webkitSetPresentationMode?.('picture-in-picture');
          },
        }));
      }
      if (root.requestFullscreen) {
        body.append(sheetRow(document.fullscreenElement ? 'خروج من ملء الشاشة' : 'ملء الشاشة الكامل', null, {
          onClick: () => {
            closeSheet();
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            else root.requestFullscreen().catch(() => {});
          },
        }));
      }
    });
  }

  function showError(text) {
    errorCard.replaceChildren();
    errorCard.append(el('strong', null, text), el('p', null, 'جرّب سيرفرًا آخر أو أعد المحاولة بعد قليل'));
    const actions = el('div', 'pp-error__actions');
    const mk = (label, primary, fn) => {
      const b = el('button', `pp-pill-btn${primary ? ' pp-pill-btn--primary' : ''}`, label);
      b.type = 'button';
      b.onclick = () => {
        errorCard.hidden = true;
        fn();
      };
      return b;
    };
    actions.append(mk('السيرفرات', true, showServers), mk('إعادة المحاولة', false, () => {
      state.tried.clear();
      state.failed.clear();
      void playFrom(null, Math.round((video.currentTime || 0) * 1000) || Number(args.position) || 0);
    }), mk('رجوع', false, () => closePlayer()));
    errorCard.append(actions);
    errorCard.hidden = false;
    setBusy(false);
    hideControls();
  }

  // ───────────────────────── التشغيل ─────────────────────────

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
    state.level = -1;
    video.removeAttribute('src');
    video.load();
  }

  /**
   * يشغّل رابطًا؛ يُحسم بـ{ ok } عند أول إطار حقيقي، أو { ok:false, reason }.
   * «حقيقي» = مدته معقولة وله صورة (لا صورة خطأ مدتها 5 ثوانٍ، ولا صوت بلا صورة).
   */
  function attempt(url, type) {
    teardownSource();
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok, reason = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(state.startTimer);
        video.removeEventListener('playing', onPlay);
        video.removeEventListener('error', onError);
        video.removeEventListener('loadedmetadata', onMeta);
        resolve({ ok, reason });
      };
      const onMeta = () => {
        const bad = judgePlayback({ duration: video.duration, videoWidth: video.videoWidth || 1, minDuration });
        if (bad === 'placeholder') done(false, 'placeholder');
      };
      const onPlay = () => {
        // الصورة تُعرف بعد أول إطار: أعطها لحظة ثم احكم
        setTimeout(() => {
          const bad = judgePlayback({ duration: video.duration, videoWidth: video.videoWidth, minDuration });
          done(!bad, bad);
        }, 1200);
      };
      const onError = () => done(false, 'error');
      video.addEventListener('playing', onPlay);
      video.addEventListener('error', onError);
      video.addEventListener('loadedmetadata', onMeta);
      state.startTimer = setTimeout(() => done(false, 'timeout'), START_TIMEOUT_MS);
      const go = () => video.play().catch(() => {
        // تشغيل تلقائي محجوب: الإطار يظهر حين يضغط الشخص تشغيل؛ نعدّه نجاحًا إن جهز
        if (video.readyState >= 2) done(!judgePlayback({ duration: video.duration, videoWidth: video.videoWidth || 1, minDuration }), 'blocked');
      });
      if (type === 'hls' && !nativeHls(video)) {
        loadHls()
          .then((Hls) => {
            if (settled) return;
            if (!Hls?.isSupported?.()) return done(false, 'unsupported');
            const hls = new Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: 30, capLevelToPlayerSize: false, startLevel: -1 });
            state.hls = hls;
            hls.on(Hls.Events.ERROR, (_, data) => {
              if (data?.fatal) {
                if (state.started && data.type === Hls.ErrorTypes.MEDIA_ERROR) return hls.recoverMediaError();
                done(false, 'hls');
                if (state.started) void heal('hls');
              }
            });
            hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
              // الأعلى أولًا (1080p)، ثم يتكيّف مع الاتصال
              const levels = data?.levels ?? hls.levels ?? [];
              let top = 0;
              levels.forEach((l, i) => {
                if ((l.height ?? 0) > (levels[top]?.height ?? 0)) top = i;
              });
              if (levels.length > 1) hls.startLevel = top;
              go();
            });
            hls.on(Hls.Events.LEVEL_SWITCHED, () => paint());
            hls.loadSource(url);
            hls.attachMedia(video);
          })
          .catch(() => done(false, 'hls_load'));
      } else {
        video.src = url;
        go();
      }
    });
  }

  const REASON = {
    placeholder: 'السيرفر يعرض صورة «غير متاح»',
    no_picture: 'صوت بلا صورة على هذا الجهاز',
    timeout: 'لم يبدأ خلال 15 ثانية',
    error: 'رفض المضيف التشغيل',
    hls: 'انقطع البث',
    stall: 'توقّف ولم يكمل',
  };

  async function playCandidate(c, { seek = 0 } = {}) {
    state.current = c;
    state.started = false;
    state.tried.add(c.id);
    errorCard.hidden = true;
    paint();
    setBusy(true, `جارٍ التشغيل · ${c.code}`);
    await runtime.ensureMedia().catch(() => null);
    const proxied = runtime.fetcher.mediaUrl(c.url, c.referer);
    let reason = null;
    for (const [via, url] of [['direct', c.url], ['edge', proxied]]) {
      if (state.closed || state.current !== c) return false;
      const out = await attempt(url, c.type);
      if (out.ok) {
        state.via = via;
        state.started = true;
        state.lastProgressAt = Date.now();
        state.lastTime = video.currentTime;
        if (seek > 0 && Number.isFinite(video.duration) && seek < video.duration * 1000 - 5000) video.currentTime = seek / 1000;
        video.playbackRate = state.speed;
        setBusy(false);
        paint();
        showControls();
        emit('server', { animeId: args.animeId ?? null, code: c.code, sourceId: c.sourceId, server: c.server, quality: c.quality ?? currentHeight() ?? null });
        report();
        return true;
      }
      reason = out.reason;
      // صورة «غير متاح» هي نفسها عبر الجالب: لا داعي للطريق الثاني
      if (reason === 'placeholder') break;
    }
    state.failed.set(c.route, REASON[reason] ?? 'فشل التشغيل');
    return false;
  }

  /** المرشّح المختار ثم الباقي بالترتيب، حتى يعمل واحد. */
  async function playFrom(firstId, seek = 0) {
    const s = sessionOf(state.session);
    if (!s) return showError('انتهت الجلسة، افتح الحلقة من جديد');
    const pool = () => readyCandidates(s, args.prefer ?? null).filter((c) => !state.tried.has(c.id) && !state.failed.has(c.route));
    const first = firstId ? s.cands.get(firstId) : null;
    if (first && (await playCandidate(first, { seek }))) return;
    for (;;) {
      if (state.closed) return;
      let next = pool()[0];
      if (!next && !s.done) {
        setBusy(true, 'نجهّز سيرفرًا آخر…');
        const out = await engine.best({ session: state.session, prefer: args.prefer ?? null, waitMs: 30_000 }).catch(() => null);
        next = pool()[0] ?? (out?.candidate && !state.tried.has(out.candidate) ? s.cands.get(out.candidate) : null);
      }
      if (!next) return showError('ما اشتغل أي سيرفر لهذي الحلقة');
      if (state.current && state.started === false) message(`${state.current.code}: ${state.failed.get(state.current.route) ?? 'فشل'} — نجرّب التالي`, 2500);
      if (await playCandidate(next, { seek })) return;
    }
  }

  /**
   * علاج أثناء المشاهدة: البث مات بعد أن بدأ (توقّف طويل، خطأ). من نفس اللحظة:
   * الطريق الآخر لنفس الرابط أولًا (مباشر ⇄ عبر الجالب)، ثم السيرفر التالي.
   */
  async function heal(why) {
    if (state.healing || state.closed || !state.current) return;
    state.healing = true;
    const at = Math.round((video.currentTime || 0) * 1000);
    const c = state.current;
    message(`انقطع ${c.code} — نكمل من نفس اللحظة`, 3000);
    try {
      if (state.via === 'direct') {
        await runtime.ensureMedia().catch(() => null);
        const out = await attempt(runtime.fetcher.mediaUrl(c.url, c.referer), c.type);
        if (out.ok) {
          state.via = 'edge';
          if (at > 0 && Number.isFinite(video.duration)) video.currentTime = at / 1000;
          video.playbackRate = state.speed;
          state.lastProgressAt = Date.now();
          return;
        }
      }
      state.failed.set(c.route, REASON[why] ?? 'انقطع');
      await playFrom(null, at);
    } finally {
      state.healing = false;
    }
  }

  async function goEpisode(n) {
    const copies = args.copies ?? [];
    if (!copies.length || n < 1 || (state.total > 0 && n > state.total)) return;
    report();
    setBusy(true, `نجهّز الحلقة ${n}…`);
    errorCard.hidden = true;
    teardownSource();
    void engine.closeSession({ session: state.session });
    const prep = await engine.prepare({ copies, episode: n, preferredSourceId: state.current?.sourceId ?? null, preferredServer: state.current?.server ?? null });
    state.session = prep.session;
    state.episode = n;
    state.tried.clear();
    state.failed.clear();
    state.current = null;
    paint();
    emit('episode', { animeId: args.animeId ?? null, session: state.session, episode: n });
    const best = await engine.best({ session: state.session, prefer: args.prefer ?? null, waitMs: 45_000 }).catch(() => null);
    await playFrom(best?.candidate ?? null);
  }

  // بطاقة «الحلقة التالية» بعدّ تنازلي، كالـAPK
  let countdown = 0;
  function offerNext() {
    if (isLast()) return;
    const card = el('div', 'pp-next');
    card.dir = 'rtl';
    card.append(el('small', null, 'الحلقة التالية'), el('strong', null, `الحلقة ${state.episode + 1}`));
    const count = el('span', 'pp-next__count', 'تبدأ خلال 5');
    const actions = el('div', 'pp-error__actions');
    const now = el('button', 'pp-pill-btn pp-pill-btn--primary', 'شغّل الآن');
    now.type = 'button';
    const cancel = el('button', 'pp-pill-btn', 'إلغاء');
    cancel.type = 'button';
    actions.append(now, cancel);
    card.append(count, actions);
    root.append(card);
    let left = 5;
    const stop = () => {
      clearInterval(countdown);
      card.remove();
    };
    countdown = setInterval(() => {
      left -= 1;
      count.textContent = `تبدأ خلال ${left}`;
      if (left <= 0) {
        stop();
        void goEpisode(state.episode + 1);
      }
    }, 1000);
    now.onclick = () => {
      stop();
      void goEpisode(state.episode + 1);
    };
    cancel.onclick = stop;
  }

  function closePlayer(notify = true) {
    if (state.closed) return;
    if (notify) report(true);
    state.closed = true;
    clearInterval(countdown);
    clearInterval(watchdog);
    teardownSource();
    root.remove();
    meta.remove();
    document.documentElement.classList.remove('pwa-playing');
    window.removeEventListener('keydown', onKey);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    try {
      screen.orientation?.unlock?.();
    } catch {
      // لا قفل اتجاه
    }
    void engine.closeSession({ session: state.session });
    if (active?.root === root) active = null;
  }

  const onKey = (e) => {
    if (e.key === 'Escape') return sheet.hidden ? closePlayer() : closeSheet();
    if (e.target?.tagName === 'INPUT') return;
    if (e.key === ' ' || e.key === 'k') togglePlay();
    else if (e.key === 'ArrowRight') seekBy(10);
    else if (e.key === 'ArrowLeft') seekBy(-10);
    else if (e.key === 'f') root.requestFullscreen?.().catch(() => {});
    else return;
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey);

  video.addEventListener('timeupdate', () => {
    paintTime();
    if (video.currentTime !== state.lastTime) {
      state.lastTime = video.currentTime;
      state.lastProgressAt = Date.now();
    }
    const now = Date.now();
    if (now - state.lastReport >= REPORT_EVERY_MS) {
      state.lastReport = now;
      report();
    }
  });
  video.addEventListener('progress', paintTime);
  video.addEventListener('durationchange', paintTime);
  video.addEventListener('play', () => {
    playBtn.innerHTML = ICON.pause;
    playBtn.setAttribute('aria-label', 'إيقاف مؤقت');
    showControls();
  });
  video.addEventListener('pause', () => {
    playBtn.innerHTML = ICON.play;
    playBtn.setAttribute('aria-label', 'تشغيل');
    showControls(true);
    report();
  });
  video.addEventListener('waiting', () => state.started && (spinner.hidden = false));
  video.addEventListener('playing', () => (spinner.hidden = true));
  video.addEventListener('ended', () => {
    // نهاية مقطع لم يُعتمد (صورة خطأ قصيرة) ليست نهاية الحلقة
    if (!state.started) return;
    report();
    offerNext();
  });
  // خطأ بعد البداية (مقطع رُفض، رابط انتهى): علاج من نفس اللحظة
  video.addEventListener('error', () => {
    if (state.started && !state.hls) void heal('error');
  });
  // حارس التوقّف: يعمل ولا يتقدّم طوال 15 ثانية ⇒ الطريق مات
  const watchdog = setInterval(() => {
    if (!state.started || state.healing || video.paused || video.ended || state.closed) return;
    if (Date.now() - state.lastProgressAt > STALL_MS) void heal('stall');
  }, 2000);

  active = { root, close: closePlayer };
  paint();
  showControls();
  void playFrom(args.candidate ?? null, Number(args.position) || 0);
  return active;
}
