/** Local PWA export. The caller owns the returned blob URL and must revoke it. */
const MAX_BYTES = 16 * 1024 * 1024;
const cancelled = () => new DOMException('Moment export cancelled', 'AbortError');
const checkSignal = signal => { if (signal?.aborted) throw cancelled(); };

export function validateMomentRange(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs || endMs - startMs > 70_000) {
    throw new Error('Select a valid moment range of up to 70 seconds');
  }
  return { start: startMs / 1000, end: endMs / 1000, duration: (endMs - startMs) / 1000 };
}

export function selectMomentRecorderType(Recorder = globalThis.MediaRecorder) {
  for (const type of ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
    if (Recorder?.isTypeSupported?.(type)) return type;
  }
  throw new Error('This browser cannot record a playable moment');
}

export function momentExportFilename(filename, mimeType) {
  const base = String(filename || 'VANTARA-moment').split(/[\\/]/).at(-1).replace(/\.(mp4|webm|mkv|mov)$/i, '').replace(/[^\p{L}\p{N} _.-]/gu, '_').slice(0, 100) || 'VANTARA-moment';
  return `${base}.${mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
}

const playbackError = () => new Error('This source cannot be captured in the browser. It may require CORS permission, authentication, or a different video codec.');

function waitForMedia(video, event, signal, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timeout);
      video.removeEventListener(event, success);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve();
    };
    const success = () => finish();
    const failed = () => finish(playbackError());
    const abort = () => finish(cancelled());
    const timeout = setTimeout(() => finish(new Error('Video preparation timed out. Try a source that plays in the browser.')), timeoutMs);
    video.addEventListener(event, success, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function loadHls(signal) {
  if (globalThis.Hls) return globalThis.Hls;
  checkSignal(signal);
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const finish = error => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      script.onload = script.onerror = null;
      if (error) { script.remove(); reject(error); } else resolve();
    };
    const abort = () => finish(cancelled());
    const timer = setTimeout(() => finish(new Error('HLS player could not be loaded')), 20_000);
    script.src = '/vendor/hls.min.js';
    script.onload = () => finish();
    script.onerror = () => finish(new Error('HLS player could not be loaded'));
    signal?.addEventListener('abort', abort, { once: true });
    document.head.append(script);
  });
  return globalThis.Hls;
}

function recordRange(video, stream, range, mimeType, signal) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0, failure = null, finishing = false, frame = null;
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_100_000, audioBitsPerSecond: 96_000 });
    const cleanup = () => {
      clearTimeout(deadline);
      clearInterval(interval);
      if (frame !== null) video.cancelVideoFrameCallback?.(frame);
      video.removeEventListener('timeupdate', tick);
      video.removeEventListener('ended', ended);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', abort);
    };
    const finish = error => {
      if (finishing) return;
      finishing = true;
      failure = error || null;
      video.pause();
      cleanup();
      if (recorder.state !== 'inactive') recorder.stop();
      else reject(failure || new Error('Video recording stopped unexpectedly'));
    };
    const tick = () => { if (video.currentTime >= range.end) finish(); };
    const ended = () => finish(video.currentTime < range.end - 0.1 ? new Error('The video ended before the selected range') : null);
    const failed = () => finish(playbackError());
    const abort = () => finish(cancelled());
    const deadline = setTimeout(() => finish(new Error('Video playback stalled while exporting the moment')), (range.duration + 30) * 1000);
    const interval = setInterval(tick, 25);
    const onFrame = (_now, metadata) => {
      if (finishing) return;
      if (metadata.mediaTime >= range.end) return finish();
      frame = video.requestVideoFrameCallback(onFrame);
    };
    recorder.ondataavailable = ({ data }) => {
      if (!data?.size || failure) return;
      bytes += data.size;
      if (bytes > MAX_BYTES) return finish(new Error('The recorded moment exceeds the 16 MiB limit'));
      chunks.push(data);
    };
    recorder.onerror = () => finish(new Error('The browser failed to encode the selected moment'));
    recorder.onstop = () => {
      cleanup();
      // The final chunk can arrive after stop(); enforce the limit again here.
      if (failure || !bytes || bytes > MAX_BYTES) reject(failure || new Error('No playable moment was recorded'));
      else resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }));
    };
    video.addEventListener('timeupdate', tick);
    video.addEventListener('ended', ended);
    video.addEventListener('error', failed);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      checkSignal(signal);
      recorder.start(250);
      if (video.requestVideoFrameCallback) frame = video.requestVideoFrameCallback(onFrame);
      Promise.resolve(video.play()).catch(() => finish(playbackError()));
    } catch (error) { finish(error); }
  });
}

/** Records only the selected interval in real time. This never downloads a movie and labels it a clip.
 * Default: download the actual clip. externalShare: request the OS share sheet instead.
 * Sharing may require a fresh user gesture after recording; errors are returned to the caller.
 */
export async function exportBrowserMoment({ source, startMs, endMs, filename, signal, externalShare = false }) {
  checkSignal(signal);
  const range = validateMomentRange(startMs, endMs);
  const mimeType = selectMomentRecorderType();
  if (!globalThis.document || !globalThis.HTMLVideoElement || (!HTMLVideoElement.prototype.captureStream && !HTMLVideoElement.prototype.mozCaptureStream)) {
    throw new Error('This browser cannot capture video. Save the moment from the Android or Windows app.');
  }
  const url = typeof source === 'string' ? source : source?.url;
  if (!url || source?.drm || (source?.headers && Object.keys(source.headers).length)) {
    throw new Error('This source requires playback access that browser capture cannot provide');
  }
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.style.cssText = 'position:fixed;width:2px;height:2px;bottom:0;left:0;opacity:0.01;pointer-events:none;';
  video.setAttribute('aria-hidden', 'true');
  document.body.append(video);
  let hls = null, stream = null, resultUrl = null;
  try {
    const hlsSource = /\.m3u8(?:[?#]|$)/i.test(url) || /mpegurl/i.test(source?.mimeType || source?.type || '');
    if (hlsSource && !video.canPlayType('application/vnd.apple.mpegurl')) {
      const Hls = await loadHls(signal);
      if (!Hls?.isSupported?.()) throw new Error('HLS capture is not supported in this browser');
      hls = new Hls({ startPosition: range.start, maxBufferLength: 15, maxMaxBufferLength: 30 });
      hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) video.dispatchEvent(new Event('error')); });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else video.src = url;
    if (video.readyState < 1) await waitForMedia(video, 'loadedmetadata', signal);
    checkSignal(signal);
    if (!Number.isFinite(video.duration) || range.end > video.duration + 0.05) throw new Error('Select a range inside a finite video that plays in this browser');
    if (Math.abs(video.currentTime - range.start) > 0.01) {
      const seek = waitForMedia(video, 'seeked', signal);
      video.currentTime = range.start;
      await seek;
    }
    if (video.readyState < 2) await waitForMedia(video, 'loadeddata', signal);
    checkSignal(signal);
    stream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
    if (!stream.getVideoTracks().length) throw playbackError();
    const blob = await recordRange(video, stream, range, mimeType, signal);
    checkSignal(signal);
    const actualFilename = momentExportFilename(filename, blob.type);
    if (externalShare) {
      const file = new File([blob], actualFilename, { type: blob.type });
      if (!navigator.share || !navigator.canShare?.({ files: [file] })) throw new Error('File sharing is not available in this browser. Download the moment instead.');
      await navigator.share({ files: [file] });
    } else {
      const link = document.createElement('a');
      if (!('download' in link)) throw new Error('File downloading is not supported in this browser');
      resultUrl = URL.createObjectURL(blob);
      link.href = resultUrl;
      link.download = actualFilename;
      document.body.append(link);
      link.click();
      link.remove();
    }
    resultUrl ??= URL.createObjectURL(blob);
    return { url: resultUrl, clipped: true, filename: actualFilename };
  } catch (error) {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    throw error;
  } finally {
    video.pause();
    stream?.getTracks().forEach(track => track.stop());
    hls?.destroy();
    video.removeAttribute('src');
    video.load();
    video.remove();
  }
}
