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

const SPEED = 12; // Physical CSS pixels per active second, at every viewport size.
const transform = x => `translate3d(${x}px, 0, 0)`;
const modulo = (n, period) => ((n % period) + period) % period;

export function mountLogoLayer(host, { validate = validLogoImage } = {}) {
  const layer = host.querySelector('.wl-logo-layer');
  const train = layer?.querySelector('.wl-logo-train');
  const image = train?.querySelector('img');
  if (!image) return () => {};
  const doc = host.ownerDocument;
  const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  let disposed = false, valid = false, inView = true, generation = 0;
  let animation = null, motion = null, geometry = null;

  const running = () => !disposed && valid && inView && !doc.hidden && !reduce?.matches && (host._logoActive?.() ?? true);
  const sync = () => {
    const on = running();
    layer.dataset.running = String(on && Boolean(animation));
    if (!animation) return;
    if (on && animation.playState === 'paused') animation.play();
    else if (!on && animation.playState !== 'paused') animation.pause();
  };
  // The compositor's currentTime is the active-distance clock. Reading it only on
  // resize/visibility/finish preserves phase without running a JS frame loop.
  const position = () => {
    if (!animation || !motion) return geometry?.start ?? 0;
    const travelled = Math.max(0, Number(animation.currentTime) || 0) * SPEED / 1000;
    return motion.kind === 'entry' ? motion.from - travelled : motion.from - modulo(travelled, motion.period);
  };
  const cancel = () => {
    if (animation) { animation.onfinish = null; animation.cancel(); animation = null; }
  };
  const animateAt = (offset, boundaryTime = null) => {
    cancel();
    if (typeof train.animate !== 'function') {
      train.style.transform = transform(0);
      sync();
      return;
    }
    // The first logo starts only 8px beyond the physical right edge. Subsequent
    // tiles follow at their real width + gap; entry and repetition both use 12px/s.
    const entry = offset > 0;
    if (!entry) offset = -modulo(-offset, geometry.stride);
    motion = { kind: entry ? 'entry' : 'loop', from: offset, period: geometry.period };
    const distance = entry ? offset : geometry.period;
    const duration = distance / SPEED * 1000;
    train.style.transform = transform(offset);
    animation = train.animate([
      { transform: transform(offset) },
      { transform: transform(entry ? 0 : offset - geometry.period) },
    ], { duration, iterations: entry ? 1 : Infinity, easing: 'linear', fill: 'both' });
    if (boundaryTime != null) animation.startTime = boundaryTime;
    layer.dataset.phase = motion.kind;
    if (entry) {
      const entering = animation;
      animation.onfinish = () => {
        if (disposed || animation !== entering) return;
        // Account for any delivery delay at the phase boundary at the same speed.
        const boundary = entering.startTime == null ? null : entering.startTime + duration;
        const overshoot = Math.max(0, (Number(entering.currentTime) || duration) - duration) * SPEED / 1000;
        animateAt(boundary == null ? -overshoot : 0, boundary);
      };
    }
    sync();
  };
  const refresh = () => {
    if (disposed || !valid) return;
    const rect = layer.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    const oldPosition = position();
    // Match CSS layout precision so a repeated group ends at exactly the next
    // group’s raster position, including fractional image aspect ratios.
    const width = Math.round(rect.height * .86 * image.naturalWidth / image.naturalHeight * 64) / 64;
    const gap = Math.round(Math.max(40, Math.min(64, rect.width * .12)) * 64) / 64;
    const stride = width + gap;
    const count = Math.ceil((rect.width + width) / stride);
    const period = count * stride;
    const changed = !geometry || geometry.period !== period || geometry.stride !== stride || geometry.left !== rect.left;
    const first = !geometry;
    let offset = first ? Math.max(rect.width, (globalThis.innerWidth || rect.right) - rect.left) + 8 : oldPosition + geometry.left - rect.left;
    if (!first && motion?.kind === 'loop') {
      // When responsive tile size/spacing changes, anchor the first visible logo
      // rather than scaling elapsed time and sliding the entire corridor.
      const prior = -modulo(-oldPosition, geometry.stride);
      offset = prior + (prior + geometry.width <= 0 ? geometry.stride : 0) + geometry.left - rect.left;
      if (offset > 0) offset -= stride;
    }
    geometry = { left: rect.left, width, stride, period, start: offset };
    layer.style.setProperty('--wl-logo-width', `${width}px`);
    layer.style.setProperty('--wl-logo-gap', `${gap}px`);
    layer.style.setProperty('--wl-logo-period', `${period}px`);
    for (const group of train.querySelectorAll('.wl-logo-group')) {
      while (group.children.length > count) group.lastElementChild.remove();
      while (group.children.length < count) group.append(image.cloneNode(true));
    }
    // Desktop title and metadata stay fixed. Only alpha is removed from the band;
    // the original background, cover shadow, perspective and banner remain visible.
    const info = host.querySelector('.wl-info');
    const desktop = (host.closest('.aw') ?? host.querySelector('.wl-head'))?.getBoundingClientRect().width >= 900;
    let fadeStart = 0, fadeEnd = Math.min(48, rect.width * .12);
    let fadeOutStart = Math.max(0, rect.width - 24), fadeOutEnd = rect.width;
    if (desktop && info) {
      const title = info.getBoundingClientRect();
      if ((title.left + title.right) / 2 < (rect.left + rect.right) / 2) {
        fadeStart = Math.max(0, Math.min(rect.width, title.right - rect.left + 16));
        fadeEnd = Math.min(rect.width, fadeStart + 64);
      } else {
        fadeOutEnd = Math.max(0, Math.min(rect.width, title.left - rect.left - 16));
        fadeOutStart = Math.max(0, fadeOutEnd - 64);
      }
    }
    layer.style.setProperty('--wl-logo-fade-start', `${fadeStart}px`);
    layer.style.setProperty('--wl-logo-fade-end', `${fadeEnd}px`);
    layer.style.setProperty('--wl-logo-fade-out-start', `${fadeOutStart}px`);
    layer.style.setProperty('--wl-logo-fade-out-end', `${fadeOutEnd}px`);
    if (changed) animateAt(offset);
    else sync();
  };
  const fail = (reason = 'load-error') => {
    if (disposed) return;
    generation++;
    valid = false;
    layer.hidden = true;
    layer.dataset.logoState = reason;
    delete layer.dataset.ready;
    cancel(); sync();
  };
  const reveal = (ticket) => {
    if (disposed || ticket !== generation) return;
    if (!validate(image, doc)) return fail('invalid-artwork');
    valid = true;
    // CSS keeps this unready layer invisible while synchronous geometry/animation
    // setup runs. No decoded logo is ever exposed at a mid-screen base transform.
    layer.hidden = false;
    refresh();
    layer.dataset.logoState = 'ready';
    layer.dataset.ready = 'true';
    sync();
  };
  const load = () => {
    if (disposed) return;
    const ticket = ++generation;
    if (typeof image.decode === 'function') {
      Promise.resolve().then(() => image.decode()).then(() => reveal(ticket), () => { if (ticket === generation) fail('decode-error'); });
    } else reveal(ticket);
  };
  const onError = () => fail('load-error');
  image.addEventListener('load', load);
  image.addEventListener('error', onError);
  doc.addEventListener('visibilitychange', sync);
  reduce?.addEventListener?.('change', sync);
  const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    inView = entries.some(entry => entry.isIntersecting); sync();
  }) : null;
  intersection?.observe(layer);
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(refresh) : null;
  resize?.observe(layer);
  resize?.observe(host.querySelector('.wl-head') ?? host);
  // Direction can move the title without changing either observed box's size.
  const direction = typeof MutationObserver === 'function' ? new MutationObserver(refresh) : null;
  direction?.observe(doc.documentElement, { attributes: true, attributeFilter: ['dir'] });
  host._updateLogoLayer = refresh;
  layer.dataset.logoState = 'loading';
  if (image.complete && image.naturalWidth) load();
  return () => {
    disposed = true; generation++; cancel(); sync();
    intersection?.disconnect(); resize?.disconnect(); direction?.disconnect();
    image.removeEventListener('load', load);
    image.removeEventListener('error', onError);
    doc.removeEventListener('visibilitychange', sync);
    reduce?.removeEventListener?.('change', sync);
    if (host._updateLogoLayer === refresh) delete host._updateLogoLayer;
  };
}
