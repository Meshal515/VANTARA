import { diagnosticsUi } from '../lib/diagnostics-ui.js';
/**
 * طبقة أدوات مشغل ويندوز — نفس تصميم مشغل الـAPK (PlayerActivity.kt) ونفس عناصر مشغل الويب
 * (pwa/player/player.js): تدرّج أعلى بالرجوع والعنوان والحلقة وملء الصورة وملء الشاشة والمزيد،
 * وتدرّج أسفل بالوقت وشريط التقدّم، ثم صف: [الصوت، التالية، الحلقات، السيرفرات] ·
 * [−10، تشغيل دائري، +10] · [الجودة، الترجمة، السرعة، ملء الشاشة]. الأوراق من الأسفل.
 *
 * هذه الصفحة عرض فقط: تُرسم من «الحالة» التي يرسلها player.js، وكل لمسة أمرٌ يعود إليه.
 * لا تشغيل هنا ولا شبكة؛ الفيديو نافذة mpv الأصلية تحت هذه النافذة الشفافة.
 */

const HIDE_AFTER_MS = 3000;
// قرار المالك: وقت الإيقاف تختفي الأدوات بعد 5 ث بلا حركة (لترى اللقطة صافية)، ومعها زر «إخفاء الأدوات» فوري
const PAUSED_HIDE_AFTER_MS = 5000;
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
  hide: svg('<path d="M3 3l18 18"/><path d="M10.6 5.1A10.7 10.7 0 0 1 12 5c5.2 0 9 4.7 9.8 6.6.1.3.1.5 0 .8-.4 1-1.4 2.6-3 3.9M6.6 6.6C4.4 8 2.9 10.2 2.2 11.6a1 1 0 0 0 0 .8C3 14.3 6.8 19 12 19c1.6 0 3.1-.4 4.4-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  full: svg('<path d="M3 9V5h4M17 5h4v4M21 15v4h-4M7 19H3v-4"/>'),
  fullExit: svg('<path d="M8 3v4H4M16 3v4h4M16 21v-4h4M8 21v-4H4"/>'),
  crop: svg('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M6 12h3M15 12h3M7.5 10.2 5.8 12l1.7 1.8M16.5 10.2l1.7 1.8-1.7 1.8"/>'),
  volume: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  mute: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" fill="currentColor"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
  audio: svg('<path d="M3 10v4M6 7.5v9M9 5v14M12 7.5v9M15 9.5v5M18 6v12M21 10v4"/>'),
  subtitles: svg('<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M6.5 13.5h4M13 13.5h4.5M6.5 16h7"/>'),
  network: svg('<path d="M4 18h2.5v-4H4ZM9 18h2.5V10H9ZM14 18h2.5V7H14ZM19 18h2.5V4H19Z" fill="currentColor"/>'),
  send: svg('<path d="M4 12 20 4l-5 16-3.5-6.5Z"/><path d="m11.5 13.5 3-3"/>'),
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
  const gestures = el('div', 'pp-gestures');
  const spinner = el('div', 'pp-spinner'); spinner.innerHTML = '<i></i>';
  // ── شاشة التحميل كما في الـAPK (LoadingStage.kt): بنر العمل معتّمًا وفوقه شعاره شفافًا يمتلئ لونًا من اليسار
  // بقدر ما بلغه التحميل فعلًا (مراحل المحرك من player.js) مع زحف زمني لا يتجاوز الثلث. بلا شعار: الاسم بعد
  // نصف ثانية. توقف أثناء المشاهدة: تعتيم فوق آخر إطار والشعار كاملًا يومض. ──
  const stage = el('div', 'pp-stage'); stage.hidden = true; stage.setAttribute('aria-hidden', 'true');
  const stageBg = el('img', 'pp-stage__bg'); stageBg.alt = ''; stageBg.decoding = 'async';
  const stageMark = el('div', 'pp-stage__mark'); stageMark.hidden = true;
  const logoGhost = el('img', 'pp-stage__logo'), logoFill = el('img', 'pp-stage__logo pp-stage__fill');
  logoGhost.alt = logoFill.alt = ''; stageMark.append(logoGhost, logoFill);
  const stageName = el('strong', 'pp-stage__name'); stageName.dir = 'auto'; stageName.hidden = true;
  stage.append(stageBg, el('i', 'pp-stage__scrim'), stageMark, stageName);
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
  peopleButton.onclick = () => openRoom();
  const fullTop = iconButton('full', 'ملء الشاشة (F أو F11)', () => cmd('fullscreen'));
  const hideBtn = iconButton('hide', 'إخفاء الأدوات (H)', () => hideControls()); hideBtn.hidden = true;
  top.append(iconButton('back', 'رجوع', () => cmd('close')), titles, hideBtn, iconButton('users', 'شاهد مع أصدقائك', () => openRoom()), iconButton('crop', 'ملء الصورة (قصّ الحواف)', () => cmd('fit', state.fit === 'fill' ? 'fit' : 'fill')), fullTop, iconButton('more', 'المزيد', () => showMore()));

  // ── الأسفل ──
  const bottom = el('div', 'pp-bottom');
  const times = el('div', 'pp-times'), timeNow = el('span', null, '0:00'), timeTotal = el('span', null, '0:00');
  times.append(timeNow, timeTotal);
  const bar = el('div', 'pp-bar'); bar.setAttribute('role', 'slider'); bar.setAttribute('aria-label', 'التقدّم'); bar.tabIndex = 0; bar.dataset.control = 'seek';
  const track = el('div', 'pp-track'), buffered = el('i', 'pp-buffered'), played = el('i', 'pp-played'), thumb = el('b', 'pp-thumb');
  track.append(buffered, played);
  const hoverTip = el('span', 'pp-hover'); hoverTip.hidden = true;
  // صورة مصغرة فوق المؤشر عند المرور أو السحب (كـCloudStream بطريقتنا): مربع يظهر بتلاشٍ وتكبير ناعم، والصورة من
  // المحرك لكل 10 ث (player.js ← services.previewFrame)، والوقت تحتها. بلا صورة بعد: الوقت وحده في المربع.
  const preview = el('div', 'pp-preview'); preview.setAttribute('aria-hidden', 'true');
  const previewImg = el('img', 'pp-preview__img'); previewImg.alt = ''; previewImg.decoding = 'async';
  const previewTime = el('span', 'pp-preview__time');
  preview.append(previewImg, previewTime);
  bar.append(track, el('span', 'pp-marks'), thumb, hoverTip, preview);

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
  // صور الأصحاب فوق mpv في طبقة ويندوز؛ تظهر وتختفي مع الأدوات (قرار المالك، overlay.css).
  root.append(stage, retry,gestures, spinner, status, controls, peopleButton, skipBtn, sheetScrim, sheet);
  doc.body.append(root);

  // ── الظهور والاختفاء ──
  let hideTimer = 0, overControls = false;
  function showControls(stay = false) {
    root.classList.add('pp--shown');
    timers.clearTimeout(hideTimer);
    if (!stay && state.ready) hideTimer = timers.setTimeout(() => { if (!overControls && sheet.hidden) root.classList.remove('pp--shown'); }, state.paused ? PAUSED_HIDE_AFTER_MS : HIDE_AFTER_MS);
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
  let previewWant = null, previewTimer = 0;
  function showPreview(ms) {
    const r = track.getBoundingClientRect(), w = 220;
    const x = Math.max(w / 2, Math.min((r.width || 1) - w / 2, (ms / state.duration) * (r.width || 1)));
    preview.style.left = `${x}px`;
    previewTime.textContent = clock(ms);
    const bucket = Math.round(ms / 10000) * 10000;
    const ready = state.thumb?.ms === bucket && state.thumb?.src;
    if (ready && previewImg.src !== state.thumb.src) previewImg.src = state.thumb.src;
    preview.classList.toggle('has-img', !!ready);
    preview.classList.add('is-on');
    hoverTip.hidden = true;
    if (bucket !== previewWant) {
      previewWant = bucket;
      timers.clearTimeout(previewTimer);
      previewTimer = timers.setTimeout(() => cmd('thumb', bucket), 120);
    }
  }
  const hidePreview = () => { preview.classList.remove('is-on'); timers.clearTimeout(previewTimer); };
  bar.addEventListener('pointermove', (e) => {
    if (dragging) { dragMs = msAt(e.clientX); paintTime(); }
    if (!state.duration) return;
    showPreview(dragging && dragMs != null ? dragMs : msAt(e.clientX));
  });
  const endDrag = () => { if (!dragging) return; dragging = false; bar.classList.remove('pp-bar--drag'); if (dragMs != null) cmd('seek', dragMs); hidePreview(); showControls(); };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);
  bar.addEventListener('pointerleave', () => { hoverTip.hidden = true; if (!dragging) hidePreview(); });

  function paintTime() {
    const d = Number(state.duration) || 0, t = dragging && dragMs != null ? dragMs : Number(state.position) || 0;
    timeNow.textContent = clock(t); timeTotal.textContent = clock(d);
    const p = d ? Math.min(1, t / d) : 0;
    played.style.width = `${p * 100}%`; thumb.style.left = `${p * 100}%`;
    buffered.style.width = `${d && state.bufferedMs ? Math.min(1, state.bufferedMs / d) * 100 : 0}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  }

  // ── اللوحات المنبثقة (Popover) بتصميم أوراق الـAPK ومقاس الكمبيوتر ──
  let openKind = null, anchorButton = null, keyboardNav = false;
  doc.addEventListener('keydown', () => { keyboardNav = true; }, true);
  doc.addEventListener('pointerdown', () => { keyboardNav = false; }, true);
  // لوحات «المزيد» الفرعية (التخطي والشبكة) تنبثق من زرّه نفسه كما تُفتح من ورقته في الـAPK
  const anchorFor = (kind) => kind === 'quality' ? qualityBtn : root.querySelector(`[data-action="${['skips', 'network', 'recommend'].includes(kind) ? 'more' : kind === 'room' ? 'users' : kind}"]`);
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
    if (['more', 'skips', 'network', 'recommend', 'room'].includes(openKind)) {
      const top = Math.max(12, (anchor.bottom ?? anchor.top) - bounds.top + 10);
      sheet.style.top = `${top}px`; sheet.style.bottom = 'auto';
      sheet.style.maxHeight = `${Math.max(80, height - top - 12)}px`;
    }
  }
  doc.defaultView?.addEventListener('resize', positionSheet);
  const releaseDiagnostics = diagnosticsUi.subscribe(() => {
    if (!sheet.hidden && openKind === 'more') showMore();
  });
  doc.defaultView?.addEventListener('pagehide', releaseDiagnostics, { once: true });
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
    // التركيز داخل اللوحة للوحة المفاتيح فقط: مع الفأرة كان إطار التركيز يظهر على أول صف بلا سبب
    if (keyboardNav) sheet.querySelector('button')?.focus();
    return body;
  }
  function closeSheet() {
    if (openKind === 'servers') cmd('servers-close');
    anchorButton?.setAttribute('aria-expanded', 'false');
    const restoreFocus = anchorButton; anchorButton = null;
    openKind = null; serverUi = null; offsetOut = null; networkBody = null; roomBody = null;
    root.classList.remove('pp--sheet');
    sheet.hidden = true; sheetScrim.hidden = true;
    if (keyboardNav) restoreFocus?.focus(); else doc.activeElement?.blur?.();
    showControls();
  }
  const sheetRow = (label, sub, { on = false, onClick = null, lead = null } = {}) => {
    const b = el(onClick ? 'button' : 'div', `pp-row-item${on ? ' is-on' : ''}`);
    if (onClick) { b.type = 'button'; b.onclick = () => onClick(); }
    // أيقونة البداية كـglyphView في PlayerActivity.kt (22dp بلون TEXT_2)
    if (lead && ICON[lead]) { const i = el('span', 'pp-row-item__lead'); i.innerHTML = ICON[lead]; b.append(i); }
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
  let subtitleTab = 'tracks', subtitleDraft = '';
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
        // «ترجمات إضافية» كالـAPK: ملف ترجمة برابط HTTPS (كان في «الإعدادات المتقدمة» المحذوفة)
        body.append(sectionLabel('ترجمات إضافية'));
        const form = el('form', 'pp-url'); form.dir = 'rtl';
        const input = el('input'); Object.assign(input, { type: 'url', placeholder: 'رابط ملف ترجمة https://…', value: subtitleDraft, spellcheck: false });
        input.dir = 'ltr'; input.setAttribute('aria-label', 'رابط ترجمة إضافية');
        input.oninput = () => { subtitleDraft = input.value; };
        const go = el('button', 'pp-url__go', 'تحميل'); go.type = 'submit';
        form.onsubmit = (e) => { e.preventDefault(); const url = input.value.trim(); if (!/^https:\/\/\S+$/i.test(url)) { input.setCustomValidity?.('الرابط يبدأ بـ https://'); input.reportValidity?.(); return; } input.setCustomValidity?.(''); cmd('subtitle-load', url); subtitleDraft = ''; input.value = ''; };
        form.append(input, go);
        body.append(form);
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
  // «المزيد» بترتيب الـAPK (PlayerActivity.showMore): التخطي ثم الشبكة. ملء الصورة وغرفة الأصدقاء لهما زرّان
  // في الشريط العلوي فلا يتكرران، و«الإعدادات المتقدمة» حُذفت: الترجمة الإضافية صارت في لوحة الترجمة.
  function showMore() {
    openSheet('more', 'المزيد', null, (body) => {
      if (state.skipStatus) body.append(sheetRow('تخطي المقدمة والنهاية', state.skipStatus, { lead: 'next', onClick: () => showSkips() }));
      body.append(sheetRow('الشبكة', netSummary(), { lead: 'servers', onClick: () => showNetwork() }));
      // PlayerActivity.showMore: «رشّح الحلقة لصديق» ← «الجميع» ثم الأصدقاء، وتصله في المجلس
      if (state.canRecommend) body.append(sheetRow(state.movie ? 'رشّح الفيلم لصديق' : 'رشّح الحلقة لصديق', 'تصله في المجلس ويفتحها من عندك', { lead: 'send', onClick: () => showRecommend() }));
      // PlayerActivity.showMore: «الحلقة التالية تلقائيًا» إيقاف/5/10/15 ث (الافتراضي 10)
      if (!state.movie && Number(state.total) > 1) {
        body.append(sectionLabel('الحلقة التالية تلقائيًا'));
        const cur = autoNextSeconds();
        body.append(chips([['إيقاف', cur === 0, 0], ['5 ث', cur === 5, 5], ['10 ث', cur === 10, 10], ['15 ث', cur === 15, 15]], (v) => { setAutoNext(v); showMore(); }));
      }
      if (state.together) {
        body.append(sectionLabel('مع أصدقائك'));
        const paintOffset = () => `${(state.videoOffsetMs ?? 0) > 0 ? '+' : (state.videoOffsetMs ?? 0) < 0 ? '−' : ''}${Math.abs((state.videoOffsetMs ?? 0) / 1000).toFixed(1)} ث`;
        const row = stepper('ديلاي فيديوي', paintOffset(), (d) => { cmd('video-offset', (state.videoOffsetMs ?? 0) + d * 500); });
        offsetOut = row.querySelector('output');
        body.append(row, el('small', 'pp-sub-hint', 'مصدرك متقدم عن أصحابك؟ زِد (+). متأخر؟ نقّص (−).'));
      }
    });
  }
  // لوحة الغرفة كـTogetherPlayer.openPanel في الـAPK: صف لكل عضو (صورته ونقطة حالته، اسمه، حالته ومصدره، وموضعه
  // ووسومه: المضيف/نسخة مختلفة/فرق)، ثم من لم يدخل بعد، ثم ديلاي فيديوي، ثم تحويل الوضع للمضيف، ثم الخروج.
  // في غرفة: الزر يفتح اللوحة هنا والفيديو ظاهر خلفها؛ بلا غرفة: دعوة الأصدقاء كما هي.
  let roomBody = null;
  const STATE_TEXT = { ready: 'جاهز', preparing: 'يجهّز', buffering: 'ينتظر البيانات', failed: 'تعذّر', playing: 'يشاهد', paused: 'متوقف' };
  function openRoom() { if (state.room) showRoom(); else cmd('room'); }
  function roomFace(p, cls) {
    const face = el('span', `pp-room__face ${cls}`);
    face.append(el('span', 'pp-room__letter', Array.from(String(p.name || '؟'))[0] || '؟'));
    if (typeof p.avatarKey === 'string' && /^(?:https?:\/\/|data:image\/)/i.test(p.avatarKey)) {
      const img = el('img', 'pp-room__img'); img.alt = ''; img.loading = 'lazy'; img.onerror = () => img.remove(); img.src = p.avatarKey; face.append(img);
    }
    return face;
  }
  function paintRoom(body) {
    const r = state.room; if (!r) { closeSheet(); return; }
    const synced = r.mode === 'sync';
    const head = sheet.querySelector('.pp-sheet__head');
    if (head) { head.querySelector('strong').textContent = synced ? 'مشاهدة معًا · متزامنة' : 'مشاهدة معًا · منفصلة'; }
    body.replaceChildren();
    const live = el('p', 'pp-room__live', `${r.members.length} في الغرفة · ${r.status === 'live' ? 'متصل' : r.status === 'reconnecting' ? 'يعيد الاتصال…' : 'يتصل…'}`);
    live.dataset.on = String(r.status === 'live');
    body.append(live);
    for (const m of r.members) {
      const row = el('div', 'pp-room__row');
      const who = el('div', 'pp-room__who');
      const face = roomFace(m, `is-${m.state}`); face.append(el('i', 'pp-room__dot'));
      const names = el('div', 'pp-room__names');
      names.append(el('strong', null, m.me ? 'أنت' : m.name), el('small', `pp-room__state is-${m.state}`, [STATE_TEXT[m.state] ?? 'في الغرفة', m.source].filter(Boolean).join(' · ')));
      who.append(face, names);
      const where = el('div', 'pp-room__where');
      const pos = el('b', null, m.posMs == null ? '—' : clock(m.posMs)); pos.dataset.pos = m.userId; where.append(pos);
      const tags = el('span', 'pp-room__tags');
      if (m.host) tags.append(el('em', 'is-host', 'المضيف'));
      if (m.sameVersion === false) tags.append(el('em', 'is-warn', 'نسخة مختلفة'));
      if (synced && !m.host && m.driftMs != null) { const d = el('em', null, `فرق ${Math.abs(m.driftMs)}ms`); d.dataset.drift = m.userId; tags.append(d); }
      if (tags.childElementCount) where.append(tags);
      row.append(who, where);
      body.append(row);
    }
    for (const p of r.pending) {
      const row = el('div', 'pp-room__row is-pending');
      const who = el('div', 'pp-room__who');
      who.append(roomFace(p, 'is-pending'), el('span', 'pp-room__wait', `${p.name} · لم يدخل بعد`));
      row.append(who); body.append(row);
    }
    if (synced) {
      const v = state.videoOffsetMs ?? 0;
      const step = stepper('ديلاي فيديوي', `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v / 1000).toFixed(1)} ث`, (d) => cmd('video-offset', (state.videoOffsetMs ?? 0) + d * 500));
      step.classList.add('pp-room__offset');
      body.append(step, el('small', 'pp-sub-hint', 'مصدرك متقدم عن أصحابك؟ زِد (+). متأخر؟ نقّص (−).'));
    }
    const actions = el('div', 'pp-room__actions');
    if (r.host) {
      const mode = el('button', 'pp-room__btn'); mode.type = 'button'; mode.textContent = synced ? 'حوّلها منفصلة' : 'حوّلها متزامنة';
      mode.onclick = () => cmd('room-mode', synced ? 'free' : 'sync'); actions.append(mode);
    }
    const leave = el('button', 'pp-room__btn is-leave'); leave.type = 'button'; leave.textContent = 'اطلع من الغرفة';
    leave.onclick = () => { closeSheet(); cmd('room-leave'); };
    actions.append(leave); body.append(actions);
  }
  function showRoom() {
    roomBody = openSheet('room', 'مشاهدة معًا', state.room?.label || null, (body) => paintRoom(body), 'pp-sheet--room');
  }
  // PlayerActivity.pickFriend: «الجميع» (المجلس) أولًا ثم الأصدقاء؛ الاختيار يرسل فورًا ويؤكد برسالة قصيرة
  function showRecommend() {
    openSheet('recommend', state.movie ? 'رشّح الفيلم' : `رشّح الحلقة ${state.episode ?? ''}`, 'تصله في المجلس ويفتحها من عندك', (body) => {
      const send = (id, name) => { closeSheet(); cmd('recommend', id); toast(id ? `انرسلت لـ ${name}` : 'انرسلت للمجلس'); };
      body.append(sheetRow('الجميع', 'كل أصدقائك في المجلس', { lead: 'users', onClick: () => send(null, 'الجميع') }));
      for (const f of state.friends ?? []) {
        const row = sheetRow(f.displayName, null, { onClick: () => send(f.userId, f.displayName) });
        const face = el('span', 'pp-row-item__face', Array.from(f.displayName || '؟')[0]);
        row.prepend(face);
        body.append(row);
      }
      if (!(state.friends ?? []).length) body.append(el('p', 'pp-note', 'ما عندك أصدقاء بعد؛ «الجميع» يوصلها للمجلس.'));
    });
  }
  // رسالة قصيرة فوق الأدوات (Toast كالـAPK message())
  const toastEl = el('div', 'pp-toast'); toastEl.setAttribute('role', 'status'); toastEl.hidden = true; root.append(toastEl);
  let toastTimer = 0;
  function toast(text) { toastEl.textContent = text; toastEl.hidden = false; timers.clearTimeout(toastTimer); toastTimer = timers.setTimeout(() => { toastEl.hidden = true; }, 2600); }
  // PlayerActivity.showSkips
  function showSkips() {
    openSheet('skips', 'تخطي المقدمة والنهاية', null, (body) => {
      body.append(sheetRow('توقيت هذه الحلقة', state.skipStatus ?? '—', { on: true }));
      body.append(el('p', 'pp-note', 'يظهر زر التخطي أثناء المقدمة أو النهاية. تخطي النهاية يُبقي المشاهد التي تأتي بعدها.'));
      body.append(sheetRow('إعادة جلب التوقيت', state.skipPending ? 'جارٍ الجلب…' : 'جرّب مجددًا بعد عودة الاتصال', { onClick: state.skipPending ? null : () => { cmd('skip-refetch'); } }));
    });
  }

  // ── قياس الشبكة كالـAPK (showNetwork + netSummary + metricRow) من أحداث المشغل والمحرك الحقيقية ──
  const NET_CHIP_KEY = 'vantara.player.netChip';
  // التفضيل محفوظ في التخزين المحلي، ومعه نسخة في الذاكرة إن كان التخزين محجوبًا
  let chipMemory = null;
  const chipOn = () => { try { const v = globalThis.localStorage?.getItem(NET_CHIP_KEY); if (v != null) return v === '1'; } catch {} return chipMemory === true; };
  const setChip = (on) => { chipMemory = on; try { globalThis.localStorage?.setItem(NET_CHIP_KEY, on ? '1' : '0'); } catch {} };
  const mbps = (bps) => (Number.isFinite(bps) ? `${(bps * 8 / 1e6).toFixed(1)} Mbps` : '— Mbps');
  const secs = (ms) => (Number.isFinite(ms) ? (ms / 1000).toFixed(1) : '—');
  function netFacts() {
    const n = state.net ?? {}, st = n.stages ?? {};
    const torrent = Number.isFinite(n.peers) || st['engine-start'] != null;
    // التورنت: من بدء المحرك إلى بدء تنزيل الملف. غيره: من فتح الجلسة إلى أول إطار
    const prep = torrent ? (st.downloading != null && st['engine-start'] != null ? st.downloading - st['engine-start'] : null) : st.ready ?? null;
    const aheadS = Number.isFinite(n.aheadMs) ? Math.floor(n.aheadMs / 1000) : null;
    return { n, st, torrent, prep, aheadS };
  }
  function netSummary() {
    const { n, torrent, prep, aheadS } = netFacts();
    const iso = (t) => `\u2066${t}\u2069`; // عزل LTR: «1800 ms» و«13.5 Mbps» لا تتبعثر داخل سطر عربي
    return `${iso(prep != null ? `${prep} ms` : '— ms')} · ${iso(mbps(n.inputBps))} · ${aheadS ?? 0} ث${torrent && Number.isFinite(n.peers) ? ` · ${n.peers} مشارك` : ''}`;
  }
  const metricRow = (name, value, tone = 'text', wide = false) => {
    const r = el('div', `pp-metric pp-metric--${tone}${wide ? ' pp-metric--wide' : ''}`);
    const v = el('b', null, value); v.dir = wide ? 'rtl' : 'ltr';
    r.append(el('span', null, name), v);
    return r;
  };
  function paintNetwork(body) {
    const { n, st, torrent, prep, aheadS } = netFacts();
    body.replaceChildren();
    body.append(metricRow(torrent ? 'تجهيز التورنت' : 'زمن البدء', prep != null ? `${prep} ms` : 'لم يُقس بعد', prep == null ? 'mute' : prep < 300 ? 'ok' : prep < 800 ? 'warn' : 'bad'));
    body.append(metricRow('السرعة الآن', mbps(n.inputBps)));
    body.append(metricRow('جاهز أمامك', aheadS != null ? `${aheadS} ثانية` : '—', aheadS == null ? 'mute' : aheadS >= 15 ? 'ok' : aheadS >= 5 ? 'warn' : 'bad'));
    if (Number.isFinite(n.videoHeight)) body.append(metricRow('الفيديو', `${n.videoHeight}p${Number.isFinite(n.videoBps) && n.videoBps > 0 ? ` · ${(n.videoBps / 1e6).toFixed(1)} Mbps` : ''}`, 'soft'));
    if (torrent) {
      body.append(metricRow('مشاركون متصلون', Number.isFinite(n.peers) ? `${n.peers}${Number.isFinite(n.seeds) ? ` (زارعون ${n.seeds})` : ''}` : '—', n.peers > 0 ? 'ok' : 'bad'));
      const need = Number.isFinite(n.videoBps) && n.videoBps > 0 ? n.videoBps / 8 : null;
      const tone = !Number.isFinite(n.torrentBps) ? 'mute' : need == null ? 'text' : n.torrentBps >= need * 1.5 ? 'ok' : n.torrentBps >= need ? 'warn' : 'bad';
      body.append(metricRow('تحميل التورنت', mbps(n.torrentBps), tone));
      if (need != null) body.append(metricRow('يحتاج الفيديو', mbps(need), 'soft'));
    }
    const at = (k) => (st[k] != null ? `+${secs(st[k])}` : '—');
    const line = [`تجهيز ${secs(st['player-start'])}`, torrent ? `المحرك ${at('engine-ready')}` : null, torrent ? `تحميل ${at('downloading')}` : null, `المشغّل ${at('player-start')}`, `إطار ${at('ready')}`].filter(Boolean).join(' · ') + ' ث';
    body.append(metricRow('تسلسل البدء', line, 'soft', true));
    if (state.serverCode) body.append(metricRow('السيرفر', state.serverCode, 'mute'));
    body.append(sheetRow('إظهار القياس فوق الفيديو', 'زمن الاستجابة · السرعة · الجاهز', { on: chipOn(), onClick: () => {
      setChip(!chipOn());
      paintChip(); paintNetwork(body);
    } }));
  }
  let networkBody = null;
  function showNetwork() {
    networkBody = openSheet('network', 'الشبكة', 'قياس حي من طلبات هذا الفيديو نفسها', (body) => paintNetwork(body), 'pp-sheet--network');
  }
  // ── الحلقة التالية تلقائيًا (PlayerActivity.onEnded): بطاقة أسفل اليسار بعدّ تنازلي، «شغّل الآن» و«إلغاء» ──
  const AUTO_NEXT_KEY = 'vantara.player.autoNext';
  let autoMemory = null;
  const autoNextSeconds = () => { try { const v = globalThis.localStorage?.getItem(AUTO_NEXT_KEY); if (v != null && [0, 5, 10, 15].includes(Number(v))) return Number(v); } catch {} return autoMemory ?? 10; };
  const setAutoNext = (v) => { autoMemory = v; try { globalThis.localStorage?.setItem(AUTO_NEXT_KEY, String(v)); } catch {} };
  const nextCard = el('div', 'pp-next'); nextCard.dir = 'rtl'; nextCard.hidden = true; nextCard.setAttribute('role', 'status');
  const nextKicker = el('small', null, 'الحلقة التالية'), nextTitle = el('strong'), nextCount = el('span');
  const nextRow = el('div', 'pp-next__row');
  const nextNow = el('button', 'pp-next__btn pp-next__btn--primary', 'شغّل الآن'), nextCancel = el('button', 'pp-next__btn', 'إلغاء');
  nextNow.type = nextCancel.type = 'button';
  nextRow.append(nextNow, nextCancel);
  nextCard.append(nextKicker, nextTitle, nextCount, nextRow);
  root.append(nextCard);
  let nextTimer = 0;
  const stopNext = () => { timers.clearInterval?.(nextTimer); nextTimer = 0; nextCard.hidden = true; };
  const playNext = (n) => { stopNext(); cmd('episode', n); };
  nextNow.onclick = (e) => { e.stopPropagation(); playNext(Number(state.episode) + 1); };
  nextCancel.onclick = (e) => { e.stopPropagation(); stopNext(); };
  function startNext() {
    showControls(true);
    const seconds = autoNextSeconds(), n = Number(state.episode) + 1;
    // الغرفة يتحكم بها المضيف، والفيلم والحلقة الأخيرة بلا تالية
    if (seconds <= 0 || state.together || state.movie || !(Number(state.total) >= n) || state.canChangeEpisode === false) return;
    let left = seconds;
    nextTitle.textContent = `الحلقة ${n}`;
    const tick = () => { if (left <= 0) return playNext(n); nextCount.textContent = `تبدأ خلال ${left} ث`; left--; };
    nextCard.hidden = false; tick();
    timers.clearInterval?.(nextTimer); nextTimer = timers.setInterval?.(tick, 1000) ?? 0;
  }

  // شريحة القياس فوق الفيديو (netChip في الـAPK): تبقى ظاهرة أثناء المشاهدة متى فُعّلت
  const netChip = el('div', 'pp-netchip'); netChip.dir = 'rtl'; netChip.hidden = true; netChip.setAttribute('aria-hidden', 'true');
  root.append(netChip);
  function paintChip() {
    netChip.hidden = !chipOn() || !!state.status?.error;
    if (!netChip.hidden) netChip.textContent = netSummary();
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
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName ?? '')) return;
    if (sheet.hidden && ['c', 'C'].includes(e.key)) { e.preventDefault(); showSubtitles(); return; }
    if (sheet.hidden && ['h', 'H'].includes(e.key)) { e.preventDefault(); if (root.classList.contains('pp--shown')) hideControls(); else showControls(); return; }
    if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'f', 'F', 'Escape', 'm', 'M'].includes(e.key)) { e.preventDefault(); showControls(); cmd('key', e.key); }
  });

  const safeArt = (url) => (typeof url === 'string' && /^https:\/\//i.test(url) ? url : null);
  let stageMode = null, stageStart = 0, stageProgress = 0, stageEpoch = null, stageLogo = null, stageBgSrc = null;
  let stageTick = 0, stageNameTimer = 0, stageShowTimer = 0, stageHideTimer = 0;
  const paintFill = () => {
    const p = stageMode === 'startup' ? stageProgress : 1;
    logoFill.style.clipPath = `inset(0 ${Math.round((1 - p) * 1000) / 10}% 0 0)`;
    stageName.style.opacity = stageMode === 'startup' ? String(0.35 + 0.65 * p) : '';
  };
  const advanceStage = () => {
    if (stageMode !== 'startup') return;
    const creep = Math.min(1 / 3, ((Date.now() - stageStart) / 15000) / 3);
    const next = Math.min(0.97, Math.max(stageProgress, Number(state.loadProgress) || 0, creep));
    if (next > stageProgress) { stageProgress = next; paintFill(); }
  };
  function paintArt() {
    const art = state.art ?? {}, bg = safeArt(art.backdrop), logo = safeArt(art.logo);
    if (bg !== stageBgSrc) {
      stageBgSrc = bg; stage.classList.remove('pp-stage--bg');
      if (bg) { stageBg.onload = () => { if (stageBgSrc === bg) stage.classList.add('pp-stage--bg'); }; stageBg.src = bg; } else stageBg.removeAttribute('src');
    }
    if (logo !== stageLogo) {
      stageLogo = logo; stageMark.hidden = true;
      if (logo) {
        logoFill.onload = () => { if (stageLogo !== logo) return; stageMark.hidden = false; stageName.hidden = true; timers.clearTimeout(stageNameTimer); };
        logoFill.onerror = () => { if (stageLogo === logo) { stageLogo = null; stageMark.hidden = true; if (stageMode) stageName.hidden = false; } };
        logoGhost.src = logoFill.src = logo;
      }
    }
    stageName.textContent = state.title ?? '';
    stage.setAttribute('aria-label', state.title ?? '');
  }
  function showStage(mode) {
    timers.clearTimeout(stageHideTimer);
    if (stageMode === mode && !stage.hidden) return;
    stageMode = mode;
    if (mode === 'startup') { stageStart = Date.now(); stageProgress = 0; }
    stage.className = `pp-stage pp-stage--${mode}${stageBgSrc && stage.classList.contains('pp-stage--bg') ? ' pp-stage--bg' : ''}`;
    stage.hidden = false;
    // الاسم بديل الشعار فقط إن لم يصل خلال نصف ثانية، فلا يومض نص ثم يُستبدل بالشعار
    timers.clearTimeout(stageNameTimer);
    if (stageMark.hidden) { stageName.hidden = true; stageNameTimer = timers.setTimeout(() => { if (stageMark.hidden && stageMode) stageName.hidden = false; }, 500); }
    timers.clearInterval?.(stageTick);
    if (mode === 'startup') stageTick = timers.setInterval?.(advanceStage, 200) ?? 0;
    paintFill();
  }
  function finishStage() {
    timers.clearInterval?.(stageTick); timers.clearTimeout(stageShowTimer); stageShowTimer = 0;
    if (!stageMode) return;
    // 100%: يكتمل الشعار ثم تتلاشى الشاشة عن الفيديو خلال ~300ms
    stageProgress = 1; paintFill();
    stage.classList.add('pp-stage--out');
    stageMode = null;
    stageHideTimer = timers.setTimeout(() => { if (!stageMode) { stage.hidden = true; stage.classList.remove('pp-stage--out'); } }, 300);
  }
  function paintStage() {
    paintArt();
    const failed = !!state.status?.error;
    const startup = !state.ready && !failed;
    const stalled = !!state.ready && !!state.buffering && !state.paused && !failed;
    if (startup) {
      timers.clearTimeout(stageShowTimer); stageShowTimer = 0;
      if (stageEpoch !== state.loadEpoch && stageMode === 'startup') { stageStart = Date.now(); stageProgress = 0; }
      stageEpoch = state.loadEpoch;
      showStage('startup'); advanceStage();
    } else if (stalled) {
      // أثناء المشاهدة بعد مهلة قصيرة فقط، فلا يومض الشعار مع كل توقف لحظي
      if (stageMode !== 'stalled' && !stageShowTimer) stageShowTimer = timers.setTimeout(() => { stageShowTimer = 0; if (state.ready && state.buffering && !state.paused) showStage('stalled'); }, 450);
      else if (stageMode === 'startup') finishStage();
    } else {
      timers.clearTimeout(stageShowTimer); stageShowTimer = 0;
      if (failed) { timers.clearInterval?.(stageTick); stageMode = null; stage.hidden = true; }
      else finishStage();
    }
    spinner.hidden = spinner.hidden || !stage.hidden;
  }

  function update(next) {
    const previous = state;
    state = { ...state, ...next };
    if (state.volume > 0) state.lastVolume = state.volume;
    root.dataset.tone = state.tone === 'cinema' ? 'cinema' : 'anime';
    titleEl.textContent = state.title ?? '';
    subEl.textContent = state.subtitle ?? '';
    playBtn.innerHTML = state.paused || !state.ready ? ICON.play : ICON.pause;
    playBtn.setAttribute('aria-label', state.paused ? 'تشغيل' : 'إيقاف مؤقت');
    spinner.hidden = !(state.buffering || !state.ready) || !!state.status?.error;
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
    paintStage();
    if (offsetOut && openKind === 'more') { const v = state.videoOffsetMs ?? 0; offsetOut.textContent = `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v / 1000).toFixed(1)} ث`; }
    if (openKind === 'servers' && JSON.stringify([previous.routes,previous.routesDone,previous.candidate,previous.ready]) !== JSON.stringify([state.routes,state.routesDone,state.candidate,state.ready])) paintServers();
    paintChip();
    if (preview.classList.contains('is-on') && state.thumb !== previous.thumb && state.thumb?.ms === previewWant && state.thumb?.src) { previewImg.src = state.thumb.src; preview.classList.add('has-img'); }
    if (state.ended && !previous.ended) startNext();
    else if (!state.ended && previous.ended) stopNext();
    if (openKind === 'room' && roomBody) {
      // الموضع والفرق يتغيران مع كل تقرير: يُحدَّثان في مكانهما، ولا يُعاد بناء اللوحة (والزر تحت الفأرة) إلا إن تغيّر ما فيها
      const shape = (s) => JSON.stringify([s.room && { ...s.room, members: s.room.members.map(({ posMs, driftMs, ...m }) => ({ ...m, drift: driftMs != null })) }, s.videoOffsetMs]);
      if (shape(previous) !== shape(state)) paintRoom(roomBody);
      else {
        const byId = new Map((state.room?.members ?? []).map((m) => [m.userId, m]));
        for (const n of roomBody.querySelectorAll('[data-pos]')) { const m = byId.get(n.dataset.pos); if (m) n.textContent = m.posMs == null ? '—' : clock(m.posMs); }
        for (const n of roomBody.querySelectorAll('[data-drift]')) { const m = byId.get(n.dataset.drift); if (m?.driftMs != null) n.textContent = `فرق ${Math.abs(m.driftMs)}ms`; }
      }
    }
    if (openKind === 'network' && networkBody && JSON.stringify([previous.net, previous.serverCode]) !== JSON.stringify([state.net, state.serverCode])) paintNetwork(networkBody);
    if (openKind === 'skips' && (previous.skipStatus !== state.skipStatus || previous.skipPending !== state.skipPending)) showSkips();
    if (openKind === 'subtitles' && subtitlesBody && (JSON.stringify(previous.subtitles) !== JSON.stringify(state.subtitles) || previous.subtitleDelay !== state.subtitleDelay || previous.subtitleSize !== state.subtitleSize || previous.subtitlePosition !== state.subtitlePosition || previous.subtitleBackground !== state.subtitleBackground)) subtitlesPaint(subtitlesBody);
    // بدأ التشغيل أو استؤنف: يبدأ عدّاد الإخفاء (كان لا يبدأ إلا بعد إيقاف ثم تشغيل)
    hideBtn.hidden = !(state.ready && state.paused);
    if (!state.ready) { if (!root.classList.contains('pp--shown') || previous.ready !== state.ready) showControls(true); }
    else if (state.paused) { if (previous.paused !== state.paused || previous.ready !== state.ready) showControls(); }
    else if (previous.paused || !previous.ready) showControls();
  }
  showControls(true);
  return { root, update, closeSheet, open: { servers: showServers, episodes: showEpisodes, quality: showQuality, subtitles: showSubtitles, audio: showAudio, speed: showSpeed, more: showMore, skips: showSkips, network: showNetwork, recommend: () => showRecommend(), room: () => showRoom() } };
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
