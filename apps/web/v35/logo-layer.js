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
  const doc = host.ownerDocument, image = layer.querySelector('img');
  const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  let disposed = false, valid = false, inView = true;
  const sync = () => { layer.dataset.running = String(!disposed && valid && inView && !doc.hidden && !reduce?.matches && (host._logoActive?.() ?? true)); };
  const fail = () => { if (disposed) return; valid = false; layer.hidden = true; sync(); };
  const load = () => { if (disposed) return; valid = validate(image, doc); layer.hidden = !valid; sync(); };
  image.addEventListener('load', load); image.addEventListener('error', fail);
  doc.addEventListener('visibilitychange', sync); reduce?.addEventListener?.('change', sync);
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    inView = entries.some(e => e.isIntersecting); sync();
  }) : null;
  observer?.observe(layer.parentElement);
  if (image.complete && image.naturalWidth) load();
  return () => {
    disposed = true; sync(); observer?.disconnect();
    image.removeEventListener('load', load); image.removeEventListener('error', fail);
    doc.removeEventListener('visibilitychange', sync); reduce?.removeEventListener?.('change', sync);
  };
}
