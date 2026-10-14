const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');

test('أول إقلاع portable يرحل الحساب والإضافات قبل أن يفتح Electron ملفه الجديد', async t => {
  t.after(() => { delete require.cache[require.resolve('./main.cjs')]; });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vantara-portable-boot-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const old = path.join(dir, 'old-profile'), target = path.join(dir, 'VANTARA-data');
  await fs.mkdir(old);
  await fs.writeFile(path.join(old, 'account-and-addons.json'), 'previous-profile');
  let userData = old, finish, reject;
  const loaded = new Promise((resolve, fail) => { finish = resolve; reject = fail; });
  const electron = {
    app: { isPackaged: true, setName() {}, requestSingleInstanceLock: () => true, on() {},
      getPath: name => name === 'exe' ? path.join(dir, 'VANTARA.exe') : userData,
      setPath: (_name, value) => { userData = value; },
      whenReady: async () => { require('node:fs').mkdirSync(userData, { recursive: true }); },
      quit() {}, exit: code => reject(new Error(`exit ${code}`)) },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} }, ipcMain: { handle() {} }, net: {},
    Menu: { buildFromTemplate: value => value, setApplicationMenu() {} },
    BrowserWindow: class {
      constructor() {
        this.webContents = { setWindowOpenHandler() {}, on() {}, send() {} };
      }
      once() {}
      async loadURL() { finish(); }
    },
  };
  const previous = Module._load, platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Module._load = function(id, ...args) { return id === 'electron' ? electron : previous.call(this,id,...args); };
  Object.defineProperty(process, 'platform', { value: 'win32' });
  delete require.cache[require.resolve('./main.cjs')];
  try { require('./main.cjs'); }
  finally { Module._load = previous; Object.defineProperty(process, 'platform', platform); }
  await loaded;
  assert.equal(userData, target);
  assert.equal(await fs.readFile(path.join(target, 'account-and-addons.json'), 'utf8'), 'previous-profile');
  assert.equal(await fs.readFile(path.join(old, 'account-and-addons.json'), 'utf8'), 'previous-profile');
  delete require.cache[require.resolve('./main.cjs')];
});

// يشغّل main الحقيقي مع حدود Electron فقط بدل بناء واجهة renderer بديلة.
test('نافذة Windows تقلع الواجهة الأصلية مع sandbox ولا تعيد مدخل desktop المبسط', async () => {
  let finish;
  const loaded = new Promise(resolve => { finish = resolve; });
  const urls = [], windows = [], menus = [], handlers = new Map(), events = new Map();
  const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vantara-canonical-test-'));
  const reportPath = path.join(reportDir, 'report.json');
  process.argv.push(`--smoke-report=${reportPath}`);
  let reportTimer;
  const previousTimer = globalThis.setTimeout;
  globalThis.setTimeout = (fn, delay, ...args) => delay === 12000 ? (reportTimer = fn, 0) : previousTimer(fn, delay, ...args);
  const electron = {
    app: { setName() {}, requestSingleInstanceLock: () => true, on() {}, whenReady: async () => {}, getPath: () => os.tmpdir(), quit() {}, exit(code) { finish(Promise.reject(new Error(`exit ${code}`))); } },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    ipcMain: { handle(name,fn) { handlers.set(name,fn); } },
    net: {},
    Menu: { buildFromTemplate(template) { menus.push(template); return template; }, setApplicationMenu() {} },
    BrowserWindow: class {
      constructor(options) {
        windows.push(options);
        this.webContents = { setWindowOpenHandler() {}, on(name,fn) { events.set(name,fn); }, send() {}, executeJavaScript: async () => ({ url: 'vantara://app/index.html', gate: true }), capturePage: async () => ({ toPNG: () => Buffer.from('fixture') }) };
      }
      once() {}
      async loadURL(url) { urls.push(url); finish(); }
    },
  };
  const previous = Module._load;
  Module._load = function(id, ...args) { return id === 'electron' ? electron : previous.call(this,id,...args); };
  try { require('./main.cjs'); } finally { Module._load = previous; }
  await loaded;
  await new Promise(resolve => previousTimer(resolve,0));
  globalThis.setTimeout = previousTimer;
  process.argv.pop();
  assert.deepEqual(urls, ['vantara://app/index.html']);
  assert.equal(windows[0].webPreferences.sandbox,true);
  assert.equal(windows[0].webPreferences.contextIsolation,true);
  assert.equal(windows[0].webPreferences.nodeIntegration,false);
  assert.equal(windows[0].webPreferences.webSecurity,true);
  for(const item of menus[0][0].submenu) if(item.click) await item.click();
  assert.ok(urls.every(url => url === 'vantara://app/index.html'));
  assert.ok(handlers.has('vantara:start-playback'));
  events.get('console-message')?.({ details: { level: 3, message: 'تعذر https://provider.test/secret?token=keep', lineNumber: 9, sourceId: 'vantara://app/app.js' } });
  events.get('did-fail-load')?.({}, -6, 'الملف غير موجود', 'vantara://app/missing.js', false);
  await reportTimer();
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.deepEqual(report.consoleErrors, [{ level: 3, message: 'تعذر [رابط خارجي]', line: 9, source: 'vantara://app/app.js' }]);
  assert.deepEqual(report.failedLoads, [{ code: -6, message: 'الملف غير موجود', url: 'vantara://app/missing.js', mainFrame: false }]);
  assert.ok(!JSON.stringify(report).includes('token=keep'));
  await fs.rm(reportDir,{recursive:true,force:true});
});
