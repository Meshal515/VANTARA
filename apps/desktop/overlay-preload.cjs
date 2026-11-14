// جسر طبقة المشغل: عرض فقط. يستقبل الحالة ويرسل أوامر تمر بتحقق العملية الرئيسية؛ لا شبكة ولا ملفات.
const { contextBridge, ipcRenderer } = require('electron');
// القناة فقط (debug/stable) تمر كمعامل من العملية الرئيسية: أدوات التشخيص في المشغل تظهر في Debug وحده
const channel = /^--vantara-channel=(debug|stable)$/.exec(process.argv.find(arg => arg.startsWith('--vantara-channel=')) ?? '')?.[1] ?? 'stable';
contextBridge.exposeInMainWorld('VantaraOverlay', Object.freeze({
  channel,
  send: message => ipcRenderer.invoke('vantara:overlay-command', message),
  onState(callback) {
    if (typeof callback !== 'function') throw new TypeError('مستمع غير صالح');
    const receive = (_event, value) => callback(value);
    ipcRenderer.on('vantara:overlay', receive);
    return () => ipcRenderer.removeListener('vantara:overlay', receive);
  },
}));
