/**
 * طبقة أدوات مشغل ويندوز — نفس تصميم مشغل الـAPK (PlayerActivity.kt) ونفس عناصر مشغل الويب
 * (pwa/player/player.js): تدرّج أعلى بالرجوع والعنوان والحلقة وملء الصورة وملء الشاشة والمزيد،
 * وتدرّج أسفل بالوقت وشريط التقدّم، ثم صف: [الصوت، التالية، الحلقات، السيرفرات] ·
 * [−10، تشغيل دائري، +10] · [الجودة، الترجمة، السرعة، ملء الشاشة]. الأوراق من الأسفل.
 *
 * هذه الصفحة عرض فقط: تُرسم من «الحالة» التي يرسلها player.js، وكل لمسة أمرٌ يعود إليه.
 * لا تشغيل هنا ولا شبكة؛ الفيديو نافذة mpv الأصلية تحت هذه النافذة الشفافة.
 */
import { createServerSheet } from '../v35/server-sheet.js';

const HIDE_AFTER_MS = 3500;
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
  const root = el('div', 'pwa-player v35');
  root.dir = 'ltr';
  const gestures = el('div', 'pp-gestures');
  const spinner = el('div', 'pp-spinner'); spinner.innerHTML = '<i></i>';
  const status = el('div', 'pp-status'); status.setAttribute('role', 'status');

  // ── الأعلى ──
  const controls = el('div', 'pp-controls'); controls.dir = 'ltr';
  const top = el('div', 'pp-top');
  const titles = el('div', 'pp-titles'); titles.dir = 'auto';
  const titleEl = el('strong'), subEl = el('small');
  titleEl.dir = 'auto'; subEl.dir = 'auto'; // «الحلقة 3» لا تنقلب خلف عنوان إنجليزي
  titles.append(titleEl, subEl);
  const fullTop = iconButton('full', 'ملء الشاشة (F)', () => cmd('fullscreen'));
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
  const fullBottom = iconButton('full', 'ملء الشاشة (F)', () => cmd('fullscreen'), 'pp-desk');
  right.append(qualityBtn, iconButton('subtitles', 'الترجمة (C)', () => showSubtitles(), 'pp-desk'), iconButton('speed', 'السرعة', () => showSpeed()), fullBottom);
  row.append(left, center, right);
  bottom.append(times, bar, row);
  controls.append(el('div', 'pp-shade pp-shade--top'), el('div', 'pp-shade pp-shade--bottom'), top, bottom);

  const skipBtn = el('button', 'pp-skip'); skipBtn.type = 'button'; skipBtn.hidden = true;
  skipBtn.onclick = (e) => { e.stopPropagation(); cmd('skip'); };
  const sheetScrim = el('div', 'pp-scrim'); sheetScrim.hidden = true;
  const sheet = el('div', 'pp-sheet'); sheet.dir = 'rtl'; sheet.hidden = true;
  sheetScrim.onclick = () => closeSheet();
  root.append(gestures, spinner, status, controls, skipBtn, sheetScrim, sheet);
  doc.body.append(root);

  // ── الظهور والاختفاء ──
  let hideTimer = 0, overControls = false;
  function showControls(stay = false) {
    root.classList.add('pp--shown');
    timers.clearTimeout(hideTimer);
    if (!stay && !state.paused && state.ready) hideTimer = timers.setTimeout(() => { if (!overControls && sheet.hidden) root.classList.remove('pp--shown'); }, HIDE_AFTER_MS);
  }
  const hideControls = () => { timers.clearTimeout(hideTimer); root.classList.remove('pp--shown'); };
  root.addEventListener('mousemove', () => showControls());
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
  let openKind = null;
  function openSheet(kind, title, subtitle, build, modifier = '') {
    openKind = kind;
    sheet.className = `pp-sheet${modifier ? ` ${modifier}` : ''}`;
    sheet.replaceChildren(el('i', 'pp-sheet__grip'));
    const head = el('div', 'pp-sheet__head');
    head.append(el('strong', null, title));
    if (subtitle) head.append(el('small', null, subtitle));
    const body = el('div', 'pp-sheet__body');
    sheet.append(head, body);
    build(body);
    sheet.hidden = false; sheetScrim.hidden = false;
    hideControls();
    root.classList.add('pp--sheet');
    return body;
  }
  function closeSheet() {
    if (openKind === 'servers') cmd('servers-close');
    openKind = null; serverUi = null; offsetOut = null;
    root.classList.remove('pp--sheet');
    sheet.hidden = true; sheetScrim.hidden = true;
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

  let serverUi = null;
  function showServers() {
    const body = openSheet('servers', 'السيرفرات', null, () => {}, 'pp-sheet--servers');
    serverUi = createServerSheet(body, { el, title: state.title ?? 'VANTARA', kicker: state.movie ? 'فيلم' : `الحلقة ${state.episode ?? ''}`,
      onBack: () => closeSheet(), onPick: (route) => { closeSheet(); cmd('pick', route.id); }, onBest: () => { closeSheet(); cmd('best'); } });
    paintServers();
    cmd('servers-open');
  }
  function paintServers() {
    if (!serverUi || !state.routes) return;
    serverUi.update({ routes: state.routes, current: state.currentRoute ?? null, settled: !!state.routesDone, status: { text: state.routesDone ? '' : 'نجلب السيرفرات…', spin: !state.routesDone } });
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
  function showSubtitles() {
    const paint = (body) => {
      body.replaceChildren();
      const tracks = state.subtitles ?? [];
      body.append(sheetRow('بدون ترجمة', null, { on: !tracks.some((t) => t.selected), onClick: () => cmd('subtitle-off') }));
      for (const t of tracks) body.append(sheetRow(t.label, t.lang && t.lang !== 'und' ? t.lang : null, { on: !!t.selected, onClick: () => cmd('subtitle-select', t.id) }));
      if (!tracks.length) body.append(el('p', 'pp-note', 'نبحث عن ترجمات لهذه الحلقة… تظهر هنا فور وصولها.'));
      body.append(sectionLabel('ضبط الترجمة'));
      body.append(stepper('التوقيت', `${((state.subtitleDelay ?? 0) / 1000).toFixed(1)} ث`, (d) => cmd('subtitle-delay', (state.subtitleDelay ?? 0) + d * 500)));
      body.append(stepper('الحجم', String(state.subtitleSize ?? 40), (d) => cmd('subtitle-size', Math.max(20, Math.min(80, (state.subtitleSize ?? 40) + d * 4)))));
      body.append(el('small', 'pp-sub-hint', '+ يؤخر الترجمة، − يقدمها'));
    };
    subtitlesBody = openSheet('subtitles', 'الترجمة', null, paint, 'pp-sheet--subtitles');
    subtitlesPaint = paint;
  }
  let subtitlesBody = null, subtitlesPaint = null, offsetOut = null;
  function showSpeed() {
    openSheet('speed', 'السرعة', state.synced ? 'السرعة تتبع مزامنة الغرفة' : null, (body) => {
      for (const sp of SPEEDS) body.append(sheetRow(sp === 1 ? 'عادية' : `${sp}×`, null, { on: (state.speed ?? 1) === sp, onClick: state.synced ? null : () => { closeSheet(); cmd('speed', sp); } }));
    });
  }
  function showMore() {
    openSheet('more', 'المزيد', null, (body) => {
      body.append(sheetRow('ملء الصورة', state.fit === 'fill' ? 'مفعّل: تُقصّ الحواف' : 'الصورة كاملة بلا قص', { on: state.fit === 'fill', onClick: () => { closeSheet(); cmd('fit', state.fit === 'fill' ? 'fit' : 'fill'); } }));
      body.append(sheetRow('شاهد مع أصدقائك', 'ادعُ أصدقاءك لنفس الحلقة', { onClick: () => { closeSheet(); cmd('room'); } }));
      if (state.together) {
        body.append(sectionLabel('مع أصدقائك'));
        const paintOffset = () => `${(state.videoOffsetMs ?? 0) > 0 ? '+' : (state.videoOffsetMs ?? 0) < 0 ? '−' : ''}${Math.abs((state.videoOffsetMs ?? 0) / 1000).toFixed(1)} ث`;
        const row = stepper('ديلاي فيديوي', paintOffset(), (d) => { cmd('video-offset', (state.videoOffsetMs ?? 0) + d * 500); });
        offsetOut = row.querySelector('output');
        body.append(row, el('small', 'pp-sub-hint', 'مصدرك متقدم عن أصحابك؟ زِد (+). متأخر؟ نقّص (−).'));
      }
      if ((state.audio ?? []).length > 1) {
        body.append(sectionLabel('الصوت'));
        for (const a of state.audio) body.append(sheetRow(a.label, a.lang && a.lang !== 'und' ? a.lang : null, { on: !!a.selected, onClick: () => { closeSheet(); cmd('audio-select', a.id); } }));
      }
      body.append(sectionLabel('الشبكة'));
      const net = el('div', 'pp-net');
      net.append(el('span', null, 'السرعة'), el('b', null, state.net?.kbps != null ? `${(state.net.kbps / 1024).toFixed(1)} MB/s` : '—'));
      if (state.net?.peers != null) net.append(el('span', null, 'المشاركون'), el('b', null, String(state.net.peers)));
      net.append(el('span', null, 'السيرفر'), el('b', null, state.serverCode ?? '—'));
      body.append(net);
    });
  }

  // ── لوحة المفاتيح: كلها تعود لـplayer.js (نفس اختصارات النافذة الرئيسية) ──
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) { e.preventDefault(); closeSheet(); return; }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName ?? '')) return;
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
    spinner.hidden = !(state.buffering || !state.ready) || !!state.status?.error;
    root.classList.toggle('pp--loading', !state.ready);
    status.textContent = state.status?.text ?? '';
    status.dataset.error = String(!!state.status?.error);
    nextBtn.hidden = state.movie || !(Number(state.total) > Number(state.episode));
    nextBtn.disabled = state.canChangeEpisode === false;
    qualityBtn.textContent = state.qualityLabel || badgeOf(state.quality);
    volRange.value = String(state.volume ?? 100);
    volBtn.innerHTML = (state.volume ?? 100) > 0 ? ICON.volume : ICON.mute;
    fullTop.innerHTML = fullBottom.innerHTML = state.fullscreen ? ICON.fullExit : ICON.full;
    if (state.skip) { skipBtn.hidden = false; skipBtn.textContent = state.skip; } else skipBtn.hidden = true;
    paintTime();
    if (offsetOut && openKind === 'more') { const v = state.videoOffsetMs ?? 0; offsetOut.textContent = `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v / 1000).toFixed(1)} ث`; }
    if (openKind === 'servers') paintServers();
    if (openKind === 'subtitles' && subtitlesBody && (previous.subtitles !== state.subtitles || previous.subtitleDelay !== state.subtitleDelay || previous.subtitleSize !== state.subtitleSize)) subtitlesPaint(subtitlesBody);
    if (!state.ready || state.paused) showControls(true);
    else if (previous.paused && !state.paused) showControls();
  }
  showControls(true);
  return { root, update, closeSheet, open: { servers: showServers, episodes: showEpisodes, quality: showQuality, subtitles: showSubtitles, speed: showSpeed, more: showMore } };
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
