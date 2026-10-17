const test = require('node:test');
const assert = require('node:assert/strict');
const { overlayBounds, checkedMessage, createPlayerOverlay } = require('./player-overlay.cjs');

test('مستطيل الفيديو يتحول إلى إحداثيات الشاشة فوق المحتوى، مع تكبير الصفحة', () => {
  const content = { x: 100, y: 50, width: 1400, height: 900 };
  assert.deepEqual(overlayBounds({ x: 0, y: 60, width: 1400, height: 787, viewportWidth: 1400, viewportHeight: 900 }, content), { x: 100, y: 110, width: 1400, height: 787 });
  // تكبير 125%: الصفحة ترى 1120 CSS px في 1400 DIP
  assert.deepEqual(overlayBounds({ x: 0, y: 40, width: 1120, height: 630, viewportWidth: 1120, viewportHeight: 720 }, content), { x: 100, y: 100, width: 1400, height: 788 });
  assert.equal(overlayBounds({ x: 0, y: 0, width: 0, height: 0, viewportWidth: 10, viewportHeight: 10 }, content), null);
  assert.equal(overlayBounds({ x: NaN, y: 0, width: 5, height: 5, viewportWidth: 10, viewportHeight: 10 }, content), null);
});

test('رسائل الطبقة: كائن صغير فقط', () => {
  assert.deepEqual(checkedMessage({ a: 1 }), { a: 1 });
  assert.throws(() => checkedMessage([1]));
  assert.throws(() => checkedMessage({ big: 'x'.repeat(600 * 1024) }), /الحد/);
});

function fakeElectron() {
  const made = [];
  class BrowserWindow {
    constructor(options) { this.options = options; this.visible = false; this.destroyed = false; this.bounds = null; this.sent = []; this.handlers = {};
      this.webContents = { send: (channel, value) => this.sent.push([channel, value]), on() {}, setWindowOpenHandler() {} }; made.push(this); }
    loadURL(url) { this.url = url; return Promise.resolve(); }
    on(name, fn) { this.handlers[name] = fn; }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    setBounds(b) { this.bounds = b; }
    destroy() { this.destroyed = true; }
  }
  const parent = { isDestroyed: () => false, isMinimized: () => false, getContentBounds: () => ({ x: 10, y: 20, width: 1000, height: 600 }), focus() { this.focused = true; } };
  return { BrowserWindow, parent, made };
}

test('الطبقة: شفافة يملكها البرنامج، تتبع الفيديو، تختفي معه، والأوامر من نافذتها فقط', async () => {
  const { BrowserWindow, parent, made } = fakeElectron();
  const commands = [];
  const overlay = createPlayerOverlay({ BrowserWindow, getWindow: () => parent, preload: 'p.cjs', url: 'vantara://app/desktop/overlay.html', onCommand: c => commands.push(c) });
  overlay.open({ session: 's1' });
  const win = made[0];
  assert.equal(win.options.parent, parent); assert.equal(win.options.transparent, true); assert.equal(win.options.frame, false); assert.equal(win.options.webPreferences.sandbox, true);
  overlay.viewport({ session: 's1', x: 0, y: 0, width: 1000, height: 500, viewportWidth: 1000, viewportHeight: 600 });
  assert.deepEqual(win.bounds, { x: 10, y: 20, width: 1000, height: 500 }); assert.equal(win.visible, true);
  overlay.viewport({ session: 's1', x: 0, y: 0, width: 1000, height: 500, viewportWidth: 1000, viewportHeight: 600, hidden: true });
  assert.equal(win.visible, false);
  assert.equal(overlay.viewport({ session: 'old', x: 0, y: 0, width: 5, height: 5, viewportWidth: 10, viewportHeight: 10 }), false);
  assert.equal(await overlay.state({ session: 's1', position: 5 }), true);
  assert.deepEqual(win.sent.at(-1), ['vantara:overlay', { session: 's1', position: 5 }]);
  assert.equal(await overlay.state({ session: 'other' }), false);
  assert.throws(() => overlay.command({ sender: {} }, { name: 'pause' }), /ليس من طبقة/);
  overlay.command({ sender: win.webContents }, { name: 'pause', value: true });
  assert.deepEqual(commands, [{ name: 'pause', value: true, session: 's1' }]);
  assert.throws(() => overlay.command({ sender: win.webContents }, { name: 'Bad Name' }), /غير صالح/);
  overlay.command({ sender: win.webContents }, { name: 'focus-app' }); assert.equal(parent.focused, true);
  overlay.close(); assert.equal(win.visible, false);
});
