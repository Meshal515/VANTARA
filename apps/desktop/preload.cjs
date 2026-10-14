const { contextBridge, ipcRenderer } = require('electron');
const call = channel => args => ipcRenderer.invoke(`vantara:${channel}`, args);
contextBridge.exposeInMainWorld('VantaraDesktop', Object.freeze({
  platform: 'windows',
  version: '0.1.0-preview.2',
  requestResource: call('request-resource'),
  requestFirstParty: call('request-first-party'),
  showApp:call('show-app'),
  showPlayer:call('show-player'),
  startPlayback: call('start-playback'),
  stopPlayback: call('stop-playback'),
  playbackCommand: call('playback-command'),
  openExternal: call('open-external'),
  onEvent(callback) {
    if (typeof callback !== 'function') throw new TypeError('مستمع غير صالح');
    const receive = (_event, value) => callback(value);
    ipcRenderer.on('vantara:event', receive);
    return () => ipcRenderer.removeListener('vantara:event', receive);
  },
}));
