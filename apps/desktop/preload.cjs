const { contextBridge, ipcRenderer } = require('electron');
const call = channel => args => ipcRenderer.invoke(`vantara:${channel}`, args);
contextBridge.exposeInMainWorld('VantaraDesktop', Object.freeze({
  platform: 'windows',
  version: /^--vantara-version=(\d+\.\d+\.\d+)$/.exec(process.argv.find(arg=>arg.startsWith('--vantara-version='))??'')?.[1]??'0.0.0',
  requestResource: call('request-resource'),
  requestFirstParty: call('request-first-party'),
  showApp:call('show-app'),
  showPlayer:call('show-player'),
  playerViewport:call('player-viewport'),
  playerFullscreen:call('player-fullscreen'),
  playerOverlay:call('player-overlay'),
  startPlayback: call('start-playback'),
  stopPlayback: call('stop-playback'),
  playbackCommand: call('playback-command'),
  prepareMoment: call('prepare-moment'),
  releaseMoment: call('release-moment'),
  exportMoment: call('export-moment'),
  readMoment: call('read-moment'),
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
