const { app, BrowserWindow, ipcMain, protocol, net, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { assetPath, isAppFrame, configuredAddonUrl } = require('./security.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'vantara', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.setName('VANTARA');
if (!app.requestSingleInstanceLock()) app.exit(0);
let window;
let services;
let quitting = false;
const settingsWindows = new Set();
const assets = path.join(__dirname, 'web');
const native = path.join(__dirname, 'native');
const reportOption = process.argv.find(x => x.startsWith('--smoke-report='));
app.on('second-instance', () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });

function publish(event) {
  if (window && !window.isDestroyed()) window.webContents.send('vantara:event', event);
}

function openSettings(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('إعداد الإضافة يحتاج رابط HTTPS');
  const popup = new BrowserWindow({
    title: 'إعداد الإضافة · VANTARA', width: 1000, height: 800, parent: window,
    backgroundColor: '#08080a', autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'persist:vantara-addon-settings' },
  });
  settingsWindows.add(popup);
  popup.on('closed', () => settingsWindows.delete(popup));
  const capture = (event, target) => {
    if (/^stremio:/i.test(target)) {
      event.preventDefault();
      try { publish({ type: 'addon/install', url: configuredAddonUrl(target) }); popup.close(); window.show(); window.focus(); }
      catch { popup.webContents.executeJavaScript('alert("رابط الإضافة غير صالح. انسخ رابط manifest.json إلى VANTARA.")').catch(() => {}); }
      return;
    }
    try { if (new URL(target).protocol !== 'https:') event.preventDefault(); }
    catch { event.preventDefault(); }
  };
  popup.webContents.on('will-navigate', capture);
  popup.webContents.on('will-redirect', capture);
  popup.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^stremio:/i.test(target)) {
      try { publish({ type: 'addon/install', url: configuredAddonUrl(target) }); popup.close(); window.focus(); } catch { /* الإرشاد المرئي في مدير الإضافات يبقى متاحًا */ }
    } else if (/^https:/i.test(target)) void popup.loadURL(target);
    return { action: 'deny' };
  });
  return popup.loadURL(u.href);
}

function register(channel, handler) {
  ipcMain.handle(`vantara:${channel}`, (event, args) => {
    if (event.sender !== window?.webContents || !isAppFrame(event.senderFrame?.url)) throw new Error('هذا الطلب ليس من VANTARA المحلي');
    return handler(args);
  });
}

app.whenReady().then(async () => {
  protocol.handle('vantara', async request => {
    try {
      const file = assetPath(assets, request.url);
      const result = await net.fetch(pathToFileURL(file).href);
      if (path.basename(file) === 'index.html' && path.dirname(file) === assets) {
        const html = (await result.text()).replace('<script type="module" src="/app.js"></script>', '<script type="module" src="/desktop/full-boot.js"></script>');
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      return result;
    } catch { return new Response('الملف غير موجود', { status: 404 }); }
  });
  const { createDesktopServices } = await import('./src/services.mjs');
  services = createDesktopServices({
    userData: app.getPath('userData'),
    binaries: { rqbit: process.env.VANTARA_RQBIT_BINARY || path.join(native, 'rqbit.exe'), mpv: process.env.VANTARA_MPV_BINARY || path.join(native, 'mpv.exe') },
    platform: process.platform,
    onEvent: publish,
  });
  for (const [name, method] of [['request-resource', 'requestResource'], ['start-playback', 'startPlayback'], ['stop-playback', 'stopPlayback'], ['playback-command', 'playbackCommand']]) register(name, args => services[method](args));
  register('open-external', ({ url }) => openSettings(url));
  window = new BrowserWindow({
    title: 'VANTARA · ويندوز', width: 1400, height: 950, minWidth: 760, minHeight: 560,
    backgroundColor: '#08080a', show: false, icon: path.join(assets, 'icons/icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/i.test(url)) void openSettings(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (!isAppFrame(url)) { event.preventDefault(); if (/^https:/i.test(url)) void openSettings(url); } });
  window.once('ready-to-show', () => window.show());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'VANTARA', submenu: [
      { label: 'السينما والإضافات', click: () => void window.loadURL('vantara://app/desktop/index.html') },
      { label: 'المكتبة والحسابات', click: () => void window.loadURL('vantara://app/index.html') },
      { type: 'separator' }, { label: 'خروج', role: 'quit' },
    ] },
    { label: 'عرض', submenu: [{ label: 'إعادة تحميل', role: 'reload' }, { label: 'ملء الشاشة', role: 'togglefullscreen' }, { label: 'تكبير', role: 'zoomIn' }, { label: 'تصغير', role: 'zoomOut' }, { label: 'الحجم الأصلي', role: 'resetZoom' }] },
  ]));
  await window.loadURL('vantara://app/desktop/index.html');
  if (reportOption) {
    setTimeout(async () => {
      try {
        const report = await window.webContents.executeJavaScript('({title:document.title,url:location.href,text:document.body.innerText.slice(0,8000),desktop:window.VantaraDesktop?.platform,hasBridge:!!window.VantaraDesktopBridges})');
        await fs.writeFile(reportOption.slice('--smoke-report='.length), JSON.stringify(report, null, 2));
        const image = await window.webContents.capturePage();
        await fs.writeFile(reportOption.slice('--smoke-report='.length) + '.png', image.toPNG());
        app.quit();
      } catch (error) { await fs.writeFile(reportOption.slice('--smoke-report='.length), JSON.stringify({ error: error.message })); app.quit(); }
    }, 12000);
  }
}).catch(error => { console.error('تعذر إقلاع VANTARA:', error.message); app.exit(1); });

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting || !services) return;
  event.preventDefault(); quitting = true;
  for (const popup of settingsWindows) popup.destroy();
  Promise.resolve(services.close()).catch(() => {}).finally(() => app.quit());
});
