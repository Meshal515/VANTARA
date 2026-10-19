import { acquireMomentSources, ensureMomentStyles, momentMediaCache, momentOf, safeMediaUrl } from './moment-media.js';

let hlsPromise;
function loadHls() {
  if (globalThis.Hls) return Promise.resolve(globalThis.Hls);
  return hlsPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = new URL('../vendor/hls.min.js', import.meta.url).href;
    script.onload = () => resolve(globalThis.Hls); script.onerror = reject; document.head.append(script);
  }).catch((error) => { hlsPromise = null; throw error; });
}
const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** Compact source-backed clip player; the original movie is never fetched as a download. */
export function openMomentViewer({ row, mediaUrl, resolveSources, playNative, saveVideo, onEpisode, onWork, toast = () => {} }) {
  const moment = momentOf(row);
  if (!moment) { toast('تعذّر قراءة مدى اللقطة'); return { destroy() {}, handleBack: () => false }; }
  ensureMomentStyles();
  const previousFocus = document.activeElement, controller = new AbortController();
  const overlay = node('div', 'mv-viewer'); overlay.dir = 'rtl'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', 'مشاهدة اللقطة');
  const panel = node('section', 'mv-panel'), top = node('div', 'mv-top');
  const title = node('bdi', 'mv-title', row.series_title || 'لقطة');
  const close = node('button', 'mv-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'إغلاق اللقطة');
  top.append(title, close);
  const stage = node('div', 'mv-stage'), video = node('video', 'mv-video');
  video.playsInline = true; video.preload = 'metadata'; video.controls = false;
  const poster = moment.posterKey && mediaUrl ? mediaUrl(moment.posterKey) : row.cover_url;
  if (safeMediaUrl(poster)) video.poster = safeMediaUrl(poster);
  const status = node('p', 'mv-status', 'نجهّز اللقطة…'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  stage.append(video, status);
  const controls = node('div', 'mv-controls'), toggle = node('button', 'mv-toggle', 'إيقاف'), progress = node('input', 'mv-progress'), time = node('span', 'mv-time');
  toggle.type = 'button'; progress.type = 'range'; progress.min = '0'; progress.max = String((moment.endMs - moment.startMs) / 1000); progress.step = '.1'; progress.value = '0'; progress.setAttribute('aria-label', 'موضع اللقطة');
  controls.append(toggle, progress, time);
  const end = node('div', 'mv-end'); end.hidden = true;
  const actions = {};
  for (const [key, label] of [['episode', 'شاهد الحلقة'], ['work', 'انتقل إلى العمل'], ['replay', 'أعد تشغيل اللقطة'], ['save', 'حفظ في الصور']]) {
    const button = node('button', '', label); button.type = 'button'; button.dataset.action = key; actions[key] = button; end.append(button);
  }
  panel.append(top, stage, controls, end); overlay.append(panel); document.body.append(overlay);
  let destroyed = false, ended = false, sources = [], index = -1, current = null, hls = null, sourceLease = null, blobLease = null, loadVersion = 0, fallbackTimer = null, boundaryTimer = null, discovery = null;
  let trimmed = moment.trimmed, saving = false, fallbackBlob = false;
  const nativeTried = new Set(), prepared = new Map();
  const duration = (moment.endMs - moment.startMs) / 1000;
  const start = () => trimmed ? 0 : moment.startMs / 1000;
  const say = (message) => { status.textContent = message; status.hidden = !message; };
  const paint = () => { const seconds = ended ? duration : Math.min(duration, Math.max(0, (video.currentTime || 0) - start())); progress.value = String(seconds); time.textContent = `${clock(seconds)} / ${clock(duration)}`; };
  const complete = () => { if (ended || destroyed) return; ended = true; clearTimeout(boundaryTimer); video.pause(); if (video.currentTime > start() + duration) video.currentTime = start() + duration; if (hls) hls.stopLoad(); end.hidden = false; toggle.textContent = 'إعادة'; paint(); };
  const armBoundary = () => {
    clearTimeout(boundaryTimer);
    if (!destroyed && !ended && !video.paused) boundaryTimer = setTimeout(complete, Math.max(0, (start() + duration - video.currentTime) / (video.playbackRate || 1) * 1000));
  };
  async function play() {
    try { await video.play(); if (!destroyed) { toggle.textContent = 'إيقاف'; say(''); } }
    catch (error) { if (!destroyed && error?.name !== 'AbortError') { toggle.textContent = 'تشغيل'; say('اضغط تشغيل لبدء اللقطة'); } }
  }
  async function setSource(source, version) {
    if (source.prepare) {
      let ready = prepared.get(source);
      if (!ready) { ready = Promise.resolve().then(() => source.prepare()); prepared.set(source, ready); }
      source = { ...source, ...await ready, prepare: undefined };
    }
    if (destroyed || version !== loadVersion) return;
    current = source; trimmed = Boolean(source.clipped || source.trimmed || moment.mediaKey && source.ownedClip);
    const url = source.clipped && String(source.url).startsWith('blob:') ? source.url : safeMediaUrl(source.url);
    if (!url) throw new Error('Source needs native playback');
    if (Object.keys(source.headers ?? {}).length && !source.session) throw new Error('Source needs native request headers');
    hls?.destroy(); hls = null;
    const isHls = /m3u8(?:$|\?)/i.test(url) || /hls|mpegurl/i.test(source.type ?? '');
    if (isHls && !video.canPlayType?.('application/vnd.apple.mpegurl')) {
      const Hls = await loadHls(); if (destroyed || version !== loadVersion) return;
      if (!Hls?.isSupported?.()) throw new Error('HLS unavailable');
      hls = new Hls({ maxBufferLength: Math.min(30, duration + 2), maxMaxBufferLength: Math.min(60, duration + 4), backBufferLength: 0, startPosition: start(), maxBufferSize: 16 * 1024 * 1024 });
      hls.on(Hls.Events.ERROR, (_, error) => { if (error.fatal) void advance(); }); hls.loadSource(url); hls.attachMedia(video);
    } else { video.src = url; video.load?.(); }
    fallbackTimer = setTimeout(() => { if (!destroyed && !video.videoWidth && !ended) void advance(); }, 15000);
  }
  async function advance() {
    clearTimeout(fallbackTimer); clearTimeout(boundaryTimer); video.pause();
    const version = ++loadVersion;
    if (current && playNative && current.nativeCandidate && !nativeTried.has(current.candidate ?? current.url)) {
      nativeTried.add(current.candidate ?? current.url);
      try { const result = await playNative({ row, source: current }); if (destroyed || version !== loadVersion) return; if (result !== false && result?.ok !== false) { say(''); complete(); return; } } catch {}
    }
    if (destroyed || version !== loadVersion) return;
    index++;
    if (index >= sources.length && discovery) {
      say('نبحث عن مصدر آخر على جهازك…');
      await discovery; discovery = null;
      if (destroyed || version !== loadVersion) return;
    }
    if (index >= sources.length) {
      // Only a verified small, trimmed artifact may use the downloaded-blob fallback.
      if (moment.mediaKey && mediaUrl && !fallbackBlob) {
        fallbackBlob = true;
        try {
          blobLease = await momentMediaCache.acquire(mediaUrl(moment.mediaKey), { signal: controller.signal });
          if (destroyed) return;
          await setSource({ url: blobLease.url, clipped: true }, version); return;
        } catch {}
      }
      say(saveVideo ? 'تعذّر تشغيل هذا المصدر هنا. جرّب حفظ اللقطة لتشغيل نسخة محلية.' : 'تعذّر تشغيل اللقطة بهذا المتصفح. جرّب مصدرًا آخر أو افتح الحلقة.');
      end.hidden = false; toggle.textContent = 'إعادة'; return;
    }
    current = sources[index]; ended = false; end.hidden = true; say('نجهّز اللقطة…');
    try { await setSource(current, version); } catch { if (!destroyed && version === loadVersion) void advance(); }
  }
  video.onloadedmetadata = () => {
    if (destroyed) return;
    if (video.videoWidth && video.videoHeight) {
      stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      stage.style.width = `min(100%, ${61 * video.videoWidth / video.videoHeight}dvh)`;
    }
    video.currentTime = start(); paint(); void play();
  };
  video.ontimeupdate = () => { paint(); if (video.currentTime >= start() + duration - .01) complete(); else armBoundary(); };
  video.onended = complete; video.onerror = () => { if (!destroyed) void advance(); };
  video.onplaying = () => { clearTimeout(fallbackTimer); say(''); toggle.textContent = 'إيقاف'; armBoundary(); };
  video.onseeked = armBoundary; video.onratechange = armBoundary; video.onpause = () => clearTimeout(boundaryTimer);
  toggle.onclick = () => { if (ended) replay(); else if (video.paused) void play(); else { video.pause(); toggle.textContent = 'تشغيل'; } };
  progress.oninput = () => { ended = false; end.hidden = true; video.currentTime = start() + Number(progress.value); paint(); };
  function replay() { ended = false; end.hidden = true; video.currentTime = start(); if (hls) hls.startLoad(start()); void play(); }
  actions.replay.onclick = replay;
  actions.episode.onclick = () => { destroy(); onEpisode?.(row); };
  actions.work.onclick = () => { destroy(); onWork?.(row); };
  actions.save.onclick = async () => {
    if (saving) return;
    saving = true; actions.save.disabled = true; const filename = `VANTARA-moment-${row.id || Date.now()}.mp4`;
    try {
      if (saveVideo) {
        let source = current ?? sources[0];
        if (source?.prepare) { const ready = prepared.get(source) ?? Promise.resolve().then(() => source.prepare()); prepared.set(source, ready); source = { ...source, ...await ready }; }
        const result = await saveVideo({ row, source, startMs: moment.startMs, endMs: moment.endMs, filename });
        if (destroyed) return;
        if (result?.clipped && result.url) { ended = false; end.hidden = true; await setSource({ ...result, clipped: true }, ++loadVersion); }
        toast('حُفظت اللقطة');
      } else if (moment.mediaKey && mediaUrl) {
        const lease = await momentMediaCache.acquire(mediaUrl(moment.mediaKey), { signal: controller.signal });
        const a = node('a'); a.href = lease.url; a.download = filename; document.body.append(a); a.click(); a.remove(); lease.release(); toast('تم تنزيل اللقطة');
      } else toast('حفظ اللقطة يحتاج تصدير الفيديو على هذا الجهاز');
    } catch { toast('تعذّر حفظ اللقطة. جرّب مصدرًا آخر.'); }
    finally { saving = false; if (!destroyed) actions.save.disabled = false; }
  };
  if (!saveVideo && !moment.mediaKey) { actions.save.disabled = true; actions.save.title = 'الحفظ غير متاح على هذا الجهاز'; }
  const keyboard = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); destroy(); }
    else if (event.key === 'Tab') {
      const buttons = [...overlay.querySelectorAll('button, input')].filter((n) => !n.disabled && !n.closest('[hidden]'));
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  function destroy() {
    if (destroyed) return; destroyed = true; loadVersion++; controller.abort(); clearTimeout(fallbackTimer); clearTimeout(boundaryTimer);
    document.removeEventListener('keydown', keyboard); video.onloadedmetadata = video.ontimeupdate = video.onerror = video.onended = video.onplaying = video.onseeked = video.onratechange = video.onpause = null;
    video.pause(); video.removeAttribute('src'); video.load?.(); hls?.destroy(); sourceLease?.release(); blobLease?.release(); overlay.remove(); previousFocus?.focus?.();
  }
  document.addEventListener('keydown', keyboard); close.onclick = destroy; overlay.onclick = (event) => { if (event.target === overlay) destroy(); }; close.focus(); paint();
  void (async () => {
    try {
      const hints = Array.isArray(moment.sources) ? moment.sources.filter((s) => typeof s === 'object' && safeMediaUrl(s.url)).map((s) => ({ ...s })) : [];
      sources = moment.mediaKey && mediaUrl ? [{ url: mediaUrl(moment.mediaKey), ownedClip: true }, ...hints] : hints;
      if (resolveSources) {
        discovery = acquireMomentSources(row, resolveSources, { signal: controller.signal }).then((lease) => {
          if (destroyed) { lease.release(); return; }
          sourceLease = lease;
          const seen = new Set(sources.map((s) => s.candidate ?? s.url));
          for (const source of lease.sources) { const key = source.candidate ?? source.url; if (key && seen.has(key)) continue; if (key) seen.add(key); sources.push(source); }
        }).catch(() => {});
        if (!sources.length) { await discovery; discovery = null; }
      }
      await advance();
    } catch { if (!destroyed) { say('تعذّر تجهيز المصدر. افتح الحلقة أو حاول مرة أخرى.'); end.hidden = false; } }
  })();
  return { destroy, handleBack() { if (destroyed) return false; destroy(); return true; } };
}
