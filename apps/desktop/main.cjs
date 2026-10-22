const { app, BrowserWindow, ipcMain, protocol, net, Menu, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { assetPath, isAppFrame, configuredAddonUrl } = require('./security.cjs');
const { firstPartyRequest } = require('./first-party.cjs');
const { migratePortableProfile } = require('./profile.cjs');
const { createVideoHost } = require('./video-host.cjs');
const { createWindowFullscreen } = require('./fullscreen.cjs');
const updater = require('./updater.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'vantara', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.setName('VANTARA');
if (process.platform === 'win32') app.setAppUserModelId('com.vantara.desktop');
if (!app.requestSingleInstanceLock()) app.exit(0);
const previousProfile=app.getPath('userData');
const executableFolder=path.dirname(app.getPath('exe'));
const portable=process.platform==='win32'&&app.isPackaged&&!require('node:fs').existsSync(path.join(executableFolder,'Uninstall.exe'));
const portableProfile=path.join(executableFolder,'VANTARA-data');
// يكتمل النقل قبل اختيار userData وقبل أول session/BrowserWindow.
const profileReady=portable?migratePortableProfile(previousProfile,portableProfile)
  .then(()=>app.setPath('userData',portableProfile)):Promise.resolve();
let window;
let services;
let videoHost;
let overlay=null;
let fullscreenController;
let playbackSession=null;
let quitting = false;
// تحديث نُزّل وتحقق: يُثبَّت بإعادة التشغيل الآن، أو بصمت عند الإغلاق إن أُجّل
let pendingUpdate = null;
const appVersion = require('./package.json').version;
const updatesDir = () => path.join(app.getPath('userData'), 'updates');
const attemptFile = () => path.join(updatesDir(), 'attempt.json');
function readAttempt() {
  try { return JSON.parse(require('node:fs').readFileSync(attemptFile(), 'utf8')); } catch { return null; }
}
function scheduleUpdateInstall(relaunch) {
  if (!pendingUpdate || pendingUpdate.scheduled || process.platform !== 'win32') return false;
  // المحاولة الصامتة السابقة لهذا الإصدار لم تكتمل (ما زلنا على الإصدار الأقدم): المثبّت بواجهته هذه المرة
  const attempt = readAttempt();
  const interactive = attempt?.version === pendingUpdate.version && updater.attemptFailed(attempt, appVersion);
  const { file, args, options } = updater.installCommand({ installer: pendingUpdate.file, exe: app.getPath('exe'), relaunch, interactive });
  try { require('node:fs').writeFileSync(attemptFile(), JSON.stringify({ version: pendingUpdate.version, from: appVersion, at: Date.now(), interactive })); } catch {}
  require('node:child_process').spawn(file, args, options).unref();
  pendingUpdate.scheduled = true;
  return true;
}
// بعد تحديث اكتمل: المثبّت وسجل المحاولة لا يبقيان على القرص
function clearFinishedUpdate() {
  const attempt = readAttempt();
  if (!attempt || updater.attemptFailed(attempt, appVersion)) return;
  require('node:fs').promises.rm(updatesDir(), { recursive: true, force: true }).catch(() => {});
}
const settingsWindows = new Set();
const assets = path.join(__dirname, 'web');
const windowIcon = process.platform === 'win32' ? path.join(__dirname, 'assets/vantara.ico') : path.join(assets, 'icons/icon-512.png');
const native = path.join(__dirname, 'native');
const reportOption = process.argv.find(x => x.startsWith('--smoke-report='));
const videoReportOption=process.argv.find(x=>x.startsWith('--native-video-smoke-report='));
app.on('second-instance', () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });

function publish(event) {
  // MPV's native HWND cannot dispatch Electron renderer keyboard shortcuts.
  // Route its verified input.conf script messages to the real main-window
  // fullscreen controller and native-player lifecycle.
  if(event.type==='playback/action' && event.session===playbackSession){
    if(event.action==='fullscreen')fullscreenController?.toggle();
    else if(event.action==='close'){
      // Escape exits fullscreen first; outside fullscreen it closes playback.
      // Closing on the first Escape would destroy the live native video HWND
      // while the overlay and renderer still expect a valid session.
      if(window?.isFullScreen())fullscreenController?.set(false);
      else void services?.stopPlayback({session:event.session}).catch(()=>{});
    }
    return;
  }
  if(event.type==='playback/preparing')playbackSession=event.session;
  if(['playback/closed','playback/error'].includes(event.type)&&event.session===playbackSession)playbackSession=null;
  if (window && !window.isDestroyed()) window.webContents.send('vantara:event', event);
}

function openSettings(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('إعداد الإضافة يحتاج رابط HTTPS');
  const popup = new BrowserWindow({
    title: 'إعداد الإضافة · VANTARA', width: 1000, height: 800, parent: window,
    backgroundColor: '#08080a', autoHideMenuBar: true, icon: windowIcon,
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
    if (event.sender !== window?.webContents || event.senderFrame !== window?.webContents.mainFrame || !isAppFrame(event.senderFrame?.url)) throw new Error('هذا الطلب ليس من VANTARA المحلي');
    return handler(args);
  });
}

Promise.all([app.whenReady(),profileReady]).then(async () => {
  clearFinishedUpdate();
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
  if(process.platform==='win32')videoHost=createVideoHost({
    getWindow:()=>window,
    executable:process.env.VANTARA_VIDEO_HOST_BINARY||path.join(native,'vantara-video-host.exe'),
    scaleFactor:bounds=>screen.getDisplayMatching(bounds).scaleFactor,
    onFailure:session=>{publish({type:'playback/error',session,message:'أغلقت نافذة الفيديو المدمجة؛ اختر مصدرًا من جديد'});void services?.stopPlayback({session});},
  });
  // طبقة أدوات المشغل بتصميم الـAPK فوق الفيديو الأصلي (player-overlay.cjs)؛ ويندوز فقط
  if(videoHost){
    const {createPlayerOverlay}=require('./player-overlay.cjs');
    overlay=createPlayerOverlay({BrowserWindow,getWindow:()=>window,onWindow:win=>fullscreenController?.bindInput(win),onFullscreen:(enabled,win)=>videoHost?.fullscreen(enabled,win.getNativeWindowHandle()),preload:path.join(__dirname,'overlay-preload.cjs'),url:'vantara://app/desktop/overlay.html',
      onCommand:message=>{if(window&&!window.isDestroyed())window.webContents.send('vantara:overlay-command',message);}});
    ipcMain.handle('vantara:overlay-command',(event,args)=>overlay.command(event,args));
  }
  services = createDesktopServices({
    userData: app.getPath('userData'),
    binaries: { rqbit: process.env.VANTARA_RQBIT_BINARY || path.join(native, 'rqbit.exe'), mpv: process.env.VANTARA_MPV_BINARY || path.join(native, 'mpv.exe') },
    platform: process.platform,
    videoHost,
    inputConf:path.join(__dirname,'native-host/input.conf'),
    onEvent: publish,
  });
  for (const [name, method] of [['request-resource', 'requestResource'], ['prewarm-torrent', 'prewarmTorrent'], ['start-playback', 'startPlayback'], ['stop-playback', 'stopPlayback'], ['playback-command', 'playbackCommand']]) register(name, args => services[method](args));
  register('open-external', ({ url }) => openSettings(url));
  register('open-update-page', async ({ url } = {}) => {
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('رابط تحديث غير صالح'); }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' ||
        parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash ||
        !/^\/Meshal515\/VANTARA\/releases\/download\/(?:stable-\d+|windows-v\d+\.\d+\.\d+)\/VANTARA-[^/]+-Windows-x64-Setup\.exe$/.test(parsed.pathname))
      throw new Error('التحديث يجب أن يكون مثبت VANTARA الرسمي المنشور');
    await shell.openExternal(parsed.href);
    return true;
  });
  // النسخة المحمولة (ZIP) لا مثبّت لها: تبقى على فتح صفحة التنزيل
  register('download-update', async (update) => {
    if (portable || process.platform !== 'win32') return { ready: false, manual: true };
    if (pendingUpdate?.version === update?.version) return { ready: true, version: pendingUpdate.version };
    const file = await updater.downloadUpdate({
      update, dir: path.join(app.getPath('userData'), 'updates'),
      fetch: (url, options) => net.fetch(url, options),
      onProgress: (p) => publish({ type: 'update/progress', ...p }),
    });
    pendingUpdate = { version: String(update.version), file, scheduled: false };
    return { ready: true, version: pendingUpdate.version };
  });
  register('apply-update', () => {
    if (!scheduleUpdateInstall(true)) throw new Error('لا يوجد تحديث جاهز للتثبيت');
    setTimeout(() => app.quit(), 50);
    return true;
  });
  register('request-first-party', args => firstPartyRequest(args,(url,options)=>net.fetch(url,options)));
  register('show-app',()=>{videoHost?.hide();window.show();window.focus();return true;});
  register('show-player',()=>{videoHost?.show();window.show();window.focus();return true;});
  register('player-viewport',args=>{overlay?.viewport(args);return videoHost?.viewport(args)??false;});
  register('player-overlay',args=>{
    if(!overlay)return false;
    if(args?.open===true)return overlay.open(args);
    if(args?.close===true)return overlay.close(args);
    return overlay.state(args);
  });
  register('player-fullscreen',({enabled}={})=>fullscreenController.set(enabled));
  window = new BrowserWindow({
    title: 'VANTARA · ويندوز', width: 1400, height: 950, minWidth: 760, minHeight: 560,
    backgroundColor: '#08080a', show: false, icon: windowIcon, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), additionalArguments: [`--vantara-version=${require('./package.json').version}`], sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  window.on?.('resize',()=>{videoHost?.resize();overlay?.place();});
  window.on?.('move',()=>{videoHost?.resize();overlay?.place();});
  window.on?.('minimize',()=>{videoHost?.hide();overlay?.place();});
  window.on?.('restore',()=>{videoHost?.show();overlay?.place();});
  fullscreenController=createWindowFullscreen({window,layout:()=>{videoHost?.resize();overlay?.place();},onState:enabled=>publish({type:'window/fullscreen',enabled})});
  window.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{
    if(isMainFrame){videoHost?.hide();overlay?.close();if(playbackSession)void services.stopPlayback({session:playbackSession});}
  });
  window.webContents.session?.webRequest?.onHeadersReceived?.({urls:['https://vantara-sync.ngm-309.workers.dev/*']},(details,callback)=>{
    const headers=Object.fromEntries(Object.entries(details.responseHeaders??{}).filter(([key])=>key.toLowerCase()!=='access-control-allow-origin'));
    callback({responseHeaders:{...headers,'Access-Control-Allow-Origin':['vantara://app']}});
  });
  const smokeDiagnostics = { consoleErrors: [], failedLoads: [], assetFailures: [], rendererExits: [] };
  if (reportOption) {
    const safeText = value => String(value ?? '').replace(/(?:(?:https?|wss?):\/\/|stremio:\/\/)[^\s]+/gi, '[رابط خارجي]').slice(0, 2000);
    const safeURL = value => { try { const u = new URL(value); if (!isAppFrame(u.href)) return '[أصل خارجي]'; u.search = ''; u.hash = ''; return u.href; } catch { return '[رابط غير صالح]'; } };
    const append = (list, row) => { if (list.length < 200) list.push(row); };
    window.webContents.on('console-message', event => {
      const details = event.details ?? event;
      if (details.level >= 2) append(smokeDiagnostics.consoleErrors, { level: details.level, message: safeText(details.message), line: details.lineNumber, source: safeURL(details.sourceId) });
    });
    window.webContents.on('did-fail-load', (_event, code, message, url, mainFrame) => append(smokeDiagnostics.failedLoads, { code, message: safeText(message), url: safeURL(url), mainFrame }));
    window.webContents.on('render-process-gone', (_event, details) => append(smokeDiagnostics.rendererExits, { reason: details.reason, exitCode: details.exitCode }));
    window.webContents.session?.webRequest?.onErrorOccurred(details => {
      if (isAppFrame(details.url)) append(smokeDiagnostics.assetFailures, { url: safeURL(details.url), error: safeText(details.error), resourceType: details.resourceType });
    });
    window.webContents.session?.webRequest?.onCompleted(details => {
      if (isAppFrame(details.url) && details.statusCode >= 400) append(smokeDiagnostics.assetFailures, { url: safeURL(details.url), status: details.statusCode, resourceType: details.resourceType });
    });
  }
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/i.test(url)) void openSettings(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (!isAppFrame(url)) { event.preventDefault(); if (/^https:/i.test(url)) void openSettings(url); } });
  window.once('ready-to-show', () => window.show());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'VANTARA', submenu: [
      { label: 'الواجهة الرئيسية', click: () => void window.loadURL('vantara://app/index.html') },
      { type: 'separator' }, { label: 'خروج', role: 'quit' },
    ] },
    { label: 'عرض', submenu: [{ label: 'إعادة تحميل', role: 'reload' }, { label: 'ملء الشاشة', accelerator: 'F11', click: ()=>fullscreenController.toggle() }, { label: 'تكبير', role: 'zoomIn' }, { label: 'تصغير', role: 'zoomOut' }, { label: 'الحجم الأصلي', role: 'resetZoom' }] },
  ]));
  if(videoReportOption){
    if(!videoHost)throw new Error('إثبات HWND المدمج يحتاج Windows');
    const fixtureOption=process.argv.find(x=>x.startsWith('--native-video-smoke-fixture='));
    if(!fixtureOption)throw new Error('إثبات الفيديو يحتاج fixture مؤلفًا');
    await require('./video-smoke.cjs').runEmbeddedVideoSmoke({window,videoHost,playerOverlay:overlay,native,fixture:fixtureOption.slice('--native-video-smoke-fixture='.length),reportPath:videoReportOption.slice('--native-video-smoke-report='.length),publish,setServices:async replacement=>{await services.close();services=replacement;}});
    app.quit();return;
  }
  await window.loadURL('vantara://app/index.html');
  if (reportOption) {
    setTimeout(async () => {
      try {
        const report = await window.webContents.executeJavaScript('(async()=>{const r=window.VantaraDesktopBridges?.SourceRuntime?.getRuntime();await r?.ready;return {title:document.title,url:location.href,text:document.body.innerText.slice(0,8000),desktop:window.VantaraDesktop?.platform,desktopVersion:window.VantaraDesktop?.version,hasBridge:!!window.VantaraDesktopBridges,canonical:!!document.querySelector("#root .v35"),gate:!!document.querySelector("#root .gate"),section:document.querySelector("#root .v35")?.dataset.section??null,sourceCount:r?.registry.list().length??0,defaultAddons:window.VantaraDesktopDefaults?.statuses().map(({name,state,httpStatus})=>({name,state,httpStatus}))??[]}})()');
        await fs.writeFile(reportOption.slice('--smoke-report='.length), JSON.stringify({ ...report, ...smokeDiagnostics }, null, 2));
        const image = await window.webContents.capturePage();
        await fs.writeFile(reportOption.slice('--smoke-report='.length) + '.png', image.toPNG());
        app.quit();
      } catch (error) { await fs.writeFile(reportOption.slice('--smoke-report='.length), JSON.stringify({ error: error.message })); app.quit(); }
    }, 12000);
  }
}).catch(error => { console.error('تعذر إقلاع VANTARA:', error.message); app.exit(1); });

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  scheduleUpdateInstall(false);
  if (quitting || !services) return;
  event.preventDefault(); quitting = true;
  for (const popup of settingsWindows) popup.destroy();
  overlay?.destroy();
  Promise.resolve(services.close()).catch(() => {}).finally(() => app.quit());
});
