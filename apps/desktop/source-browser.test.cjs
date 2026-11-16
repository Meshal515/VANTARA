'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSourceBrowser, chromeUserAgent, publicHttpUrl } = require('./source-browser.cjs');

const isChallenge = ({ text = '' }) => /<title>\s*(?:just a moment|one moment)/i.test(text);

/** Electron بديل: net.request بردود معدّة، ونافذة مخفية تمر صفحة تحققها بعد نداءين. */
function fakeElectron(responses, { solvedAfter = 2 } = {}) {
  const log = { requests: [], windows: [], partition: null, userAgent: null, permissions: null };
  const ses = {
    setUserAgent: (ua) => { log.userAgent = ua; },
    setPermissionRequestHandler: (fn) => { fn(null, 'media', (ok) => { log.permissions = ok; }); },
    setPermissionCheckHandler: () => {},
    on: () => {},
  };
  const session = { fromPartition: (name) => { log.partition = name; return ses; } };
  class BrowserWindow {
    constructor(options) {
      this.options = options; this.destroyed = false; this.polls = 0;
      log.windows.push(this);
      const self = this;
      this.webContents = {
        setAudioMuted() {}, setWindowOpenHandler(fn) { self.openHandler = fn; },
        on(name, fn) { (self.events ??= {})[name] = fn; },
        async executeJavaScript() { self.polls++; return self.polls >= solvedAfter ? { title: 'Manga', html: '<html>ok</html>' } : { title: 'One moment, please...', html: '<html>wait</html>' }; },
      };
    }
    async loadURL(url, opts) { this.loaded = { url, opts }; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const net = {
    request(options) {
      const req = new EventEmitter();
      const entry = { options, headers: {}, followed: 0 };
      log.requests.push(entry);
      req.setHeader = (k, v) => { entry.headers[k.toLowerCase()] = v; };
      req.followRedirect = () => { entry.followed++; };
      req.abort = () => {};
      req.write = () => {};
      req.end = () => setImmediate(() => {
        const next = responses.shift();
        if (next.redirect) { req.emit('redirect', 302, 'GET', next.redirect); if (!next.then) return; }
        const res = new EventEmitter();
        res.statusCode = next.status ?? 200;
        res.headers = next.headers ?? { 'content-type': ['text/html'] };
        req.emit('response', res);
        res.emit('data', Buffer.from(next.body ?? ''));
        res.emit('end');
      });
      return req;
    },
  };
  return { BrowserWindow, session, net, log };
}

test('صفحة التحقق تُحل في نافذة مخفية معزولة ثم يُعاد الطلب من الجلسة نفسها', async () => {
  const e = fakeElectron([
    { body: '<html><title>One moment, please...</title></html>' },
    { body: '<html><title>مانجا</title>القائمة</html>' },
  ]);
  const ua = chromeUserAgent('146.0.7680.31');
  const browser = createSourceBrowser({ ...e, userAgent: ua, isChallenge, solveMs: 5_000 });
  const out = await browser.fetch({ url: 'https://manga.example/list', headers: { referer: 'https://manga.example/', cookie: 'x=1' } });
  assert.equal(out.viaBrowser, true);
  assert.match(out.text, /القائمة/);
  assert.equal(e.log.partition, 'persist:vantara-sources', 'جلسة مستقلة عن واجهة VANTARA');
  assert.equal(e.log.userAgent, ua);
  assert.equal(e.log.permissions, false, 'لا أذونات لصفحات المصادر');
  assert.equal(e.log.windows.length, 1);
  const win = e.log.windows[0];
  assert.equal(win.options.show, false);
  assert.deepEqual([win.options.webPreferences.sandbox, win.options.webPreferences.contextIsolation, win.options.webPreferences.nodeIntegration], [true, true, false]);
  assert.equal(win.isDestroyed(), true, 'النافذة تُغلق بعد التحقق');
  assert.deepEqual(win.openHandler(), { action: 'deny' });
  assert.equal(e.log.requests.length, 2);
  for (const r of e.log.requests) {
    assert.equal(r.options.useSessionCookies, true);
    assert.equal(r.headers['user-agent'], ua);
    assert.equal(r.headers.cookie, undefined, 'الكوكي من الجلسة وحدها');
  }
  assert.match(ua, /^Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64\).*Chrome\/146\.0\.0\.0 Safari\/537\.36$/);
});

test('تحويل إلى الشبكة المحلية يُرفض، والصورة تُتحقق من نوعها', async () => {
  const e = fakeElectron([{ redirect: 'http://192.168.1.1/admin' }]);
  const browser = createSourceBrowser({ ...e, userAgent: chromeUserAgent('131'), isChallenge });
  await assert.rejects(browser.fetch({ url: 'https://manga.example/a' }), /غير مسموح/);
  const img = fakeElectron([{ body: 'PNG', headers: { 'content-type': ['image/png'] } }]);
  const out = await createSourceBrowser({ ...img, userAgent: 'UA', isChallenge }).fetch({ url: 'https://cdn.example/1.png', binary: true });
  assert.equal(out.contentType, 'image/png');
  assert.equal(Buffer.from(out.base64, 'base64').toString(), 'PNG');
  const html = fakeElectron([{ body: '<html>no</html>' }]);
  await assert.rejects(createSourceBrowser({ ...html, userAgent: 'UA', isChallenge }).fetch({ url: 'https://cdn.example/2.png', binary: true }), /ليس صورة/);
});

test('المضيفات المسموحة عامة فقط', () => {
  for (const bad of ['file:///c:/x', 'http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.2/', 'http://172.20.1.1/', 'http://169.254.1.1/', 'https://router.lan/', 'https://u:p@site.example/', 'http://[::1]/', 'javascript:alert(1)'])
    assert.equal(publicHttpUrl(bad), null, bad);
  assert.equal(publicHttpUrl('https://mangalik.net/manga/x').hostname, 'mangalik.net');
});
