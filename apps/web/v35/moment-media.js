/** Moment files are already trimmed: episode timestamps are attribution, not a seek offset. */
export function momentOf(row) {
  if (!/^(anime|cinema):/.test(row?.series_ref ?? '')) return null;
  let value = row.moment_json;
  try { if (typeof value === 'string') value = JSON.parse(value); } catch { value = null; }
  if (value?.version === 1 && Number.isFinite(value.startMs) && Number.isFinite(value.endMs) && value.startMs >= 0 && value.endMs > value.startMs) {
    return { ...value, trimmed: typeof value.mediaKey === 'string' && Boolean(value.mediaKey) };
  }
  const label = String(row.chapter_label ?? '').replace(/[٠-٩]/g, (n) => String(n.charCodeAt(0) - 1632));
  const match = label.match(/(?:الحلقة\s*(\d+(?:\.\d+)?))?\s*·\s*((?:\d+:)?\d+:\d{2})\s*[–—-]\s*((?:\d+:)?\d+:\d{2})/);
  if (!match) return null;
  const ms = (t) => t.split(':').reduce((total, n) => total * 60 + Number(n), 0) * 1000;
  const startMs = ms(match[2]), endMs = ms(match[3]);
  return endMs > startMs ? { version: 0, startMs, endMs, episode: Number(match[1] || row.chapter_number) || 1, trimmed: false } : null;
}

export function safeMediaUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value, globalThis.location?.href ?? 'https://vantara.invalid/');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function ensureMomentStyles() {
  if (document.querySelector('link[data-moment-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = new URL('./moment-viewer.css', import.meta.url).href;
  link.dataset.momentStyles = ''; document.head.append(link);
}

const abortError = () => new DOMException('Moment request cancelled', 'AbortError');
/** Public media only; no account cookies or arbitrary source headers cross origins. */
export function createMomentMediaCache({ fetcher = (...args) => fetch(...args), maxEntries = 6, maxBytes = 64 * 1024 * 1024, maxClipBytes = 16 * 1024 * 1024, concurrency = 2, createUrl = (blob) => URL.createObjectURL(blob), revokeUrl = (url) => URL.revokeObjectURL(url) } = {}) {
  const entries = new Map(), queue = [];
  let active = 0, bytes = 0;
  const evict = () => {
    for (const [key, entry] of entries) {
      if (entries.size <= maxEntries && bytes <= maxBytes) break;
      if (entry.users || !entry.blob) continue;
      entries.delete(key); bytes -= entry.blob.size; revokeUrl(entry.objectUrl);
    }
  };
  const read = async (response, signal) => {
    if (!response.ok) throw new Error('Moment download failed');
    if (Number(response.headers.get('content-length')) > maxClipBytes) throw new Error('Moment size exceeds limit');
    if (!response.body?.getReader) {
      const blob = await response.blob();
      if (blob.size > maxClipBytes) throw new Error('Moment size exceeds limit');
      return blob;
    }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) {
        if (signal.aborted) throw abortError();
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > maxClipBytes) throw new Error('Moment size exceeds limit');
        chunks.push(part.value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    return new Blob(chunks, { type: response.headers.get('content-type') || 'video/mp4' });
  };
  const pump = () => {
    while (active < concurrency && queue.length) {
      const entry = queue.shift();
      if (entry.controller.signal.aborted) { entry.reject(abortError()); continue; }
      active++;
      Promise.resolve().then(() => fetcher(entry.key, { signal: entry.controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' }))
        .then((response) => read(response, entry.controller.signal))
        .then((blob) => {
          if (entry.controller.signal.aborted) throw abortError();
          entry.blob = blob; entry.objectUrl = createUrl(blob); bytes += blob.size;
          entry.resolve(entry); evict();
        }).catch((error) => { entries.delete(entry.key); entry.reject(error); })
        .finally(() => { active--; pump(); });
    }
  };
  function acquire(url, { signal } = {}) {
    const key = safeMediaUrl(url);
    if (!key) return Promise.reject(new Error('Unsupported media URL'));
    if (signal?.aborted) return Promise.reject(abortError());
    let entry = entries.get(key);
    if (!entry) {
      entry = { key, users: 0, controller: new AbortController(), blob: null };
      entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
      entries.set(key, entry); queue.push(entry);
    } else { entries.delete(key); entries.set(key, entry); }
    entry.users++;
    let released = false;
    const release = () => {
      if (released) return; released = true; entry.users--;
      if (!entry.users && !entry.blob) { entry.controller.abort(); entries.delete(key); }
      evict();
    };
    const result = new Promise((resolve, reject) => {
      const abort = () => { release(); reject(abortError()); };
      signal?.addEventListener('abort', abort, { once: true });
      entry.promise.then((ready) => {
        signal?.removeEventListener('abort', abort);
        if (released) return;
        resolve({ url: ready.objectUrl, blob: ready.blob, release });
      }, (error) => { signal?.removeEventListener('abort', abort); release(); reject(error); });
    });
    pump(); return result;
  }
  return {
    acquire,
    async prefetch(url, options) { const lease = await acquire(url, options); lease.release(); },
    stats: () => ({ entries: entries.size, bytes, active, queued: queue.length }),
    clear() {
      for (const entry of entries.values()) { entry.controller.abort(); if (entry.objectUrl) revokeUrl(entry.objectUrl); }
      entries.clear(); bytes = 0;
    },
  };
}

export const momentMediaCache = createMomentMediaCache();

/** Resolver descriptors are bounded separately from optional small trimmed MP4 artifacts. */
export function createMomentSourceCache(resolveSources, { maxEntries = 6, concurrency = 2 } = {}) {
  const entries = new Map(), queue = []; let active = 0;
  const dispose = (entry) => {
    if (entry.disposed || !entry.sources || entry.users) return;
    entry.disposed = true;
    const releases = new Set(entry.sources.map((source) => source.release).filter((release) => typeof release === 'function'));
    for (const release of releases) { try { Promise.resolve(release()).catch(() => {}); } catch {} }
  };
  const remove = (entry) => { if (entries.get(entry.key) === entry) entries.delete(entry.key); };
  const evict = () => {
    for (const [key, entry] of entries) {
      if (entries.size <= maxEntries) break;
      if (!entry.users && entry.sources) { entries.delete(key); dispose(entry); }
    }
  };
  const pump = () => {
    while (active < concurrency && queue.length) {
      const entry = queue.shift();
      if (entry.retired || !entry.users) { remove(entry); entry.pending = false; entry.reject(abortError()); continue; }
      active++;
      Promise.resolve().then(() => resolveSources(entry.row)).then((sources) => {
        entry.sources = Array.isArray(sources) ? sources : []; entry.pending = false;
        if (entry.retired) { dispose(entry); return; }
        entry.resolve(entry.sources); evict();
      }, (error) => { remove(entry); entry.pending = false; entry.reject(error); }).finally(() => { active--; pump(); });
    }
  };
  return {
    acquire(row, { signal } = {}) {
      if (signal?.aborted) return Promise.reject(abortError());
      const key = `${row.id ?? row.series_ref}/${row.moment_json ?? row.chapter_label}`;
      let entry = entries.get(key);
      if (!entry) {
        entry = { key, row, users: 0, sources: null, pending: true, retired: false, disposed: false };
        entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
        entries.set(key, entry); queue.push(entry);
      } else { entries.delete(key); entries.set(key, entry); }
      entry.users++; let released = false;
      const release = () => { if (!released) { released = true; entry.users--; if (entry.retired) dispose(entry); else evict(); } };
      const promise = new Promise((resolve, reject) => {
        const abort = () => { release(); reject(abortError()); };
        signal?.addEventListener('abort', abort, { once: true });
        entry.promise.then((sources) => { signal?.removeEventListener('abort', abort); if (!released) resolve({ sources, release }); }, (error) => { signal?.removeEventListener('abort', abort); release(); reject(error); });
      });
      pump(); return promise;
    },
    clear() {
      for (const entry of entries.values()) { entry.retired = true; if (entry.pending) entry.reject(abortError()); dispose(entry); }
      entries.clear();
    },
  };
}
const sourceCaches = new WeakMap();
export function acquireMomentSources(row, resolveSources, options) {
  let cache = sourceCaches.get(resolveSources);
  if (!cache) { cache = createMomentSourceCache(resolveSources); sourceCaches.set(resolveSources, cache); }
  return cache.acquire(row, options);
}

export function clearMomentSources(resolveSources) { sourceCaches.get(resolveSources)?.clear(); }

/** No autoplay and no full-source blob fetch. A visible source gets metadata and one frame. */
export function createMomentPreviews({ mediaUrl, resolveSources, cache = momentMediaCache, root = null } = {}) {
  const items = new Map(); let destroyed = false;
  const stop = (item, owner = null) => {
    if (owner && item.controller !== owner) return;
    clearTimeout(item.timer); item.timer = null;
    item.controller?.abort(); item.controller = null;
    if (item.video) item.video.onloadedmetadata = item.video.onloadeddata = item.video.onseeked = item.video.onerror = null;
    item.video?.pause?.(); item.video?.removeAttribute('src'); item.video?.load?.(); item.video?.remove(); item.video = null;
    item.lease?.release(); item.lease = null;
  };
  async function prepare(item) {
    if (destroyed || item.controller || item.finished || globalThis.navigator?.connection?.saveData) return;
    const controller = item.controller = new AbortController();
    let lease;
    try {
      let url;
      if (item.moment.mediaKey && mediaUrl) {
        url = safeMediaUrl(mediaUrl(item.moment.mediaKey));
        if (!url || !/\/v1\/media\/[^/]+$/.test(new URL(url).pathname)) return;
        lease = await cache.acquire(url, { signal: controller.signal }); url = lease.url;
      } else if (resolveSources) {
        lease = await acquireMomentSources(item.row, resolveSources, { signal: controller.signal });
        // Snapshot a public URL directly. Background preparation could replace Windows' active proxy.
        const source = lease.sources.find((s) => safeMediaUrl(s.url) && !Object.keys(s.headers ?? {}).length);
        url = source && safeMediaUrl(source.url);
      }
      if (destroyed || controller.signal.aborted || item.controller !== controller) { lease?.release(); stop(item, controller); return; }
      item.lease = lease;
      item.ready = true; item.shot.dataset.ready = 'true';
      if (!url || item.moment.posterKey) { item.finished = true; stop(item, controller); return; }
      const video = item.video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.preload = 'metadata'; video.crossOrigin = 'anonymous';
      let positioned = Boolean(item.moment.trimmed);
      const snapshot = () => {
        if (!positioned || destroyed || controller.signal.aborted || !video.videoWidth || !video.videoHeight) return;
        item.shot.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.min(video.videoWidth, 800); canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          item.img.src = canvas.toDataURL('image/jpeg', .78);
        } catch { /* Poster remains when CORS or the codec blocks a snapshot. */ }
        item.finished = true; stop(item, controller);
      };
      video.onloadedmetadata = () => { video.currentTime = item.moment.trimmed ? 0 : item.moment.startMs / 1000; };
      video.onseeked = () => { positioned = true; snapshot(); };
      video.onloadeddata = snapshot; video.onerror = () => { item.finished = true; stop(item, controller); }; video.src = url; video.load?.();
      item.timer = setTimeout(() => stop(item, controller), 8000);
    } catch { if (!controller.signal.aborted) item.shot.dataset.ready = 'false'; lease?.release(); stop(item, controller); }
  }
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const item = items.get(entry.target); if (!item) continue;
      if (entry.isIntersecting) void prepare(item); else { clearTimeout(item.timer); stop(item); }
    }
  }, { root, threshold: .15 }) : null;
  function reset() {
    observer?.disconnect(); for (const item of items.values()) { clearTimeout(item.timer); stop(item); } items.clear();
  }
  return {
    mount(shot, row) {
      const moment = momentOf(row); if (!moment || destroyed) return;
      ensureMomentStyles(); shot.classList.add('mv-preview');
      const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy';
      const poster = moment.posterKey && mediaUrl ? mediaUrl(moment.posterKey) : row.cover_url;
      const safePoster = safeMediaUrl(poster); if (safePoster) img.src = safePoster;
      img.onload = () => { if (img.naturalWidth && img.naturalHeight && moment.posterKey) shot.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`; };
      const badge = document.createElement('span'); badge.className = 'mv-preview-play'; badge.textContent = '▶'; badge.setAttribute('aria-hidden', 'true');
      const range = document.createElement('span'); range.className = 'mv-preview-range';
      const time = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
      range.textContent = `${time(moment.startMs)}–${time(moment.endMs)}`;
      shot.replaceChildren(img, badge, range);
      const item = { shot, row, img, moment, ready: false }; items.set(shot, item); observer?.observe(shot);
    },
    reset,
    destroy() { destroyed = true; reset(); },
  };
}
