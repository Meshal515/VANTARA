/** A decorative official-logo strip. Never changes work metadata or synthesizes artwork. */
export function transparentLogoPixels(pixels) {
  let clear = 0, ink = 0;
  for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] < 24) clear++; if (pixels[i] > 96) ink++; }
  return clear > pixels.length / 400 && ink > pixels.length / 400;
}
export function validLogoImage(image, document) {
  if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) return false;
  try {
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 48;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, 96, 48);
    return transparentLogoPixels(ctx.getImageData(0, 0, 96, 48).data);
  } catch { return false; } // Unreadable/CORS artwork stays out of the decorative layer.
}
export function mountLogoLayer(host, { validate = validLogoImage } = {}) {
  const layer = host.querySelector('.wl-logo-layer');
  if (!layer) return () => {};
  const doc = host.ownerDocument;
  const image = layer.querySelector('img');
  const entrance = layer.querySelector('.wl-logo-entry');
  const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  let disposed = false, valid = false, entered = false, inView = true;

  const sync = () => {
    layer.dataset.running = String(!disposed && valid && entered && inView &&
      !doc.hidden && !reduce?.matches && (host._logoActive?.() ?? true));
  };
  const fail = () => {
    if (disposed) return;
    valid = false;
    entered = false;
    layer.hidden = true;
    delete layer.dataset.ready;
    delete layer.dataset.entered;
    sync();
  };
  const finishEntrance = () => {
    if (disposed || !valid) return;
    entered = true;
    layer.dataset.entered = 'true';
    sync();
  };
  const reveal = () => {
    if (disposed) return;
    valid = true;
    layer.hidden = false;
    layer.dataset.ready = 'true';
    // No entrance animation for accessibility (or older standalone markup).
    if (reduce?.matches || !entrance) finishEntrance();
    sync();
  };
  const load = () => {
    if (disposed) return;
    if (!validate(image, doc)) return fail();
    // The first visible frame must be decoded; otherwise it flashes at mid-screen.
    if (typeof image.decode === 'function') {
      Promise.resolve().then(() => image.decode()).then(reveal, fail);
    } else reveal();
  };
  const onEntranceEnd = (e) => {
    if (e.target === entrance && e.animationName === 'wl-logo-enter') finishEntrance();
  };
  const onMotionChange = () => {
    if (reduce?.matches && valid) finishEntrance();
    sync();
  };
  image.addEventListener('load', load);
  image.addEventListener('error', fail);
  entrance?.addEventListener('animationend', onEntranceEnd);
  doc.addEventListener('visibilitychange', sync);
  reduce?.addEventListener?.('change', onMotionChange);
  // Observe the stable layer itself: the head may repaint, but this node does not.
  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      inView = entries.some((e) => e.isIntersecting);
      sync();
    }) : null;
  observer?.observe(layer);
  if (image.complete && image.naturalWidth) load();
  return () => {
    disposed = true;
    sync();
    observer?.disconnect();
    image.removeEventListener('load', load);
    image.removeEventListener('error', fail);
    entrance?.removeEventListener('animationend', onEntranceEnd);
    doc.removeEventListener('visibilitychange', sync);
    reduce?.removeEventListener?.('change', onMotionChange);
  };
}
