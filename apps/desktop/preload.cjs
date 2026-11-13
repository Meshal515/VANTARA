const { contextBridge, ipcRenderer } = require('electron');
const call = channel => args => ipcRenderer.invoke(`vantara:${channel}`, args);
// preload معزول (sandbox) لا يقرأ channel.json؛ العملية الرئيسية تمرر هوية القناة كمعاملات.
const argument = (name, pattern) => pattern.exec(process.argv.find(arg=>arg.startsWith(`--vantara-${name}=`))?.slice(name.length+11)??'')?.[0]??null;
const build = Number(argument('build', /^[1-9]\d{0,8}$/));
contextBridge.exposeInMainWorld('VantaraDesktop', Object.freeze({
  platform: 'windows',
  version: argument('version', /^\d+\.\d+\.\d+$/)??'0.0.0',
  channel: argument('channel', /^(?:stable|debug)$/)??'stable',
  build: Number.isSafeInteger(build)&&build>0?build:null,
  sourceSha: argument('source', /^[0-9a-f]{7,40}$/),
  builtAt: argument('built', /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
  requestResource: call('request-resource'),
  requestFirstParty: call('request-first-party'),
  showApp:call('show-app'),
  showPlayer:call('show-player'),
  playerViewport:call('player-viewport'),
  playerFullscreen:call('player-fullscreen'),
  playerOverlay:call('player-overlay'),
  prewarmTorrent: call('prewarm-torrent'),
  startPlayback: call('start-playback'),
  stopPlayback: call('stop-playback'),
  playbackCommand: call('playback-command'),
  openExternal: call('open-external'),
  openUpdatePage: call('open-update-page'),
  downloadUpdate: call('download-update'),
  applyUpdate: call('apply-update'),
  onOverlayCommand(callback) {
    if (typeof callback !== 'function') throw new TypeError('مستمع غير صالح');
    const receive = (_event, value) => callback(value);
    ipcRenderer.on('vantara:overlay-command', receive);
    return () => ipcRenderer.removeListener('vantara:overlay-command', receive);
  },
  onEvent(callback) {
    if (typeof callback !== 'function') throw new TypeError('مستمع غير صالح');
    const receive = (_event, value) => callback(value);
    ipcRenderer.on('vantara:event', receive);
    return () => ipcRenderer.removeListener('vantara:event', receive);
  },
}));
