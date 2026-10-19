/** Save the reader's content pixels, never a page-sized or UI screenshot. */
const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const intersect = (a, b) => {
  const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
  return box(left, top, Math.max(0, Math.min(a.right, b.right) - left), Math.max(0, Math.min(a.bottom, b.bottom) - top));
};
const nonempty = r => r.width > 0 && r.height > 0;

/** All reader image modes use object-fit: contain with centered positioning. */
export function containImageRect(rect, naturalWidth, naturalHeight) {
  const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
  const width = naturalWidth * scale, height = naturalHeight * scale;
  return box(rect.left + (rect.width - width) / 2, rect.top + (rect.height - height) / 2, width, height);
}

/** Coordinates stay in CSS pixels until the final canvas transform. */
export function buildViewportCapture({ viewport, scroll, toolbar, tray, pages, pixelRatio = 1 }) {
  let bounds = intersect(viewport, scroll);
  if (toolbar && nonempty(intersect(bounds, toolbar))) {
    bounds = intersect(bounds, box(bounds.left, toolbar.bottom, bounds.width, Math.max(0, bounds.bottom - toolbar.bottom)));
  }
  if (tray && nonempty(intersect(bounds, tray))) {
    bounds = intersect(bounds, box(bounds.left, bounds.top, bounds.width, Math.max(0, tray.top - bounds.top)));
  }
  const visible = pages.map((page, index) => ({ ...page, index, visible: intersect(intersect(page.rect, page.clip), bounds) }))
    .filter(page => nonempty(page.visible));
  if (!visible.length) throw new Error('No visible manga content');
  // Vertical pages have an 820px maximum width on desktop. Exclude the side gutters.
  const left = Math.min(...visible.map(p => Math.max(bounds.left, p.clip.left)));
  const right = Math.max(...visible.map(p => Math.min(bounds.right, p.clip.right)));
  bounds = intersect(bounds, box(left, bounds.top, right - left, bounds.height));
  const draws = visible.map(page => {
    const clipped = intersect(page.visible, bounds);
    return {
      index: page.index,
      source: box((clipped.left - page.rect.left) * page.naturalWidth / page.rect.width,
        (clipped.top - page.rect.top) * page.naturalHeight / page.rect.height,
        clipped.width * page.naturalWidth / page.rect.width, clipped.height * page.naturalHeight / page.rect.height),
      dest: box(clipped.left - bounds.left, clipped.top - bounds.top, clipped.width, clipped.height),
    };
  });
  // Bound memory on high-DPI tablets/desktops; never allocate the full manhwa height.
  const scale = Math.min(Math.max(1, Number(pixelRatio) || 1), 3, Math.sqrt(8_000_000 / (bounds.width * bounds.height)));
  return { bounds, width: Math.max(1, Math.floor(bounds.width * scale)), height: Math.max(1, Math.floor(bounds.height * scale)), draws };
}

/** Draw synchronously at the click's scroll position, before any async storage work. */
export function captureReaderViewport(root) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const scroll = root.querySelector('#rdScroll');
  const vv = win.visualViewport;
  const viewport = vv ? box(vv.offsetLeft, vv.offsetTop, vv.width, vv.height) : box(0, 0, win.innerWidth, win.innerHeight);
  const content = intersect(intersect(viewport, root.getBoundingClientRect()), scroll.getBoundingClientRect());
  const toolbar = root.querySelector('#rdFrameTop').getBoundingClientRect();
  const tray = root.querySelector('#rdTray').getBoundingClientRect();
  const pages = [];
  for (const frame of scroll.querySelectorAll('.rd-page')) {
    const clip = frame.getBoundingClientRect();
    const available = intersect(intersect(content, box(content.left, toolbar.bottom, content.width, Math.max(0, tray.top - toolbar.bottom))), clip);
    if (!nonempty(available)) continue;
    const image = frame.querySelector(':scope > img');
    if (!image?.complete || !image.naturalWidth || !image.naturalHeight) throw new Error('انتظر تحميل الصفحات الظاهرة ثم جرّب الحفظ');
    pages.push({ image, clip, rect: containImageRect(image.getBoundingClientRect(), image.naturalWidth, image.naturalHeight), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight });
  }
  const plan = buildViewportCapture({ viewport: content, scroll: content, toolbar, tray, pages, pixelRatio: win.devicePixelRatio });
  const canvas = doc.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('تعذّر تجهيز الصورة للحفظ');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(canvas.width / plan.bounds.width, canvas.height / plan.bounds.height);
  for (const draw of plan.draws) {
    const s = draw.source, d = draw.dest;
    ctx.drawImage(pages[draw.index].image, s.left, s.top, s.width, s.height, d.left, d.top, d.width, d.height);
  }
  return canvas;
}

export async function saveViewportImage(blob, filename, { native = globalThis.Capacitor?.Plugins?.MediaLibrary, doc = globalThis.document, nav = globalThis.navigator } = {}) {
  if (!blob?.size) throw new Error('تعذّر تجهيز الصورة للحفظ');
  if (typeof native?.saveImage === 'function') {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    await native.saveImage({ base64: btoa(binary), mimeType: blob.type, filename });
    return 'gallery';
  }
  const link = doc.createElement('a');
  if ('download' in link) {
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    link.hidden = true;
    doc.body.append(link);
    link.click();
    link.remove();
    // The browser may start reading the blob after the click handler returns.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return 'download';
  }
  const file = new File([blob], filename, { type: blob.type });
  if (nav?.canShare?.({ files: [file] }) && nav.share) {
    await nav.share({ files: [file] });
    return 'shared';
  }
  throw new Error('الحفظ غير متاح في هذا المتصفح');
}
