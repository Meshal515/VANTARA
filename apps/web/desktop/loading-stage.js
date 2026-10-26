/**
 * Windows equivalent of Android LoadingStage/StageArt.
 * Independent of the native mpv HWND: rendered in the transparent overlay.
 * The logo animates indeterminately until a real player-ready event; it is NOT
 * a fabricated percent of downloaded torrent pieces.
 */
export function safeStageImage(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  const url = value.trim();
  if (/^\/(?!\/)[^\s\\]*$/.test(url)) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : null;
  } catch { return null; }
}

export function stageArtwork(data = {}) {
  const media = data.media && typeof data.media === 'object' ? data.media : {};
  const background = safeStageImage(data.banner ?? media.banner ?? data.background ?? media.background
    ?? data.poster ?? media.poster ?? data.cover ?? media.cover);
  const logo = safeStageImage(data.logo ?? media.logo);
  const title = String(data.title ?? media.title ?? 'VANTARA').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 180);
  return { background, logo, title };
}

export function createDesktopLoadingStage(doc) {
  const element = doc.createElement('div'); element.className = 'v-stage';
  element.setAttribute('role', 'status'); element.setAttribute('aria-label', 'جاري تجهيز الفيديو');
  element.dataset.mode = 'startup';
  const background = doc.createElement('img'); background.className = 'v-stage__backdrop';
  background.alt = ''; background.decoding = 'async';
  const scrim = doc.createElement('div'); scrim.className = 'v-stage__scrim';
  const content = doc.createElement('div'); content.className = 'v-stage__content';
  const mark = doc.createElement('div'); mark.className = 'v-stage__mark'; mark.hidden = true;
  const base = doc.createElement('img'); base.className = 'v-stage__logo v-stage__logo--base';
  const fill = doc.createElement('img'); fill.className = 'v-stage__logo v-stage__logo--fill';
  for (const img of [base, fill]) { img.alt = ''; img.decoding = 'async'; }
  mark.append(base, fill);
  const name = doc.createElement('strong'); name.className = 'v-stage__title';
  const pulse = doc.createElement('span'); pulse.className = 'v-stage__pulse';
  pulse.setAttribute('aria-hidden', 'true');
  content.append(mark, name, pulse);
  element.append(background, scrim, content);
  let priorBackground, priorLogo;
  function art(data) {
    const next = stageArtwork(data);
    name.textContent = next.title;
    if (priorBackground !== next.background) {
      priorBackground = next.background;
      if (next.background) background.src = next.background;
      else background.removeAttribute('src');
    }
    if (priorLogo !== next.logo) {
      priorLogo = next.logo;
      mark.hidden = true; name.hidden = false;
      for (const img of [base, fill]) img.removeAttribute('src');
      if (next.logo) {
        base.onload = () => { if (priorLogo === next.logo) { mark.hidden = false; name.hidden = true; } };
        base.onerror = () => { if (priorLogo === next.logo) { mark.hidden = true; name.hidden = false; } };
        base.src = next.logo;
        fill.src = next.logo;
      }
    }
  }
  function update(data = {}) {
    art(data);
    const mode = data.ready === true ? (data.buffering === true ? 'buffering' : 'hidden') : 'startup';
    element.dataset.mode = mode;
    element.hidden = mode === 'hidden' || data.status?.error === true;
    // No synthetic download progress. A genuine 0..1 ratio can be supplied later.
    const p = data.startupProgress;
    if (mode === 'startup' && typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1) {
      element.dataset.progress = 'measured';
      fill.style.clipPath = 'inset(0 ' + (100 - p * 100) + '% 0 0)';
    } else {
      element.dataset.progress = 'indeterminate';
      fill.style.removeProperty('clip-path');
    }
  }
  return { element, update, art, close() { element.remove(); } };
}
