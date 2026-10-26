/**
 * طبقة أدوات مشغل ويندوز — نفس تصميم مشغل الـAPK (PlayerActivity.kt) ونفس عناصر مشغل الويب
 * (pwa/player/player.js): تدرّج أعلى بالرجوع والعنوان والحلقة وملء الصورة وملء الشاشة والمزيد،
 * وتدرّج أسفل بالوقت وشريط التقدّم، ثم صف: [الصوت، التالية، الحلقات، السيرفرات] ·
 * [−10، تشغيل دائري، +10] · [الجودة، الترجمة، السرعة، ملء الشاشة]. الأوراق من الأسفل.
 *
 * هذه الصفحة عرض فقط: تُرسم من «الحالة» التي يرسلها player.js، وكل لمسة أمرٌ يعود إليه.
 * لا تشغيل هنا ولا شبكة؛ الفيديو نافذة mpv الأصلية تحت هذه النافذة الشفافة.
 */

import { createDesktopLoadingStage } from './loading-stage.js';

const HIDE_AFTER_MS = 3000;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const svg = (body, { fill = false } = {}) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
// نفس رسوم Glyph في Ui.kt (منسوخة من pwa/player/player.js)
export const ICON = {
  back: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  play: svg('<path d="M8 5.5 19 12 8 18.5Z"/>', { fill: true }),
  pause: svg('<rect x="6.5" y="5" width="3.5" height="14" rx="1.2"/><rect x="14" y="5" width="3.5" height="14" rx="1.2"/>', { fill: true }),
  rewind: svg('<path d="M12 3.5a8.5 8.5 0 1 1-7.4 4.3"/><path d="M8 2.2 7.1 5.2l3.1.7"/><text x="12" y="14.7" font-size="7.6" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui">10</text>'),
  forward: svg('<path d="M12 3.5a8.5 8.5 0 1 0 7.4 4.3"/><path d="m16 2.2.9 3-3.1.7"/><text x="12" y="14.7" font-size="7.6" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui">10</text>'),
  more: svg('<circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/>', { fill: true }),
  episodes: svg('<rect x="3" y="4" width="18" height="11" rx="2.5"/><path d="m10.5 7.5 4 2-4 2Z" fill="currentColor"/><path d="M5 19h14"/>'),
  servers: svg('<rect x="3.5" y="4" width="17" height="6.5" rx="2"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="2"/><path d="M12 7.25h5M12 16.75h5"/><circle cx="7.5" cy="7.25" r="1.1" fill="currentColor"/><circle cx="7.5" cy="16.75" r="1.1" fill="currentColor"/>'),
  speed: svg('<path d="M3 14a9 9 0 0 1 18 0"/><path d="m12 14 4.5-5M3 14v4M21 14v4"/><circle cx="12" cy="14" r="1.6" fill="currentColor"/>'),
  next: svg('<path d="M5 5.5 15 12 5 18.5Z"/><rect x="16.5" y="5.5" width="2.5" height="13" rx="1"/>', { fill: true }),
  check: svg('<path d="m5 12.5 5 5L19 7"/>'),
  full: svg('<path d="M3 9V5h4M17 5h4v4M21 15v4h-4M7 19H3v-4"/>'),
  fullExit: svg('<path d="M8 3v4H4M16 3v4h4M16 21v-4h4M8 21v-4H4"/>'),
  crop: svg('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M6 12h3M15 12h3M7.5 10.2 5.8 12l1.7 1.8M16.5 10.2l1.7 1.8-1.7 1.8"/>'),
  volume: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  mute: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" fill="currentColor"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
  audio: svg('<path d="M3 10v4M6 7.5v9M9 5v14M12 7.5v9M15 9.5v5M18 6v12M21 10v4"/>'),
  subtitles: svg('<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M6.5 13.5h4M13 13.5h4.5M6.5 16h7"/>'),
  network: svg('<path d="M4 18h2.5v-4H4ZM9 18h2.5V10H9ZM14 18h2.5V7H14ZM19 18h2.5V4H19Z" fill="currentColor"/>'),
  users: svg('<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18.5 19.5a6.5 6.5 0 0 0-3-5.5"/>'),
};

export const clock = (ms) => {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const badgeOf = (q) => (!q ? 'HD' : q >= 2000 ? '4K' : q >= 1000 ? 'FHD' : q >= 700 ? 'HD' : `${q}p`);

/** يبني الطبقة داخل doc ويعيد {update(state), root}. send(message) يرسل الأوامر لـplayer.js. */
export function createOverlayView(doc, send, { timers = globalThis } = {}) {
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const iconButton = (name, label, onClick, cls = '') => {
    const b = el('button', `pp-icon ${cls}`.trim());
    b.type = 'button'; b.innerHTML = ICON[name]; b.setAttribute('aria-label', label); b.title = label;
    b.dataset.action = name;
    b.onclick = (e) => { e.stopPropagation(); onClick(); };
    return b;
  };
  let state = {};
  const cmd = (name, value) => { void Promise.resolve(send(value === undefined ? { name } : { name, value })).catch(() => {}); };

  // v35: أنماط ورقة السيرفرات المشتركة مربوطة به (مشغل الويب يضيفه كذلك في غرفة الأصدقاء)
  const root = el('div', 'pwa-player');
  root.dir = 'ltr';
  const loadingStage = createDesktopLoadingStage(doc);
  root.append(loadingStage.element);
  const gestures = el('div', 'pp-gestures');
  const spinner = el('div', 'pp-spinner'); spinner.innerHTML = '<i></i>';
  const retry = el('button','pp-retry','إعادة المحاولة');retry.type='button';retry.hidden=true;retry.onclick=()=>cmd('retry');
  const status = el('div', 'pp-status'); status.setAttribute('role', 'status');

  // ── الأعلى ──
  const controls = el('div', 'pp-controls'); controls.dir = 'ltr';
  // الشريط العلوي عربي: الرجوع والعنوان يمينًا، والأزرار يسارًا (كمشغل الجوال)
  const top = el('div', 'pp-top'); top.dir = 'rtl';
  const titles = el('div', 'pp-titles'); titles.dir = 'rtl';
  const titleEl = el('strong'), subEl = el('small');
  titleEl.dir = 'auto'; subEl.dir = 'auto'; // «الحلقة 3» لا تنقلب خلف عنوان إنجليزي
  titles.append(titleEl, subEl);
  let peopleKey = '';
  const peopleButton = el('button', 'pp-people pp-desk');
  peopleButton.type = 'button'; peopleButton.hidden = true;
  peopleButton.setAttribute('aria-label', 'أعضاء غرفة المشاهدة');
  peopleButton.onclick = () => cmd('room');
  const fullTop = iconButton('full', 'ملء الشاشة (F أو F11)', () => cmd('fullscreen'));
  top.append(iconButton('back', 'رجوع', () => cmd('close')), titles, iconButton('users', 'شاهد مع أصدقائك', () => cmd('room')), iconButton('crop', 'ملء الصورة (قصّ الحواف)', () => cmd('fit', state.fit === 'fill' ? 'fit' : 'fill')), fullTop, iconButton('more', 'المزيد', () => showMore()));

  // ── الأسفل ──
  const bottom = el('div', 'pp-bottom');
  const times = el('div', 'pp-times'), timeNow = el('span', null, '0:00'), timeTotal = el('span', null, '0:00');
  times.append(timeNow, timeTotal);
  const bar = el('div', 'pp-bar'); bar.setAttribute('role', 'slider'); bar.setAttribute('aria-label', 'التقدّم'); bar.tabIndex = 0; bar.dataset.control = 'seek';
  const track = el('div', 'pp-track'), buffered = el('i', 'pp-buffered'), played = el('i', 'pp-played'), thumb = el('b', 'pp-thumb');
  track.append(buffered, played);
  const hoverTip = el('span', 'pp-hover'); hoverTip.hidden = true;
  bar.append(track, el('span', 'pp-marks'), thumb, hoverTip);

  const row = el('div', 'pp-row');
  const left = el('div', 'pp-group');
  const volume = el('div', 'pp-volume pp-desk');
  const volBtn = iconButton('volume', 'كتم الصوت (M)', () => cmd('volume', (state.volume ?? 100) > 0 ? 0 : (state.lastVolume ?? 100)));
  const volRange = el('input', 'pp-volume__range');
  Object.assign(volRange, { type: 'range', min: '0', max: '100', step: '1' });
  volRange.setAttribute('aria-label', 'مستوى الصوت');
  volRange.addEventListener('input', () => cmd('volume', Number(volRange.value)));
  volRange.addEventListener('pointerdown', (e) => e.stopPropagation());
  volume.append(volBtn, volRange);
  const nextBtn = iconButton('next', 'الحلقة التالية', () => cmd('episode', Number(state.episode) + 1));
  left.append(volume, nextBtn, iconButton('episodes', 'الحلقات', () => showEpisodes()), iconButton('servers', 'السيرفرات', () => showServers()));
  const center = el('div', 'pp-group pp-center');
  const playBtn = el('button', 'pp-play'); playBtn.type = 'button'; playBtn.dataset.action = 'pause';
  playBtn.onclick = (e) => { e.stopPropagation(); cmd('pause', !state.paused); };
  center.append(iconButton('rewind', 'رجوع 10 ثوانٍ', () => cmd('seek-by', -10000), 'pp-icon--big'), playBtn, iconButton('forward', 'تقديم 10 ثوانٍ', () => cmd('seek-by', 10000), 'pp-icon--big'));
  const right = el('div', 'pp-group');
  const qualityBtn = el('button', 'pp-quality', 'HD'); qualityBtn.type = 'button'; qualityBtn.setAttribute('aria-label', 'الجودة');
  qualityBtn.onclick = (e) => { e.stopPropagation(); showQuality(); };
  // كما في الـAPK وStremio: موجة صوت بجانب الترجمة (أيقونة مكبر الصوت كانت تُقرأ «مستوى الصوت»)
  const audioBtn = iconButton('audio', 'المسارات الصوتية', () => showAudio(), 'pp-desk'); audioBtn.hidden = true;
  const fullBottom = iconButton('full', 'ملء الشاشة (F أو F11)', () => cmd('fullscreen'), 'pp-desk');
  right.append(qualityBtn, iconButton('subtitles', 'الترجمة (C)', () => showSubtitles(), 'pp-desk'), audioBtn, iconButton('speed', 'السرعة', () => showSpeed()), fullBottom);
  row.append(left, center, right);
  bottom.append(times, bar, row);
  controls.append(el('div', 'pp-shade pp-shade--top'), el('div', 'pp-shade pp-shade--bottom'), top, bottom);

  const skipBtn = el('button', 'pp-skip'); skipBtn.type = 'button'; skipBtn.hidden = true;
  skipBtn.onclick = (e) => { e.stopPropagation(); cmd('skip'); };
  const sheetScrim = el('div', 'pp-scrim'); sheetScrim.hidden = true;
  const sheet = el('div', 'pp-sheet'); sheet.dir = 'rtl'; sheet.hidden = true;
  sheetScrim.onclick = () => closeSheet();
  // Like Android's pp-together strip: the participants stay visible even when
  // playback controls fade after three seconds.
  root.append(retry,gestures, spinner, status, controls, peopleButton, skipBtn, sheetScrim, sheet);
  doc.body.append(root);

  // ── الظهور والاختفاء ──
  let hideTimer = 0, overControls = false;
  function showControls(stay = false) {
    root.classList.add('pp--shown');
    timers.clearTimeout(hideTimer);
    if (!stay && !state.paused && state.ready) hideTimer = timers.setTimeout(() => { if (!overControls && sheet.hidden) root.classList.remove('pp--shown'); }, HIDE_AFTER_MS);
  }
  const hideControls = () => { timers.clearTimeout(hideTimer); root.classList.remove('pp--shown'); };
  // حركة حقيقية فقط: Chromium يطلق mousemove وهميًا بعد كل إعادة رسم (الوقت يتغير كل ربع ثانية)،
  // فكان عدّاد الإخفاء يُعاد للصفر إلى الأبد والأدوات لا تختفي.
  let lastX = null, lastY = null;
  root.addEventListener('mousemove', (e) => {
    if (e.screenX === lastX && e.screenY === lastY) return;
    lastX = e.screenX; lastY = e.screenY;
    showControls();
  });
  // خروج المؤشر من النافذة: الأدوات تختفي بعد المهلة كما في Stremio
  doc.addEventListener('mouseleave', () => { overControls = false; showControls(); });
  for (const zone of [top, bottom]) {
    zone.addEventListener('mouseenter', () => { overControls = true; showControls(true); });
    zone.addEventListener('mouseleave', () => { overControls = false; showControls(); });
  }
  // الماوس: نقرة = تشغيل/إيقاف، نقرتان = ملء الشاشة (مثل مشغل الويب على الكمبيوتر)
  let clickTimer = 0;
  gestures.addEventListener('click', (e) => {
    if (!sheet.hidden || e.detail > 1) return;
    timers.clearTimeout(clickTimer);
    clickTimer = timers.setTimeout(() => cmd('pause', !state.paused), 220);
  });
  gestures.addEventListener('dblclick', () => { timers.clearTimeout(clickTimer); cmd('fullscreen'); });
  gestures.addEventListener('wheel', (e) => {
    if (!sheet.hidden || !e.deltaY) return;
    e.preventDefault();
    cmd('volume', Math.max(0, Math.min(100, (state.volume ?? 100) + (e.deltaY < 0 ? 5 : -5))));
  }, { passive: false });

  // ── شريط التقدّم ──
  let dragging = false, dragMs = null;
  const msAt = (x) => { const r = track.getBoundingClientRect(); const p = Math.max(0, Math.min(1, (x - r.left) / (r.width || 1))); return Math.round(p * (state.duration || 0)); };
  bar.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (!state.duration) return; dragging = true; bar.classList.add('pp-bar--drag'); bar.setPointerCapture?.(e.pointerId); dragMs = msAt(e.clientX); paintTime(); showControls(true); });
  bar.addEventListener('pointermove', (e) => {
    if (dragging) { dragMs = msAt(e.clientX); paintTime(); }
    if (!state.duration) return;
    const ms = msAt(e.clientX); hoverTip.textContent = clock(ms); hoverTip.style.left = `${(ms / state.duration) * 100}%`; hoverTip.hidden = false;
  });
  const endDrag = () => { if (!dragging) return; dragging = false; bar.classList.remove('pp-bar--drag'); if (dragMs != null) cmd('seek', dragMs); showControls(); };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);
  bar.addEventListener('pointerleave', () => { hoverTip.hidden = true; });

  function paintTime() {
    const d = Number(state.duration) || 0, t = dragging && dragMs != null ? dragMs : Number(state.position) || 0;
    timeNow.textContent = clock(t); timeTotal.textContent = clock(d);
    const p = d ? Math.min(1, t / d) : 0;
    played.style.width = `${p * 100}%`; thumb.style.left = `${p * 100}%`;
    buffered.style.width = `${d && state.bufferedMs ? Math.min(1, state.bufferedMs / d) * 100 : 0}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  }

  // ── الأوراق ──
  let openKind = null, anchorButton = null;
  const anchorFor = (kind) => kind === 'quality' ? qualityBtn : root.querySelector(`[data-action="${kind}"]`);
  function positionSheet() {
    if (sheet.hidden || !anchorButton) return;
    const bounds = root.getBoundingClientRect?.() ?? {left:0,top:0}, anchor = anchorButton.getBoundingClientRect?.() ?? {top:690,right:1000};
    const width = bounds.width || doc.defaultView.innerWidth || 1024;
    const height = bounds.height || doc.defaultView.innerHeight || 768;
    const bottom = Math.max(12, height - (anchor.top - bounds.top) + 10);
    sheet.style.top = 'auto';
    const measured = sheet.getBoundingClientRect?.().width || (openKind === 'subtitles' ? 360 : 280);
    sheet.style.right = `${Math.max(12, Math.min(width - measured - 12, width - (anchor.right - bounds.left)))}px`;
    sheet.style.bottom = `${Math.min(height - 100, bottom)}px`;
    sheet.style.maxHeight = `${Math.max(80, height - bottom - 12)}px`;
    if (openKind === 'more') {
      const top = Math.max(12, (anchor.bottom ?? anchor.top) - bounds.top + 10);
      sheet.style.top = `${top}px`; sheet.style.bottom = 'auto';
      sheet.style.maxHeight = `${Math.max(80, height - top - 12)}px`;
    }
  }
  doc.defaultView?.addEventListener('resize', positionSheet);
  function openSheet(kind, title, subtitle, build, modifier = '') {
    if (anchorButton) anchorButton.setAttribute('aria-expanded', 'false');
    openKind = kind;
    anchorButton = anchorFor(kind);
    anchorButton?.setAttribute('aria-expanded', 'true');
    anchorButton?.setAttribute('aria-haspopup', 'dialog');
    sheet.dataset.kind = kind;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', title);
    sheet.className = `pp-sheet${modifier ? ` ${modifier}` : ''}`;
    sheet.replaceChildren(el('i', 'pp-sheet__grip'));
    const head = el('div', 'pp-sheet__head');
    head.append(el('strong', null, title));
    if (subtitle) head.append(el('small', null, subtitle));
    const body = el('div', 'pp-sheet__body');
    sheet.append(head, body);
    build(body);
    sheet.hidden = false; sheetScrim.hidden = false;
    showControls(true);
    root.classList.add('pp--sheet');
    positionSheet();
    sheet.querySelector('button')?.focus();
    return body;
  }
  function closeSheet() {
    if (openKind === 'servers') cmd('servers-close');
    anchorButton?.setAttribute('aria-expanded', 'false');
    const restoreFocus = anchorButton; anchorButton = null;
    openKind = null; serverUi = null; offsetOut = null;
    root.classList.remove('pp--sheet');
    sheet.hidden = true; sheetScrim.hidden = true;
    restoreFocus?.focus();
    showControls();
  }
  const sheetRow = (label, sub, { on = false, onClick = null } = {}) => {
    const b = el(onClick ? 'button' : 'div', `pp-row-item${on ? ' is-on' : ''}`);
    if (onClick) { b.type = 'button'; b.onclick = () => onClick(); }
    const t = el('span', 'pp-row-item__text');
    t.append(el('strong', null, label));
    if (sub) t.append(el('small', null, sub));
    b.append(t);
    if (on) b.insertAdjacentHTML('beforeend', `<span class="pp-row-item__check">${ICON.check}</span>`);
    return b;
  };
  const sectionLabel = (text) => el('div', 'pp-section', text);
  const stepper = (label, value, onStep) => {
    const row = el('div', 'pp-step');
    const out = el('output', null, value);
    const controls = el('div'); controls.dir = 'ltr';
    const minus = el('button', null, '−'), plus = el('button', null, '+');
    minus.type = plus.type = 'button';
    minus.onclick = () => onStep(-1); plus.onclick = () => onStep(1);
    controls.append(minus, out, plus);
    row.append(el('span', null, label), controls);
    return row;
  };

  // ورقة السيرفرات بأسلوب الـAPK (routeRow في PlayerActivity.kt): «شغّل الأفضل»، ثم صفوف
  // مجمّعة بالجودة: اسم المصدر، سطر التفاصيل، نقطة الحالة، وشارة «يعمل الآن».
  let serverUi = null;
  const ICON_SPARK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 3 14 10l7 2-7 2-2 7-2-7-7-2 7-2Z"/></svg>';
  const bucket = (q) => (!q ? null : q >= 2000 ? 2160 : q >= 1000 ? 1080 : q >= 700 ? 720 : q >= 460 ? 480 : 360);
  function showServers() {
    const body = openSheet('servers', 'السيرفرات', state.movie ? 'فيلم' : `الحلقة ${state.episode ?? ''}`, () => {}, 'pp-sheet--routes');
    serverUi = { body };
    paintServers();
    cmd('servers-open');
  }
  function paintServers() {
    if (!serverUi) return;
    const body = serverUi.body, routes = state.routes ?? [];
    const keep = body.scrollTop;
    body.replaceChildren();
    const best = el('button', 'pp-pill-btn pp-pill-btn--primary pp-pill-btn--wide');
    best.type = 'button'; best.innerHTML = `${ICON_SPARK}<span>شغّل الأفضل</span>`;
    best.onclick = () => { closeSheet(); cmd('best'); };
    const ready = routes.filter((r) => r.state === 'READY').length;
    body.append(best, el('p', 'pp-note', !state.routesDone ? `يتجهّز… ${ready} جاهز حتى الآن` : ready ? `${ready} سيرفر جاهز` : 'لم يجهز أي سيرفر لهذه الحلقة'));
    const groups = new Map();
    for (const r of routes.filter((x) => x.state !== 'UNAVAILABLE')) {
      const key = bucket(r.quality) ? `${bucket(r.quality)}p` : 'جودة غير محددة';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const order = (k) => (k.endsWith('p') ? -parseInt(k, 10) : 0);
    const row = (r) => {
      const current = (r.candidates ?? []).includes(state.candidate) || r.id === state.candidate;
      const playable = !current && r.state === 'READY';
      const b = el(playable ? 'button' : 'div', `pp-route${current ? ' is-current' : ''}`);
      if (playable) { b.type = 'button'; b.onclick = () => { closeSheet(); cmd('pick', r.id); }; }
      const text = el('span', 'pp-route__text');
      const name = el('strong', null, r.sourceName ?? r.code ?? 'مصدر'); name.dir = 'auto';
      const detail = el('small', null, [r.server && r.server !== r.sourceName ? r.server : null, r.label].filter(Boolean).join(' · ')); detail.dir = 'auto';
      text.append(name, detail);
      const tone = current ? 'accent' : r.state === 'READY' ? 'ok' : r.state === 'RESOLVING' ? 'warn' : 'off';
      const st = el('span', `pp-route__state pp-tile--${tone}`);
      st.append(el('i', `pp-dot${r.state === 'RESOLVING' || (current && !state.ready) ? ' pp-dot--pulse' : ''}`), el('span', null, current ? (state.ready ? 'يعمل الآن' : 'يبدأ…') : r.state === 'READY' ? 'جاهز' : r.state === 'RESOLVING' ? 'يتجهّز…' : 'غير متاح'));
      if (r.variant === 'DUB') st.prepend(el('em', 'pp-route__chip', 'مدبلج'));
      b.append(text, st);
      if (r.reason) b.title = r.reason;
      return b;
    };
    for (const [label, list] of [...groups.entries()].sort((a, b) => order(a[0]) - order(b[0]))) {
      body.append(el('div', 'pp-section', label));
      for (const r of list.sort((a, b) => ['READY', 'RESOLVING'].indexOf(a.state) - ['READY', 'RESOLVING'].indexOf(b.state))) body.append(row(r));
    }
    const dead = routes.filter((r) => r.state === 'UNAVAILABLE');
    if (dead.length) { body.append(el('div', 'pp-section', `غير متاح (${dead.length})`)); dead.forEach((r) => body.append(row(r))); }
    body.scrollTop = keep;
  }
  function showEpisodes() {
    const total = Number(state.total) || 0;
    if (state.movie || total <= 1) return;
    openSheet('episodes', 'الحلقات', `${total} حلقة`, (body) => {
      const grid = el('div', 'pp-episodes');
      for (let n = 1; n <= Math.min(total, 3000); n++) {
        const b = el('button', `pp-ep${n === Number(state.episode) ? ' is-on' : ''}`, String(n));
        b.type = 'button'; b.disabled = state.canChangeEpisode === false;
        b.onclick = () => { closeSheet(); if (n !== Number(state.episode)) cmd('episode', n); };
        grid.append(b);
      }
      body.append(grid);
      timers.requestAnimationFrame?.(() => grid.querySelector('.is-on')?.scrollIntoView?.({ block: 'center' }));
    });
  }
  function showQuality() {
    openSheet('quality', 'الجودة', state.serverCode ?? null, (body) => {
      const list = state.sources ?? [];
      if (!list.length) body.append(sheetRow(state.qualityLabel || 'جودة السيرفر', 'الجودة الوحيدة في هذا السيرفر', { on: true }));
      for (const s of list) body.append(sheetRow(s.label, null, { on: s.id === state.candidate, onClick: s.id === state.candidate ? null : () => { closeSheet(); cmd('source', s.id); } }));
    });
  }
  // الترجمة كما في الـAPK: تبويبان «المسارات» و«الضبط»؛ الضبط أزرار لا أرقام صغيرة
  let subtitleTab = 'tracks';
  const chips = (items, onPick) => {
    const row = el('div', 'pp-chips');
    for (const [label, on, value] of items) {
      const b = el('button', `pp-chip${on ? ' is-on' : ''}`, label); b.type = 'button';
      b.onclick = () => onPick(value);
      row.append(b);
    }
    return row;
  };
  function showSubtitles() {
    const paint = (body) => {
      const focusIndex = [...body.querySelectorAll('button')].indexOf(doc.activeElement);
      body.replaceChildren();
      const restore = () => { if (focusIndex >= 0) body.querySelectorAll('button')[focusIndex]?.focus(); positionSheet(); };
      body.append(chips([['المسارات', subtitleTab === 'tracks', 'tracks'], ['الضبط', subtitleTab === 'adjust', 'adjust']], (t) => { subtitleTab = t; paint(body); }));
      if (subtitleTab === 'tracks') {
        const tracks = state.subtitles ?? [];
        body.append(sheetRow('إيقاف', null, { on: !tracks.some((t) => t.selected), onClick: () => cmd('subtitle-off') }));
        if (tracks.length) body.append(sectionLabel('الترجمة من الفيديو'));
        for (const t of tracks) body.append(sheetRow(t.label, t.lang && t.lang !== 'und' ? t.lang : null, { on: !!t.selected, onClick: () => cmd('subtitle-select', t.id) }));
        if (!tracks.length) body.append(el('p', 'pp-note', 'نبحث عن ترجمات لهذه الحلقة… تظهر هنا فور وصولها.'));
        restore();
        return;
      }
      const delay = state.subtitleDelay ?? 0;
      body.append(sectionLabel('التوقيت'), el('div', 'pp-big', delay ? `${delay > 0 ? 'أتأخر' : 'أبكر'} ${Math.abs(delay / 1000).toFixed(1)} ث` : 'بلا إزاحة'));
      body.append(chips([['أبكر 0.5', false, -500], ['أبكر 0.1', false, -100], ['أتأخر 0.1', false, 100], ['أتأخر 0.5', false, 500]], (d) => cmd('subtitle-delay', delay + d)));
      body.append(el('small', 'pp-sub-hint', 'الترجمة تظهر بعد الكلام ← «أبكر». تسبقه ← «أتأخر».'));
      if (delay) body.append(chips([['تصفير التوقيت', false, 0]], () => cmd('subtitle-delay', 0)));
      const size = state.subtitleSize ?? 40;
      body.append(sectionLabel('الحجم'), chips([['صغير', size === 32, 32], ['متوسط', size === 40, 40], ['كبير', size === 52, 52], ['كبير جدًا', size === 64, 64]], (v) => cmd('subtitle-size', v)));
      const pos = state.subtitlePosition ?? 100;
      body.append(sectionLabel('الموضع'), chips([['أسفل', pos === 100, 100], ['أعلى قليلًا', pos === 85, 85], ['أعلى', pos === 12, 12]], (v) => cmd('subtitle-position', v)));
      const bg = state.subtitleBackground ?? 'shadow';
      body.append(sectionLabel('الخلفية'), chips([['ظل', bg === 'shadow', 'shadow'], ['خلفية داكنة', bg === 'box', 'box']], (v) => cmd('subtitle-background', v)));

      restore();
    };
    subtitlesBody = openSheet('subtitles', 'الترجمة', null, paint, 'pp-sheet--subtitles');
    subtitlesPaint = paint;
  }
  let subtitlesBody = null, subtitlesPaint = null, offsetOut = null;
  const audioNames = (() => { try { return new Intl.DisplayNames(['ar'], { type: 'language' }); } catch { return null; } })();
  /** «jpn» ← «اليابانية»؛ الرمز كما هو إن تعذّر. */
  function audioLanguage(code) {
    if (!code || code === 'und') return null;
    try { return audioNames?.of(code) ?? code; } catch { return code; }
  }
  function showAudio() {
    openSheet('audio', 'المسارات الصوتية', null, body => {
      for(const t of state.audio??[]) {
        const lang = audioLanguage(t.lang);
        body.append(sheetRow(t.label && t.label !== t.lang ? t.label : lang ?? t.label, t.label && t.label !== t.lang ? lang : null,
          {on:!!t.selected,onClick:()=>{closeSheet();cmd('audio-select',t.id);}}));
      }
    });
  }
  function showSpeed() {
    openSheet('speed', 'السرعة', state.synced ? 'السرعة تتبع مزامنة الغرفة' : null, (body) => {
      for (const sp of SPEEDS) body.append(sheetRow(sp === 1 ? 'عادية' : `${sp}×`, null, { on: (state.speed ?? 1) === sp, onClick: state.synced ? null : () => { closeSheet(); cmd('speed', sp); } }));
    });
  }
  function showMore() {
    openSheet('more', 'المزيد', null, (body) => {
      body.append(sheetRow('ملء الصورة', state.fit === 'fill' ? 'مفعّل: تُقصّ الحواف' : 'الصورة كاملة بلا قص', { on: state.fit === 'fill', onClick: () => { closeSheet(); cmd('fit', state.fit === 'fill' ? 'fit' : 'fill'); } }));
      body.append(sheetRow('شاهد مع أصدقائك', 'ادعُ أصدقاءك لنفس الحلقة', { onClick: () => { closeSheet(); cmd('room'); } }));
      body.append(sheetRow('الإعدادات المتقدمة', 'ترجمة خارجية، ضبط الصوت والصورة والاختصارات', { onClick: () => { closeSheet(); cmd('settings'); } }));
      if (state.together) {
        body.append(sectionLabel('مع أصدقائك'));
        const paintOffset = () => `${(state.videoOffsetMs ?? 0) > 0 ? '+' : (state.videoOffsetMs ?? 0) < 0 ? '−' : ''}${Math.abs((state.videoOffsetMs ?? 0) / 1000).toFixed(1)} ث`;
        const row = stepper('ديلاي فيديوي', paintOffset(), (d) => { cmd('video-offset', (state.videoOffsetMs ?? 0) + d * 500); });
        offsetOut = row.querySelector('output');
        body.append(row, el('small', 'pp-sub-hint', 'مصدرك متقدم عن أصحابك؟ زِد (+). متأخر؟ نقّص (−).'));
      }
      body.append(sectionLabel('الشبكة'));
      const net = el('div', 'pp-net');
      if (state.net?.peers != null) net.append(el('span', null, 'مشاركون متصلون'), el('b', null, String(state.net.peers)));
      net.append(el('span', null, 'السرعة الآن'), el('b', null, state.net?.kbps != null ? `${(state.net.kbps * 8 / 1024).toFixed(1)} Mbps` : '—'));
      net.append(el('span', null, 'السيرفر'), el('b', null, state.serverCode ?? '—'));
      body.append(net);
    });
  }

  // ── لوحة المفاتيح: كلها تعود لـplayer.js (نفس اختصارات النافذة الرئيسية) ──
  doc.addEventListener('keydown', (e) => {
    // F11 belongs to the focused transparent Electron child window, not the main renderer.
    if (e.key === 'F11') { e.preventDefault(); showControls(); cmd('fullscreen'); return; }
    if (e.key === 'Escape' && !sheet.hidden) { e.preventDefault(); closeSheet(); return; }
    if (!sheet.hidden) {
      if (e.key === 'Tab') {
        const buttons = [...sheet.querySelectorAll('button:not([disabled]), input, [tabindex="0"]')];
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
      if (e.key === ' ' && e.target?.tagName === 'BUTTON') return;
      if (['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName ?? '')) return;
    if (sheet.hidden && ['c', 'C'].includes(e.key)) { e.preventDefault(); showSubtitles(); return; }
    if ([' ', 'ArrowLeft', 'ArrowRight', 'f', 'F', 'Escape', 'm', 'M'].includes(e.key)) { e.preventDefault(); showControls(); cmd('key', e.key); }
  });

  function update(next) {
    const previous = state;
    state = { ...state, ...next };
    if (state.volume > 0) state.lastVolume = state.volume;
    root.dataset.tone = state.tone === 'cinema' ? 'cinema' : 'anime';
    titleEl.textContent = state.title ?? '';
    subEl.textContent = state.subtitle ?? '';
    playBtn.innerHTML = state.paused || !state.ready ? ICON.play : ICON.pause;
    playBtn.setAttribute('aria-label', state.paused ? 'تشغيل' : 'إيقاف مؤقت');
    loadingStage.update(state);
    spinner.hidden = !loadingStage.element.hidden || !(state.buffering || !state.ready) || !!state.status?.error;
    root.classList.toggle('pp--loading', !state.ready);
    status.textContent = state.status?.text ?? '';
    status.dataset.error = String(!!state.status?.error);retry.hidden=!state.status?.error;
    // Keep avatars visible in the native overlay: the main window is underneath mpv.
    const people=(Array.isArray(state.people)?state.people:[])
      .filter(p=>p&&p.userId).sort((a,b)=>Number(!!b.host)-Number(!!a.host));
    peopleButton.hidden=people.length===0;
    const faces=people.slice(0,3).map(p=>{
      const face=el('span', 'pp-person'+(p.state==='failed'?' is-failed':p.state==='preparing'||p.state==='buffering'?' is-busy':' is-ready'));
      face.title=`${p.name} · ${p.state==='ready'?'جاهز':p.state==='preparing'?'يجهّز':p.state==='buffering'?'ينتظر البيانات':p.state==='failed'?'تعذّر':p.state==='playing'?'يشاهد':'في الغرفة'}`;
      const letter=el('span','pp-person__letter',Array.from(String(p.name||'؟'))[0]||'؟');
      face.append(letter);
      if(typeof p.avatarKey==='string' && /^(?:https?:\/\/|data:image\/)/i.test(p.avatarKey)){
        const img=el('img','pp-person__img');img.alt='';img.loading='lazy';
        img.onerror=()=>img.remove();img.src=p.avatarKey;face.append(img);
      }
      return face;
    });
    if(people.length>3)faces.push(el('span','pp-person-more',`+${people.length-3}`));
    const key=JSON.stringify(people.map(p=>[p.userId,p.name,p.avatarKey,p.state,p.host]));
    if(key!==peopleKey){peopleKey=key;peopleButton.replaceChildren(...faces);}
    peopleButton.setAttribute('aria-label',`في الغرفة ${people.length} · عرض المشاركين`);
    audioBtn.hidden=!(state.audio??[]).length;
    nextBtn.hidden = state.movie || !(Number(state.total) > Number(state.episode));
    nextBtn.disabled = state.canChangeEpisode === false;
    qualityBtn.textContent = state.qualityLabel || badgeOf(state.quality);
    volRange.value = String(state.volume ?? 100);
    volBtn.innerHTML = (state.volume ?? 100) > 0 ? ICON.volume : ICON.mute;
    fullTop.innerHTML = fullBottom.innerHTML = state.fullscreen ? ICON.fullExit : ICON.full;
    if (state.skip) { skipBtn.hidden = false; skipBtn.textContent = state.skip; } else skipBtn.hidden = true;
    paintTime();
    if (offsetOut && openKind === 'more') { const v = state.videoOffsetMs ?? 0; offsetOut.textContent = `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v / 1000).toFixed(1)} ث`; }
    if (openKind === 'servers' && JSON.stringify([previous.routes,previous.routesDone,previous.candidate,previous.ready]) !== JSON.stringify([state.routes,state.routesDone,state.candidate,state.ready])) paintServers();
    if (openKind === 'subtitles' && subtitlesBody && (JSON.stringify(previous.subtitles) !== JSON.stringify(state.subtitles) || previous.subtitleDelay !== state.subtitleDelay || previous.subtitleSize !== state.subtitleSize || previous.subtitlePosition !== state.subtitlePosition || previous.subtitleBackground !== state.subtitleBackground)) subtitlesPaint(subtitlesBody);
    // بدأ التشغيل أو استؤنف: يبدأ عدّاد الإخفاء (كان لا يبدأ إلا بعد إيقاف ثم تشغيل)
    if (!state.ready || state.paused) { if (!root.classList.contains('pp--shown') || previous.ready !== state.ready || previous.paused !== state.paused) showControls(true); }
    else if (previous.paused || !previous.ready) showControls();
  }
  showControls(true);
  return { root, update, closeSheet, open: { servers: showServers, episodes: showEpisodes, quality: showQuality, subtitles: showSubtitles, audio: showAudio, speed: showSpeed, more: showMore } };
}

// تشغيل حقيقي داخل نافذة الطبقة (overlay-preload.cjs يعرّف VantaraOverlay)
const api = globalThis.VantaraOverlay;
if (api && globalThis.document?.body) {
  const view = createOverlayView(document, (message) => api.send(message));
  api.onState((message) => {
    if (message?.reset) view.closeSheet();
    view.update(message);
  });
  globalThis.VantaraOverlayView = view;
}
