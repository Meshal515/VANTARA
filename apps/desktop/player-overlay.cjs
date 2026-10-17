// طبقة أدوات المشغل فوق الفيديو، بتصميم الـAPK.
//
// الفيديو نافذة أصلية (mpv داخل HWND ابن) فلا يمكن لأي HTML في النافذة الرئيسية أن يرسم فوقه
// (airspace). الحل: نافذة شفافة بلا إطار يملكها البرنامج، موضوعة فوق مستطيل الفيديو تمامًا،
// ترسم أدوات التحكم والأوراق كما في الـAPK. المنطق كله يبقى في player.js بالنافذة الرئيسية؛
// هذه النافذة عرض فقط: تستقبل الحالة وترسل الأوامر عبر العملية الرئيسية.

/** مستطيل الفيديو (CSS px داخل الصفحة) إلى إحداثيات الشاشة (DIP) فوق محتوى النافذة الرئيسية. */
function overlayBounds(viewport, contentBounds) {
  if (!viewport || !contentBounds) return null;
  for (const key of ['x', 'y', 'width', 'height', 'viewportWidth', 'viewportHeight']) if (!Number.isFinite(viewport[key]) || viewport[key] < 0 || viewport[key] > 32768) return null;
  if (!viewport.viewportWidth || !viewport.viewportHeight || !viewport.width || !viewport.height) return null;
  const fx = contentBounds.width / viewport.viewportWidth, fy = contentBounds.height / viewport.viewportHeight;
  const x = Math.min(viewport.x, viewport.viewportWidth), y = Math.min(viewport.y, viewport.viewportHeight);
  const width = Math.round(Math.min(viewport.width, viewport.viewportWidth - x) * fx), height = Math.round(Math.min(viewport.height, viewport.viewportHeight - y) * fy);
  if (width < 2 || height < 2) return null;
  return { x: Math.round(contentBounds.x + x * fx), y: Math.round(contentBounds.y + y * fy), width, height };
}

/** رسائل الحالة إلى الطبقة: كائن عادي صغير فقط، بلا دوال ولا أحجام كبيرة. */
function checkedMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('رسالة الطبقة غير صالحة');
  const text = JSON.stringify(value);
  if (text.length > 512 * 1024) throw new Error('رسالة الطبقة أكبر من الحد');
  return JSON.parse(text);
}

function createPlayerOverlay({ BrowserWindow, getWindow, preload, url, onCommand = () => {} }) {
  let overlay = null, viewport = null, session = null, loaded = null;
  const parentAlive = () => { const w = getWindow(); return w && !w.isDestroyed() ? w : null; };
  function ensure() {
    if (overlay && !overlay.isDestroyed()) return overlay;
    const parent = parentAlive(); if (!parent) return null;
    overlay = new BrowserWindow({
      parent, show: false, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false, focusable: true, thickFrame: false,
      webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false },
    });
    overlay.setMenu?.(null);
    overlay.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
    overlay.webContents.on('will-navigate', event => event.preventDefault());
    overlay.on('closed', () => { overlay = null; loaded = null; });
    loaded = overlay.loadURL(url).catch(() => {});
    return overlay;
  }
  function place() {
    const parent = parentAlive();
    if (!overlay || overlay.isDestroyed() || !parent) return;
    const bounds = !viewport || viewport.hidden || parent.isMinimized?.() ? null : overlayBounds(viewport, parent.getContentBounds());
    if (!bounds) { if (overlay.isVisible()) overlay.hide(); return; }
    overlay.setBounds(bounds);
    if (!overlay.isVisible()) overlay.showInactive();
  }
  return {
    /** نفس مستطيل player-viewport؛ الطبقة تتبع الفيديو تمامًا وتختفي معه. */
    viewport(value) {
      if (typeof value?.session !== 'string' || !value.session) return false;
      if (session && value.session !== session) return false;
      viewport = { ...value, hidden: value.hidden === true };
      place(); return true;
    },
    open(value) {
      if (typeof value?.session !== 'string' || !value.session || value.session.length > 200) throw new Error('جلسة الطبقة غير صالحة');
      session = value.session; ensure(); return true;
    },
    async state(value) {
      const message = checkedMessage(value);
      if (message.session !== session) return false;
      const win = ensure(); if (!win) return false;
      await loaded;
      if (!win.isDestroyed()) win.webContents.send('vantara:overlay', message);
      return true;
    },
    close() { session = null; viewport = null; if (overlay && !overlay.isDestroyed()) overlay.hide(); },
    place,
    destroy() { session = null; viewport = null; if (overlay && !overlay.isDestroyed()) overlay.destroy(); overlay = null; },
    /** أمر من الطبقة: يُقبل فقط من نافذتها ويُمرَّر للنافذة الرئيسية. */
    command(event, value) {
      if (!overlay || overlay.isDestroyed() || event.sender !== overlay.webContents) throw new Error('هذا الطلب ليس من طبقة المشغل');
      const message = checkedMessage(value);
      if (typeof message.name !== 'string' || !/^[a-z-]{1,40}$/.test(message.name)) throw new Error('أمر الطبقة غير صالح');
      if (message.name === 'focus-app') { parentAlive()?.focus(); return true; }
      onCommand({ ...message, session });
      return true;
    },
    window: () => overlay,
  };
}

module.exports = { overlayBounds, checkedMessage, createPlayerOverlay };
