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

import { candidatePaths, addonMedia } from '../../addons/media.js';
import { createSubtitleSession } from './subtitles.js';
import { nextEpisodeCopies } from '../../addons/video.js';
import { SUBTITLE_SIZES } from './subtitle-adjustments.js';
import { createTogetherPlayer } from './together-player.js';
import { connectionLabel } from '../../v35/together.js';
import { renderLobby, pendingInvitees } from './together-lobby.js';
import { episodeLine, mediaKind, resolveArt } from '../../lib/together/art.js';
import { activeSegment, loadSkipTimes, skipStatusText } from './skip-times.js';
import { openMomentComposer } from '../../v35/moment-compose.js';
import { openMomentViewer } from '../../v35/moment-viewer.js';
import { exportBrowserMoment } from '../../lib/moment-export.js';

const START_TIMEOUT_MS = 15_000;
const REPORT_EVERY_MS = 5_000;
/** أقصر من هذا ليس حلقة ولا فيلمًا: صورة خطأ يبثّها المضيف بدل الفيديو. */
export const MIN_REAL_DURATION_S = 45;
/** توقّف بلا تقدّم وهو يُفترض أنه يعمل ⇒ هذا الطريق مات. */
const STALL_MS = 15_000;
const HIDE_AFTER_MS = 3_500;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** روابط الاستضافة تنتهي سريعًا: الحلقة التالية تُجهَّز في آخر 4 دقائق فقط (NextEpisodeWarmup.kt). */
const WARMUP_WINDOW_MS = 4 * 60_000;
const VOLUME_KEY = 'vantara.player.volume';

/** يجهّز الحلقة التالية الآن؟ نفس شرط الـAPK. */
export const shouldWarmNext = (durationMs, positionMs) => durationMs > 0 && positionMs >= 0 && positionMs < durationMs && durationMs - positionMs <= WARMUP_WINDOW_MS;

/** اختصارات الكيبورد في الكمبيوتر — مصدر واحد للتنفيذ ولورقة «الاختصارات». */
export const SHORTCUTS = [
  ['مسافة / K', 'تشغيل وإيقاف'],
  ['→ / L', 'تقديم 10 ثوانٍ (مع Shift: 30)'],
  ['← / J', 'رجوع 10 ثوانٍ (مع Shift: 30)'],
  ['↑ / ↓', 'رفع وخفض الصوت'],
  ['M', 'كتم الصوت'],
  ['F / نقرتان', 'ملء الشاشة'],
  ['S', 'تخطي المقدمة أو النهاية'],
  ['N', 'الحلقة التالية'],
  ['C', 'الترجمة'],
  ['< / >', 'إبطاء وتسريع'],
  ['0 – 9', 'انتقل إلى 0%–90% من الحلقة'],
  ['Esc', 'إغلاق اللوحة أو المشغّل'],
];

const readVolume = () => {
  try {
    const v = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? 'null');
    return { volume: Math.max(0, Math.min(1, Number(v?.volume ?? 1))), muted: v?.muted === true };
  } catch { return { volume: 1, muted: false }; }
};
const saveVolume = (volume, muted) => {
  try { localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume, muted })); } catch { /* تفضيل محلي فقط */ }
};

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
    s.src = '/vendor/hls.min.js';
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

/** الجودات المعلنة، مع الحفاظ على 4K و1440p. */
export const bucket = (q) => (q ? (q >= 2000 ? 2160 : q >= 1400 ? 1440 : q >= 1000 ? 1080 : q >= 700 ? 720 : q >= 460 ? 480 : 360) : null);
const fmtQ = (q) => (bucket(q) ? `${bucket(q)}p` : '');
const badgeOf = (q) => (!q ? 'Auto' : bucket(q) >= 2160 ? 'UHD' : bucket(q) >= 1440 ? 'QHD' : bucket(q) >= 1080 ? 'FHD' : bucket(q) >= 720 ? 'HD' : 'SD');

export function clock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** Account attribution travels with the event so a later account switch cannot redirect it. */
export function momentSendPayload(args, selection) {
  return {
    userId: args.usageUserId ?? args.presenceUserId ?? null,
    seriesRef: selection.work.ref, seriesTitle: selection.work.title, coverUrl: selection.work.cover ?? null,
    chapterLabel: `${selection.episode == null ? 'الفيلم' : `الحلقة ${selection.episode}`} · ${clock(selection.startMs / 1000)}–${clock(selection.endMs / 1000)}`,
    chapterNumber: selection.episode, moment: selection.moment, toIds: selection.toIds,
    broadcast: selection.broadcast, ...(selection.message ? { message: selection.message } : {}),
  };
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
  camera: svg('<path d="M8 6.5 9.5 4h5L16 6.5h3A2 2 0 0 1 21 8.5v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/>'),
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
  crop: svg('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M6 12h3M15 12h3M7.5 10.2 5.8 12l1.7 1.8M16.5 10.2l1.7 1.8-1.7 1.8"/>'),
  fullExit: svg('<path d="M8 3v4H4M16 3v4h4M16 21v-4h4M8 21v-4H4"/>'),
  volume: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  volumeLow: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6"/>'),
  mute: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" fill="currentColor"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
  subtitles: svg('<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M6.5 13.5h4M13 13.5h4.5M6.5 16h7"/>'),
  skip: svg('<path d="M4 6 11 12 4 18Z M12 6l7 6-7 6Z"/>', { fill: true }),
  network: svg('<path d="M4 18h2.5v-4H4ZM9 18h2.5V10H9ZM14 18h2.5V7H14ZM19 18h2.5V4H19Z" fill="currentColor"/>'),
  keyboard: svg('<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7.5 14h9"/>'),
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
  const together = args.together?.session ? args.together : null;
  let tg = null;
  let releaseTogether = () => {};
  let momentComposer = null, momentPreview = null;
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
    cancelAttempt: null,
    mediaGeneration: 0,
    started: false,
    locked: false,
    fill: false,
    speed: 1,
    level: -1,
    lastProgressAt: 0,
    lastTime: 0,
    healing: false,
    // الحلقة التالية مجهّزة مسبقًا: { episode, prep, best }
    warm: null,
    skip: { key: null, result: null, pending: false, controller: null },
    // «شاهد اللقطة»: تشغيل المدى فقط ثم بطاقة الإعادة
    clip: Number(args.clipEnd) > Number(args.clipStart) && Number(args.clipStart) >= 0 ? { start: Number(args.clipStart), end: Number(args.clipEnd) } : null,
    clipLast: -1,
  };
  const isAnime = args.section !== 'cinema';
  const previousTitle = document.title;

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
  const fitBtn = iconButton('crop', 'ملء الصورة (قصّ الحواف)', () => toggleFill());
  const fullBtn = iconButton('full', 'ملء الشاشة (F)', () => toggleFullscreen(), 'pp-desk');
  const cameraBtn = iconButton('camera', 'شارك لحظة', () => void composeMoment());
  top.append(iconButton('back', 'رجوع', () => closePlayer()), titles, cameraBtn, fitBtn, fullBtn, iconButton('more', 'المزيد', () => showMore()));

  async function composeMoment() {
    if (momentComposer || state.closed) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return message('انتظر حتى يجهز الفيديو');
    // A document modal must leave native fullscreen to remain visible on mobile Safari.
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    if (state.closed) return;
    const resume = !video.paused; video.pause();
    const candidate = state.current ?? {};
    const rawSource = { url: candidate.url, type: candidate.type, mimeType: candidate.mimeType, sourceId: candidate.sourceId, server: candidate.server, quality: candidate.quality };
    const currentUrl = video.currentSrc || video.src;
    const playbackSource = { ...rawSource, url: currentUrl && !currentUrl.startsWith('blob:') ? currentUrl : candidate.url };
    const ref = args.work?.ref ?? args.seriesRef ?? args.subtitleIdentity?.canonicalId ?? `${args.section === 'cinema' ? 'cinema' : 'anime'}:${args.animeId}`;
    const work = { ref, title: args.title || '', cover: args.poster ?? null };
    const filename = `VANTARA-moment-${Date.now()}.mp4`;
    const save = async (selection, externalShare = false) => {
      const result = await exportBrowserMoment({ source: playbackSource, startMs: selection.startMs, endMs: selection.endMs, filename, signal: selection.signal, externalShare });
      if (result?.url?.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(result.url), 30000);
      return result;
    };
    momentComposer = openMomentComposer({
      positionMs: Math.round((video.currentTime || 0) * 1000), durationMs: Math.floor(video.duration * 1000),
      work, episode: movie ? null : state.episode, friends: args.friends ?? [], sourceHints: [rawSource],
      onSend: (selection) => emit('momentSend', momentSendPayload(args, selection)),
      onSave: (selection) => save(selection), onShare: (selection) => save(selection, true),
      onPreview: (selection) => {
        momentPreview?.destroy();
        const row = { id: 'moment-draft', series_ref: ref, series_title: work.title, cover_url: work.cover, moment_json: JSON.stringify({ ...selection.moment, sources: [] }) };
        momentPreview = openMomentViewer({ row, resolveSources: async () => [playbackSource], toast: message });
      },
      onClose: () => { momentPreview?.destroy(); momentPreview = null; momentComposer = null; if (!state.closed && resume) void video.play().catch(() => showControls(true)); },
    });
  }

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
  const hoverTip = el('span', 'pp-hover');
  hoverTip.hidden = true;
  const skipMarks = el('span', 'pp-marks');
  bar.append(track, skipMarks, thumb, hoverTip);

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
  const volume = el('div', 'pp-volume pp-desk');
  const volBtn = iconButton('volume', 'كتم الصوت (M)', () => setMuted(!video.muted));
  const volRange = el('input', 'pp-volume__range');
  volRange.type = 'range';
  volRange.min = '0';
  volRange.max = '100';
  volRange.step = '1';
  volRange.setAttribute('aria-label', 'مستوى الصوت');
  volRange.addEventListener('input', () => setVolume(Number(volRange.value) / 100));
  volRange.addEventListener('pointerdown', (e) => e.stopPropagation());
  volume.append(volBtn, volRange);
  const fullBtnBottom = iconButton('full', 'ملء الشاشة (F)', () => toggleFullscreen(), 'pp-desk');
  const subsBtn = iconButton('subtitles', 'الترجمة (C)', () => showSubtitles(), 'pp-desk');
  subsBtn.hidden = true;
  right.append(qualityBtn, subsBtn, iconButton('speed', 'السرعة', () => showSpeed()), iconButton('lock', 'قفل الشاشة', () => setLocked(true), 'pp-touch'), fullBtnBottom);
  // الصوت في الطرف الأيسر بجانب أزرار الحلقات، كمشغلات الكمبيوتر
  left.prepend(volume);
  row.append(left, center, right);
  bottom.append(times, bar, row);
  controls.append(el('div', 'pp-shade pp-shade--top'), el('div', 'pp-shade pp-shade--bottom'), top, bottom);

  const unlockBtn = iconButton('unlock', 'فتح القفل', () => setLocked(false), 'pp-unlock');
  unlockBtn.hidden = true;

  // زر «تخطي المقدمة/النهاية» يظهر وحده حتى والتحكم مخفي، كالـAPK
  const skipBtn = el('button', 'pp-skip');
  skipBtn.type = 'button';
  skipBtn.hidden = true;
  skipBtn.onclick = (e) => {
    e.stopPropagation();
    skipSegment();
  };

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

  root.append(video, gestures, seekLeft, seekRight, spinner, controls, skipBtn, pill, unlockBtn, errorCard, sheetScrim, sheet);
  document.body.append(root);
  if (together) {
    root.classList.add('v35');
    const strip = el('button', 'pp-together');
    strip.type = 'button'; strip.dir = 'rtl';
    root.append(strip);
    const lobby = el('div', 'pp-lobby'); lobby.dir = 'rtl'; lobby.hidden = true; root.append(lobby);
    const hub = together.hub;
    const unmount = hub.mountStrip(strip);
    let sheetCleanup = null;
    const surface = hub.useSurface({ openSheet: build => {
      sheetCleanup?.(); sheetCleanup = null;
      openSheet('مشاهدة معًا', null, body => { sheetCleanup = build(body); });
    }, closeSheet, toast: message });
    // البنر والشعار وعنوان الحلقة: ما جاء مع الدعوة فورًا، ثم ما يُكمَّل من ani.zip/metahub.
    // الحلقة تتغيّر في الغرفة؟ يتغيّر البنر والعنوان معها.
    const inviteMedia = together.session.media ?? {};
    let art = { banner: inviteMedia.banner ?? inviteMedia.cover ?? args.poster ?? null, logo: inviteMedia.logo ?? null, title: inviteMedia.title ?? args.title ?? '', episodeTitle: inviteMedia.episodeTitle ?? null };
    let artEpisode = null;
    const refreshArt = () => {
      if (artEpisode === state.episode) return;
      artEpisode = state.episode;
      const same = Number(inviteMedia.episode) === state.episode;
      const media = { ...inviteMedia, episode: state.episode, ...(same ? {} : { banner: null, episodeTitle: null }) };
      if (!same) art = { ...art, banner: inviteMedia.cover ?? args.poster ?? art.banner, episodeTitle: null };
      void resolveArt(media).then((a) => {
        if (artEpisode !== media.episode || state.closed) return;
        art = { ...a, banner: a.banner ?? art.banner };
        tg?.repaint();
      });
    };
    tg = createTogetherPlayer({ room: together.session.room, mode: together.session.mode, mediaPrefix: together.mediaPrefix, video,
      episode: () => state.episode, source: () => state.current?.code ?? null,
      onEpisode: n => { void goEpisode(n, true).catch(() => { tg?.failed(); showError('تعذّر تجهيز الحلقة التي اختارها المضيف'); }); }, message,
      onLobby: (l) => {
        lobby.hidden = !l.visible;
        root.classList.toggle('pp--lobby', l.visible);
        if (!l.visible) return;
        refreshArt();
        const media = together.session.media ?? {};
        const c = state.current;
        renderLobby(lobby, {
          ...l,
          roster: l.roster.map(r => ({ ...r, avatarKey: r.avatarKey || hub.person(r.userId)?.avatarKey || null })),
          art,
          kindText: mediaKind(media),
          // لون القسم: أحمر السينما، بنفسجي المانجا، ولون الأنمي للأنمي
          accent: media.kind === 'manga' ? '#8f5cff' : media.kind === 'anime' ? '#3b82f6' : '#c1121f',
          episodeText: episodeLine(media, state.episode),
          connectionText: connectionLabel(l.connection),
          pending: pendingInvitees(l.invited, l.roster, l.me, (id) => hub.person(id)),
          server: c ? { code: c.code, quality: fmtQ(c.quality ?? currentHeight()) } : null,
        }, {
          avatar: (p, size) => hub.avatar(p, size),
          start: l.start,
          resume: l.resume,
          changeServer: () => showServers(),
          leave: () => closePlayer(),
          setOffset: (ms) => { const v = tg?.setOffset(ms) ?? 0; message(v ? `ديلاي فيديوك ${v > 0 ? '+' : '−'}${Math.abs(v / 1000).toFixed(1)} ث` : 'بدون ديلاي', 1200); },
        });
      },
    });
    const off = hub.onChange(s => { if (s === together.session) return; tg?.destroy(); tg = null; lobby.remove(); strip.remove(); });
    releaseTogether = () => { sheetCleanup?.(); off(); tg?.destroy(); unmount(); surface(); if (hub.session === together.session) hub.leave(); };
    root._togetherSheetCleanup = () => { sheetCleanup?.(); sheetCleanup = null; };
  }
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
    if (!stay && !video.paused) hideTimer = setTimeout(() => { if (!overControls) root.classList.remove('pp--shown'); }, HIDE_AFTER_MS);
  }
  // الماوس فوق الأزرار يُبقيها ظاهرة؛ وخارجها تختفي بعد 3.5 ث مع المؤشر
  let overControls = false;
  for (const part of [top, bottom]) {
    part.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { overControls = true; if (sheet.hidden) showControls(true); } });
    part.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { overControls = false; if (sheet.hidden) showControls(); } });
  }
  let lastMove = { x: -1, y: -1 };
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || (e.clientX === lastMove.x && e.clientY === lastMove.y)) return;
    lastMove = { x: e.clientX, y: e.clientY };
    if (sheet.hidden) showControls();
  });
  root.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !video.paused) { overControls = false; hideControls(); } });
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
    if (tg?.playPause(video.paused)) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
    showControls();
  }
  let seekAccum = 0;
  let seekTimer = 0;
  function seekBy(sec) {
    if (!Number.isFinite(video.duration)) return;
    if (tg?.seek(Math.max(0, Math.min(video.duration - .5, video.currentTime + sec)) * 1000)) return;
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
  // ── الصوت (الكمبيوتر): زر + شريط + عجلة الماوس + الأسهم، ويُحفظ بين الجلسات ──
  function paintVolume() {
    const level = video.muted ? 0 : video.volume;
    volBtn.innerHTML = level === 0 ? ICON.mute : level < 0.5 ? ICON.volumeLow : ICON.volume;
    volRange.value = String(Math.round(level * 100));
    volRange.style.setProperty('--level', `${Math.round(level * 100)}%`);
  }
  function setVolume(v, announce = false) {
    const next = Math.max(0, Math.min(1, Math.round(v * 100) / 100));
    video.volume = next;
    video.muted = next === 0;
    saveVolume(next || video.volume, video.muted);
    paintVolume();
    if (announce) message(next === 0 ? 'الصوت مكتوم' : `الصوت ${Math.round(next * 100)}%`, 900);
  }
  function setMuted(on) {
    video.muted = on;
    if (!on && video.volume === 0) video.volume = 0.5;
    saveVolume(video.volume, on);
    paintVolume();
    message(on ? 'الصوت مكتوم' : `الصوت ${Math.round(video.volume * 100)}%`, 900);
  }
  {
    const saved = readVolume();
    video.volume = saved.volume;
    video.muted = saved.muted;
    paintVolume();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else root.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => message('المتصفح منع ملء الشاشة'));
  }
  const paintFullscreen = () => {
    const on = Boolean(document.fullscreenElement);
    for (const b of [fullBtn, fullBtnBottom]) {
      b.innerHTML = on ? ICON.fullExit : ICON.full;
      b.setAttribute('aria-label', on ? 'خروج من ملء الشاشة (F)' : 'ملء الشاشة (F)');
      b.title = b.getAttribute('aria-label');
    }
  };
  document.addEventListener('fullscreenchange', paintFullscreen);

  // ── تخطي المقدمة والنهاية (نفس SkipRepository في الـAPK) ──
  function maybeLoadSkips(force = false) {
    if (!isAnime || !state.started || !(video.duration > 0) || !Number.isFinite(video.duration)) return;
    const durationMs = Math.round(video.duration * 1000);
    const key = `${state.session}|${state.episode}|${state.current?.id}|${Math.trunc(durationMs / 1000)}`;
    if (!force && state.skip.key === key) return;
    state.skip.controller?.abort();
    const controller = new AbortController();
    state.skip = { key, result: null, pending: true, controller };
    const anilistId = Number(args.subtitleIdentity?.externalIds?.anilist ?? args.animeId) || null;
    loadSkipTimes({ malId: Number(args.malId) || null, anilistId, episode: state.episode, durationMs, force, signal: controller.signal })
      .then((result) => {
        if (state.skip.controller !== controller) return;
        state.skip = { ...state.skip, result, pending: false };
        paintSkipMarks();
        paintSkip();
      })
      .catch(() => { if (state.skip.controller === controller) state.skip = { ...state.skip, pending: false }; });
  }
  function clearSkips() {
    state.skip.controller?.abort();
    state.skip = { key: null, result: null, pending: false, controller: null };
    skipBtn.hidden = true;
    skipMarks.replaceChildren();
  }
  function paintSkip() {
    const seg = state.started && !state.clip ? activeSegment(state.skip.result?.timings, (video.currentTime || 0) * 1000) : null;
    skipBtn.hidden = !seg;
    if (seg) {
      const label = seg.opening ? 'تخطي المقدمة' : 'تخطي النهاية';
      if (skipBtn.dataset.label !== label) {
        skipBtn.dataset.label = label;
        skipBtn.innerHTML = `<span>${label}</span>${ICON.skip}`;
        skipBtn.setAttribute('aria-label', `${label} (S)`);
      }
    }
  }
  /** علامات المقدمة والنهاية على شريط التقدّم. */
  function paintSkipMarks() {
    skipMarks.replaceChildren();
    const t = state.skip.result?.timings;
    const d = video.duration * 1000;
    if (!t || !(d > 0)) return;
    for (const i of [t.opening, t.ending].filter(Boolean)) {
      const m = el('i');
      m.style.left = `${(i.startMs / d) * 100}%`;
      m.style.width = `${((i.endMs - i.startMs) / d) * 100}%`;
      skipMarks.append(m);
    }
  }
  function skipSegment() {
    const seg = activeSegment(state.skip.result?.timings, (video.currentTime || 0) * 1000);
    if (!seg) return false;
    skipBtn.hidden = true;
    if (!tg?.seek(seg.interval.endMs)) video.currentTime = seg.interval.endMs / 1000;
    message(seg.opening ? 'تخطّينا المقدمة' : 'تخطّينا النهاية', 1200);
    return true;
  }

  // ── الحلقة التالية تُجهَّز في آخر 4 دقائق (NextEpisodeWarmup في الـAPK) ──
  function maybeWarmNext() {
    if (state.warm || !state.started || isLast() || tg || !Number.isFinite(video.duration)) return;
    if (!shouldWarmNext(video.duration * 1000, (video.currentTime || 0) * 1000)) return;
    const n = state.episode + 1;
    const copies = nextEpisodeCopies(args.copies, n, { ...args.subtitleIdentity, episode: n });
    if (!copies.length || (state.total > 0 && n > state.total)) return;
    const warm = { episode: n, prep: null, closed: false };
    state.warm = warm;
    warm.ready = engine.prepare({ copies, episode: n, preferredSourceId: state.current?.sourceId ?? null, preferredServer: state.current?.server ?? null })
      .then(async (prep) => {
        warm.prep = prep;
        if (warm.closed) { void engine.closeSession({ session: prep.session }); return null; }
        const best = await engine.best({ session: prep.session, prefer: args.prefer ?? null, waitMs: 45_000 }).catch(() => null);
        return { prep, best };
      })
      .catch(() => null);
  }
  function discardWarm() {
    const w = state.warm;
    state.warm = null;
    if (!w) return;
    w.closed = true;
    if (w.prep) void engine.closeSession({ session: w.prep.session });
  }

  // ── «شاهد اللقطة»: يقف في نهاية المدى ويعرض الإعادة ──
  let clipCard = null;
  function clipTick() {
    const c = state.clip;
    if (!c || clipCard || !state.started) return;
    const now = (video.currentTime || 0) * 1000;
    if (!video.paused && state.clipLast >= c.start && state.clipLast < c.end && now >= c.end) {
      video.pause();
      showClipEnd();
    }
    state.clipLast = now;
  }
  function showClipEnd() {
    const c = state.clip;
    clipCard?.remove();
    const card = el('div', 'pp-error pp-clip');
    card.dir = 'rtl';
    const range = el('p', null, `${clock(c.start / 1000)} – ${clock(c.end / 1000)}`);
    range.dir = 'ltr';
    card.append(el('strong', null, 'انتهت اللقطة'), range);
    const actions = el('div', 'pp-error__actions');
    const close = () => { clipCard?.remove(); clipCard = null; };
    const mk = (label, primary, fn) => {
      const b = el('button', `pp-pill-btn${primary ? ' pp-pill-btn--primary' : ''}`, label);
      b.type = 'button';
      b.onclick = () => { close(); fn(); };
      return b;
    };
    actions.append(
      mk('إعادة اللقطة', true, () => { video.currentTime = c.start / 1000; state.clipLast = c.start; video.play().catch(() => {}); }),
      mk('أكمل من هنا', false, () => { state.clip = null; message('الحلقة كاملة'); video.play().catch(() => {}); }),
      mk('الحلقة من البداية', false, () => { state.clip = null; video.currentTime = 0; video.play().catch(() => {}); }),
    );
    card.append(actions);
    root.append(card);
    clipCard = card;
    hideControls();
  }

  function toggleFill() {
    state.fill = !state.fill;
    root.classList.toggle('pp--fill', state.fill);
    fitBtn.classList.toggle('is-on', state.fill);
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
  // الماوس: نقرة = تشغيل/إيقاف، نقرتان = ملء الشاشة، العجلة = الصوت
  let clickTimer = 0;
  // Safari لا يذكر نوع المؤشر في click: نأخذه من pointerdown
  let pointerKind = 'mouse';
  gestures.addEventListener('pointerdown', (e) => { pointerKind = e.pointerType; });
  gestures.addEventListener('click', (e) => {
    if (pointerKind !== 'mouse' || !sheet.hidden) return;
    if (e.detail > 1) return;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => togglePlay(), 220);
  });
  gestures.addEventListener('dblclick', (e) => {
    clearTimeout(clickTimer);
    if (pointerKind !== 'mouse') return;
    toggleFullscreen();
  });
  gestures.addEventListener('wheel', (e) => {
    if (state.locked || !sheet.hidden || !e.deltaY) return;
    e.preventDefault();
    setVolume((video.muted ? 0 : video.volume) + (e.deltaY < 0 ? 0.05 : -0.05), true);
  }, { passive: false });
  gestures.addEventListener('pointerup', (e) => {
    if (sheet.hidden === false) return;
    if (e.pointerType === 'mouse') return;
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
    if (Number.isFinite(video.duration) && !tg?.seek(p * video.duration * 1000)) video.currentTime = p * video.duration;
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
  // معاينة الوقت تحت الماوس (الكمبيوتر)، وتعرف إن كان الموضع داخل المقدمة أو النهاية
  bar.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !Number.isFinite(video.duration)) return;
    const r = track.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const ms = p * video.duration * 1000;
    const seg = activeSegment(state.skip.result?.timings, ms) ?? activeSegment(state.skip.result?.timings, ms + 1001);
    hoverTip.textContent = `${clock(p * video.duration)}${seg ? (seg.opening ? ' · المقدمة' : ' · النهاية') : ''}`;
    hoverTip.style.left = `${p * 100}%`;
    hoverTip.hidden = false;
  });
  bar.addEventListener('pointerleave', () => { hoverTip.hidden = true; });
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); seekBy(e.key === 'ArrowRight' ? 5 : -5); }
  });

  // ───────────────────────── الأوراق ─────────────────────────

  function openSheet(title, subtitle, build, modifier = '') {
    sheet.className = `pp-sheet${modifier ? ` ${modifier}` : ''}`;
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
    root._togetherSheetCleanup?.();
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

  function setSpeed(sp) {
    state.speed = sp;
    // في الغرفة المتزامنة السرعة يملكها متحكّم المزامنة
    if (!tg) video.playbackRate = sp;
    message(sp === 1 ? 'سرعة عادية' : `السرعة ${sp}×`);
  }
  function showSpeed() {
    openSheet('السرعة', null, (body) => {
      for (const sp of SPEEDS) {
        body.append(sheetRow(sp === 1 ? 'عادية' : `${sp}×`, null, {
          on: state.speed === sp,
          onClick: () => {
            closeSheet();
            setSpeed(sp);
          },
        }));
      }
    });
  }

  let subtitleSheetBody = null;
  const providers = runtime.addons?.subtitleProviders?.() ?? [];
  const subtitleSession = createSubtitleSession({ video, getHls: () => state.hls, providers, identity: args.subtitleIdentity ?? {},
    onHealth: (key, ok) => {
      const provider = providers.find(p => p.key === key); if (provider) provider.healthy = ok;
      if (ok) runtime.addons?.registry.health.success(key, 'subtitles', 'pwa');
      else runtime.addons?.registry.health.failure(key, 'subtitles', 'pwa', 'provider_failure');
    },
    onChange: () => {
      subsBtn.hidden = !subtitleSession.available();
      if (subtitleSheetBody && !sheet.hidden && sheet.contains(subtitleSheetBody)) paintSubtitles(subtitleSheetBody);
      if (!sheet.hidden && sheet.classList.contains('pp-sheet--subtitle-adjust') && !Object.values(subtitleSession.adjustments.capabilities()).some(Boolean)) closeSheet();
    },
  });
  function subtitleLabel(track) {
    if (track.lang === 'ar') return 'العربية';
    if (track.lang === 'en') return 'English';
    try { return new Intl.DisplayNames(['ar'], { type: 'language' }).of(track.lang) || track.label; } catch { return track.label; }
  }
  function paintSubtitles(body) {
    body.replaceChildren();
    const tracks = subtitleSession.tracks();
    if (!tracks.length) { body.append(sheetRow(subtitleSession.pending() ? 'جارٍ جلب الترجمات من الإضافة…' : 'لا توجد ترجمة منفصلة لهذا الفيديو', null)); return; }
    body.append(sheetRow('إيقاف', null, { on: subtitleSession.selected() === null, onClick: () => void subtitleSession.select(null) }));
    for (const [kind, label] of [['source', 'الترجمة من الفيديو'], ['addon', 'ترجمات إضافية']]) {
      const group = tracks.filter(t => t.kind === kind); if (!group.length) continue;
      body.append(el('p', 'pp-servers__quality', label));
      for (const track of group) body.append(sheetRow(subtitleLabel(track),
        kind === 'addon' ? `${track.provider} · ${track.match === 'release' ? 'مطابقة للإصدار' : 'مطابقة للحلقة؛ تحقق من التوقيت'}` : track.label,
        { on: subtitleSession.selected() === track.id, onClick: () => void subtitleSession.select(track.id).catch(error => message(error.message)) }));
    }
    if (Object.values(subtitleSession.adjustments.capabilities()).some(Boolean)) body.append(sheetRow('تعديل الترجمة', null, { onClick: showSubtitleAdjustment }));
  }
  function showSubtitles() { subtitleSheetBody = openSheet('الترجمة', null, paintSubtitles, 'pp-sheet--subtitles'); }
  function showSubtitleAdjustment() {
    const adjust = subtitleSession.adjustments;
    const caps = adjust.capabilities();
    if (!Object.values(caps).some(Boolean)) return;
    openSheet('تعديل الترجمة', null, (body) => {
      const stepper = (key, title, label, next) => {
        const group = el('div', 'pp-sub-step');
        group.append(el('small', null, title));
        const pill = el('div', 'pp-sub-step__pill'); pill.dir = 'ltr';
        const value = el('output'); value.setAttribute('aria-live', 'polite');
        const minus = el('button', null, '−'), plus = el('button', null, '+');
        const paint = () => {
          const current = adjust.values()[key]; value.textContent = label(current);
          minus.disabled = next(current, -1) === current; plus.disabled = next(current, 1) === current;
        };
        for (const [button, direction] of [[minus, -1], [plus, 1]]) {
          button.type = 'button'; button.setAttribute('aria-label', `${direction > 0 ? 'زيادة' : 'تقليل'} ${title}`);
          button.onclick = () => { adjust.set(key, next(adjust.values()[key], direction)); paint(); };
        }
        pill.append(minus, value, plus); group.append(pill); body.append(group); paint();
      };
      if (caps.timing) {
        stepper('delay', 'توقيت الترجمة', n => `${n.toFixed(2)} ث`, (n, d) => Math.round(Math.max(-10, Math.min(10, n + d * 0.1)) * 10) / 10);
        body.append(el('small', 'pp-sub-hint', '+ يؤخر الترجمة، − يقدمها'));
      }
      if (caps.size) stepper('size', 'حجم الترجمة', n => `${n}%`, (n, d) => SUBTITLE_SIZES[Math.max(0, Math.min(SUBTITLE_SIZES.length - 1, SUBTITLE_SIZES.indexOf(n) + d))]);
      if (caps.position) stepper('position', 'موضع الترجمة', n => `${n}%`, (n, d) => Math.max(0, Math.min(100, n + d)));
    }, 'pp-sheet--subtitle-adjust');
  }
  function showSkips() {
    const render = (body) => {
      body.replaceChildren();
      body.append(sheetRow('توقيت هذه الحلقة', skipStatusText(state.skip.result, state.skip.pending, clock), { on: true }));
      body.append(el('p', 'pp-note', 'يظهر زر التخطي أثناء المقدمة أو النهاية (أو اضغط S). تخطي النهاية يُبقي المشاهد التي تأتي بعدها.'));
      const again = sheetRow('إعادة جلب التوقيت', state.skip.pending ? 'جارٍ الجلب…' : 'جرّب مجددًا بعد عودة الاتصال', { onClick: () => { maybeLoadSkips(true); render(body); } });
      again.disabled = state.skip.pending;
      body.append(again);
    };
    const body = openSheet('تخطي المقدمة والنهاية', null, render);
    const live = setInterval(() => { if (sheet.hidden || state.closed || !sheet.contains(body)) return clearInterval(live); render(body); }, 1000);
  }

  /** لوحة الشبكة: نفس فكرة NetStats في الـAPK، بما يكشفه المتصفح فعلًا. */
  function networkRows() {
    const c = state.current;
    let ahead = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) >= video.currentTime) ahead = video.buffered.end(i) - video.currentTime;
    }
    const q = video.getVideoPlaybackQuality?.();
    const level = state.hls?.levels?.[state.hls.currentLevel];
    const est = state.hls?.bandwidthEstimate;
    let host = '';
    try { host = new URL(c?.url ?? '').hostname; } catch { host = ''; }
    const mbps = (bps) => `${(bps / 1e6).toFixed(1)} Mbps`;
    return [
      ['السيرفر', c ? `${c.code}${host ? ` · ${host}` : ''}` : '—'],
      ['الطريق', state.via === 'edge' ? 'عبر جالب VANTARA' : state.via === 'direct' ? 'مباشر من المضيف' : '—'],
      ['الصورة', video.videoHeight ? `${video.videoWidth}×${video.videoHeight}` : '—'],
      ['المخزَّن أمامك', `${ahead.toFixed(1)} ث`, ahead < 5 ? 'bad' : ahead < 15 ? 'warn' : 'ok'],
      ...(est ? [['سرعة اتصالك (تقدير)', mbps(est), est < 3e6 ? 'warn' : 'ok']] : []),
      ...(level?.bitrate ? [['معدّل البث', mbps(level.bitrate)]] : []),
      ...(q ? [['إطارات ساقطة', `${q.droppedVideoFrames} من ${q.totalVideoFrames}`, q.totalVideoFrames && q.droppedVideoFrames / q.totalVideoFrames > 0.02 ? 'warn' : 'ok']] : []),
    ];
  }
  function showNetwork() {
    const render = (body) => {
      body.replaceChildren();
      for (const [name, value, tone] of networkRows()) {
        const r = el('div', `pp-metric${tone ? ` pp-metric--${tone}` : ''}`);
        const v = el('b', null, value);
        v.dir = 'auto';
        r.append(el('span', null, name), v);
        body.append(r);
      }
    };
    const body = openSheet('الشبكة', 'تتحدّث كل ثانية', render);
    const live = setInterval(() => { if (sheet.hidden || state.closed || !sheet.contains(body)) return clearInterval(live); render(body); }, 1000);
  }

  function showShortcuts() {
    openSheet('اختصارات الكيبورد', null, (body) => {
      for (const [keys, what] of SHORTCUTS) {
        const r = el('div', 'pp-metric');
        const k = el('kbd', null, keys);
        k.dir = 'ltr';
        r.append(el('span', null, what), k);
        body.append(r);
      }
    });
  }

  /** ديلاي فيديوك في الغرفة: لك وحدك، يتطبّق فورًا وتشوف الفرق وأنت تعدّل. */
  function showOffset() {
    if (!tg) return;
    openSheet('ديلاي فيديوك', 'لك وحدك · ما يتغيّر شيء عند الباقين', (body) => {
      const value = el('output', 'pp-offset__value');
      value.setAttribute('aria-live', 'polite');
      const paint = () => {
        const v = tg?.offset() ?? 0;
        value.textContent = v ? `${v > 0 ? '+' : '−'}${(Math.abs(v) / 1000).toFixed(1)} ث` : '0 ث';
      };
      const row = el('div', 'pp-offset');
      row.dir = 'ltr';
      for (const [label, delta] of [['−5', -5000], ['−0.5', -500], [null, 0], ['+0.5', 500], ['+5', 5000]]) {
        if (label == null) { row.append(value); continue; }
        const b = el('button', 'pp-offset__btn', label);
        b.type = 'button';
        b.setAttribute('aria-label', `${delta > 0 ? 'قدّم' : 'أخّر'} فيديوك ${Math.abs(delta) / 1000} ث`);
        b.onclick = () => { tg?.setOffset((tg?.offset() ?? 0) + delta); paint(); };
        row.append(b);
      }
      body.append(row);
      body.append(el('p', 'pp-note', 'مصدرك فيه مقدمة أو مشهد زيادة عن الباقين؟ زِد (+) حتى تشوفون نفس اللحظة. أقل منهم؟ نقّص (−). يُحفظ لهذه الحلقة وهذا السيرفر.'));
      const reset = sheetRow('بدون ديلاي', null, { onClick: () => { tg?.setOffset(0); paint(); } });
      body.append(reset);
      paint();
    });
  }

  function showMore() {
    openSheet('المزيد', null, (body) => {
      if (tg) {
        const v = tg.offset();
        body.append(sheetRow('ديلاي فيديوك', v ? `${v > 0 ? '+' : '−'}${(Math.abs(v) / 1000).toFixed(1)} ث · لك وحدك` : 'لو مصدرك فيه مقدمة زيادة عن الباقين', { onClick: () => { closeSheet(); showOffset(); } }));
      }
      if (subtitleSession.available()) body.append(sheetRow('الترجمة', null, { onClick: () => { closeSheet(); showSubtitles(); } }));
      if (isAnime) body.append(sheetRow('تخطي المقدمة والنهاية', skipStatusText(state.skip.result, state.skip.pending, clock), { onClick: () => { closeSheet(); showSkips(); } }));
      body.append(sheetRow('السرعة', state.speed === 1 ? 'عادية' : `${state.speed}×`, { onClick: () => { closeSheet(); showSpeed(); } }));
      body.append(sheetRow('الشبكة', 'السيرفر، الطريق، المخزَّن، والإطارات', { onClick: () => { closeSheet(); showNetwork(); } }));
      const desktop = matchMedia('(hover: hover) and (pointer: fine)').matches;
      if (desktop) body.append(sheetRow('اختصارات الكيبورد', 'مسافة، الأسهم، F، M، S…', { onClick: () => { closeSheet(); showShortcuts(); } }));
      else body.append(sheetRow('قفل الشاشة', 'يمنع اللمس الخاطئ أثناء المشاهدة', { onClick: () => { closeSheet(); setLocked(true); } }));
      body.append(sheetRow(state.fill ? 'إظهار الصورة كاملة' : 'ملء الصورة (قصّ الحواف)', state.fill ? 'بلا قصّ، مع أشرطة سوداء إن لزم' : 'تختفي الأشرطة السوداء ويُقصّ طرف الصورة', { onClick: () => { closeSheet(); toggleFill(); } }));
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
    tg?.failed();
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

  /**
   * أزرار الوسائط في الكيبورد ولوحة الوسائط في ويندوز (والجوال): العنوان والحلقة
   * والغلاف، وتشغيل/إيقاف/تقديم/التالية.
   */
  function mediaSession() {
    const label = movie ? args.title : `${args.title} · الحلقة ${state.episode}`;
    document.title = label || previousTitle;
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: label, artist: 'VANTARA', artwork: args.poster ? [{ src: args.poster, sizes: '512x512' }] : [] });
      const on = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch { /* غير مدعوم */ } };
      on('play', () => { if (video.paused) togglePlay(); });
      on('pause', () => { if (!video.paused) togglePlay(); });
      on('seekbackward', () => seekBy(-10));
      on('seekforward', () => seekBy(10));
      on('seekto', (d) => { if (Number.isFinite(d.seekTime) && !tg?.seek(d.seekTime * 1000)) video.currentTime = d.seekTime; });
      on('nexttrack', isLast() ? null : () => void goEpisode(state.episode + 1));
    } catch {
      // متصفح بلا Media Session كاملة
    }
  }

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
    state.cancelAttempt?.();
    clearTimeout(state.startTimer);
    subtitleSession.resetMedia();
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
        if (state.cancelAttempt === cancel) state.cancelAttempt = null;
        clearTimeout(state.startTimer);
        video.removeEventListener('playing', onPlay);
        video.removeEventListener('error', onError);
        video.removeEventListener('loadedmetadata', onMeta);
        resolve({ ok, reason });
      };
      const cancel = () => done(false, 'cancelled');
      state.cancelAttempt = cancel;
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
            subtitleSession.attachHls(hls, Hls);
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

  async function playCandidate(c, { seek = 0, generation = state.mediaGeneration } = {}) {
    if (state.closed || generation !== state.mediaGeneration) return false;
    state.current = c;
    subtitleSession.setStream(c);
    state.started = false;
    clearSkips();
    tg?.preparing();
    state.tried.add(c.id);
    errorCard.hidden = true;
    paint();
    setBusy(true, `جارٍ التشغيل · ${c.code}`);
    const paths = await candidatePaths(c,runtime);
    if (state.closed || generation !== state.mediaGeneration || state.current !== c) return false;
    if(addonMedia(c))video.crossOrigin="anonymous";else video.removeAttribute("crossorigin");
    let reason = null;
    // غرفة متزامنة لم تبدأ: الفيديو يُجهَّز بصمت ويقف عند البداية (لا صوت مفاجئ)
    const quiet = tg?.waiting() ? video.muted : null;
    if (quiet !== null) video.muted = true;
    try {
      for (const [via, url] of paths) {
        if (state.closed || generation !== state.mediaGeneration || state.current !== c) return false;
        const out = await attempt(url, c.type);
        if (state.closed || generation !== state.mediaGeneration || state.current !== c) return false;
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
          subsBtn.hidden = !subtitleSession.available();
          maybeLoadSkips();
          mediaSession();
          emit('server', { animeId: args.animeId ?? null, code: c.code, sourceId: c.sourceId, server: c.server, quality: c.quality ?? currentHeight() ?? null });
          report();
          tg?.ready();
          return true;
        }
        reason = out.reason;
        // صورة «غير متاح» هي نفسها عبر الجالب: لا داعي للطريق الثاني
        if (reason === 'placeholder') break;
      }
    } finally {
      if (quiet !== null) video.muted = quiet;
    }
    state.failed.set(c.route, REASON[reason] ?? 'فشل التشغيل');
    return false;
  }

  /** المرشّح المختار ثم الباقي بالترتيب، حتى يعمل واحد. */
  async function playFrom(firstId, seek = 0) {
    const generation = state.mediaGeneration;
    const s = sessionOf(state.session);
    if (!s) return showError('انتهت الجلسة، افتح الحلقة من جديد');
    const pool = () => readyCandidates(s, args.prefer ?? null).filter((c) => !state.tried.has(c.id) && !state.failed.has(c.route));
    const first = firstId ? s.cands.get(firstId) : null;
    if (first && (await playCandidate(first, { seek, generation }))) return;
    for (;;) {
      if (state.closed || generation !== state.mediaGeneration) return;
      let next = pool()[0];
      if (!next && !s.done) {
        setBusy(true, 'نجهّز سيرفرًا آخر…');
        const out = await engine.best({ session: state.session, prefer: args.prefer ?? null, waitMs: 30_000 }).catch(() => null);
        if (state.closed || generation !== state.mediaGeneration) return;
        next = pool()[0] ?? (out?.candidate && !state.tried.has(out.candidate) ? s.cands.get(out.candidate) : null);
      }
      if (!next) return showError('ما اشتغل أي سيرفر لهذي الحلقة');
      if (state.current && state.started === false) message(`${state.current.code}: ${state.failed.get(state.current.route) ?? 'فشل'} — نجرّب التالي`, 2500);
      if (await playCandidate(next, { seek, generation })) return;
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
    const generation = state.mediaGeneration;
    const stale = () => state.closed || generation !== state.mediaGeneration || state.current !== c;
    message(`انقطع ${c.code} — نكمل من نفس اللحظة`, 3000);
    try {
      if (state.via === 'direct' && !addonMedia(c)) {
        await runtime.ensureMedia().catch(() => null);
        if (stale()) return;
        const out = await attempt(runtime.fetcher.mediaUrl(c.url, c.referer), c.type);
        if (stale()) return;
        if (out.ok) {
          state.via = 'edge';
          if (at > 0 && Number.isFinite(video.duration)) video.currentTime = at / 1000;
          video.playbackRate = state.speed;
          state.lastProgressAt = Date.now();
          return;
        }
      }
      if (stale()) return;
      state.failed.set(c.route, REASON[why] ?? 'انقطع');
      await playFrom(null, at);
    } finally {
      if (generation === state.mediaGeneration) state.healing = false;
    }
  }

  async function goEpisode(n, fromRoom = false) {
    const copies = nextEpisodeCopies(args.copies, n, args.subtitleIdentity);
    if (!copies.length || n < 1 || (state.total > 0 && n > state.total)) {
      if (fromRoom) { tg?.failed(); showError(`الحلقة ${n} غير متاحة من مصادرك`); }
      return;
    }
    if (!fromRoom && tg?.changeEpisode(n)) return;
    const generation = ++state.mediaGeneration;
    state.healing = false;
    tg?.preparing();
    report();
    setBusy(true, `نجهّز الحلقة ${n}…`);
    errorCard.hidden = true;
    const previous = state.current;
    if (previous && state.started && Number.isFinite(video.duration) && video.currentTime > 5 && video.currentTime < video.duration - 60) {
      args.resume = { ...(args.resume ?? {}), [state.episode]: Math.round(video.currentTime * 1000) };
    }
    state.current = null;
    state.started = false;
    teardownSource();
    args.subtitleIdentity = {...args.subtitleIdentity, episode:n};
    subtitleSession.setIdentity(args.subtitleIdentity);
    void engine.closeSession({ session: state.session });
    clearSkips();
    // الحلقة التالية جُهّزت في آخر 4 دقائق؟ تبدأ فورًا بلا انتظار
    const warm = state.warm?.episode === n ? state.warm : null;
    if (!warm) discardWarm();
    state.warm = null;
    const warmed = warm ? await warm.ready : null;
    if (warm && !warmed?.best?.candidate && warmed?.prep) void engine.closeSession({ session: warmed.prep.session });
    let prep = warmed?.best?.candidate ? warmed.prep : null;
    if (!prep) try {
      prep = await engine.prepare({ copies, episode: n, preferredSourceId: previous?.sourceId ?? null, preferredServer: previous?.server ?? null });
    } catch (error) {
      if (state.closed || generation !== state.mediaGeneration) return;
      throw error;
    }
    if (state.closed || generation !== state.mediaGeneration) {
      void engine.closeSession({ session: prep.session });
      return;
    }
    args.copies = prep.copies ?? copies;
    state.session = prep.session;
    state.episode = n;
    state.tried.clear();
    state.failed.clear();
    state.current = null;
    paint();
    emit('episode', { animeId: args.animeId ?? null, session: state.session, episode: n });
    mediaSession();
    const best = prep === warmed?.prep ? warmed.best : await engine.best({ session: state.session, prefer: args.prefer ?? null, waitMs: 45_000 }).catch(() => null);
    if (state.closed || generation !== state.mediaGeneration) return;
    // كل حلقة تكمل من حيث وقفت فيها (كالـAPK)، وفي الغرفة من الصفر دائمًا
    const resumeAt = !tg && Number(args.resume?.[n]) > 0 ? Number(args.resume[n]) : 0;
    await playFrom(best?.candidate ?? null, resumeAt);
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
    momentComposer?.destroy(); momentPreview?.destroy(); momentComposer = null; momentPreview = null;
    releaseTogether();
    clearInterval(countdown);
    clearInterval(watchdog);
    clearSkips();
    discardWarm();
    document.removeEventListener('fullscreenchange', paintFullscreen);
    document.title = previousTitle;
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null;
      for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'nexttrack']) try { navigator.mediaSession.setActionHandler(a, null); } catch { /* غير مدعوم */ }
    }
    subtitleSession.close();
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

  // الحروف بـe.code لا e.key: تعمل والكيبورد على العربي
  const onKey = (e) => {
    if (momentComposer) return;
    if (e.key === 'Escape') {
      if (!sheet.hidden) return closeSheet();
      if (document.fullscreenElement) return;
      return closePlayer();
    }
    const t = e.target;
    if (t?.isContentEditable || t?.tagName === 'TEXTAREA' || (t?.tagName === 'INPUT' && t.type !== 'range')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!sheet.hidden && e.code !== 'Space') return;
    const big = e.shiftKey ? 30 : 10;
    const code = e.code;
    if (code === 'Space' || code === 'KeyK' || e.key === 'MediaPlayPause') togglePlay();
    else if (code === 'ArrowRight' || code === 'KeyL') seekBy(big);
    else if (code === 'ArrowLeft' || code === 'KeyJ') seekBy(-big);
    else if (code === 'ArrowUp') setVolume((video.muted ? 0 : video.volume) + 0.05, true);
    else if (code === 'ArrowDown') setVolume((video.muted ? 0 : video.volume) - 0.05, true);
    else if (code === 'KeyM') setMuted(!video.muted);
    else if (code === 'KeyF') toggleFullscreen();
    else if (code === 'KeyS') { if (!skipSegment()) return; }
    else if (code === 'KeyN') { if (isLast()) return message('هذه آخر حلقة'); void goEpisode(state.episode + 1); }
    else if (code === 'KeyC') { if (!subtitleSession.available()) return message('لا ترجمة لهذا الفيديو'); showSubtitles(); }
    else if (e.key === '>' || e.key === '<' || (e.shiftKey && (code === 'Period' || code === 'Comma'))) {
      const up = e.key === '>' || code === 'Period';
      const i = SPEEDS.indexOf(state.speed);
      const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 2 : i) + (up ? 1 : -1)))];
      setSpeed(next);
    } else if (/^Digit[0-9]$/.test(code) && !e.shiftKey && Number.isFinite(video.duration)) {
      const target = (Number(code.slice(5)) / 10) * video.duration * 1000;
      if (!tg?.seek(target)) video.currentTime = target / 1000;
      showControls();
    } else if (e.key === '?' ) showShortcuts();
    else return;
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey);

  video.addEventListener('timeupdate', () => {
    paintTime();
    paintSkip();
    clipTick();
    maybeWarmNext();
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
  video.addEventListener('durationchange', () => { paintTime(); maybeLoadSkips(); paintSkipMarks(); });
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
    if (tg && !together.session.room.isHost && (together.session.room.info?.mode ?? together.session.mode) === 'sync') return message('بانتظار المضيف للحلقة التالية…');
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
