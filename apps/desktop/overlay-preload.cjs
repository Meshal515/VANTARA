// جسر طبقة المشغل: عرض فقط. يستقبل الحالة ويرسل أوامر تمر بتحقق العملية الرئيسية؛ لا شبكة ولا ملفات.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('VantaraOverlay', Object.freeze({
  send: message => ipcRenderer.invoke('vantara:overlay-command', message),
  onState(callback) {
    if (typeof callback !== 'function') throw new TypeError('مستمع غير صالح');
    const receive = (_event, value) => callback(value);
    ipcRenderer.on('vantara:overlay', receive);
    return () => ipcRenderer.removeListener('vantara:overlay', receive);
  },
}));
