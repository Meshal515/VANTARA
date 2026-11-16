'use strict';
/**
 * هوية قناة ويندوز (Stable / Debug) تُختم وقت البناء في channel.json بجوار main.cjs.
 *
 * السبب الجذري الذي تعالجه: نسخة Stable (0.0.N من stable-N) كانت تقرأ بيان القناة القديمة
 * windows-channel (0.3.18)، و0.3.18 «أحدث» رقميًا من 0.0.215 مع أنها كود 20 أكتوبر؛ فيعرض
 * التطبيق «تحديثًا» يثبّت واجهة أقدم. الآن لكل قناة بيانها ورقم بناء صاعد، ولا تقبل قناة مثبّت أخرى.
 *
 * Debug مستقل كليًا عن Stable: اسم ومجلد تثبيت وبيانات مستخدم ومعرّف تطبيق مختلفة، فلا يطغى
 * أحدهما على الآخر ولا يتشاركان قفل النسخة الواحدة أو ملفات الملف الشخصي.
 */
const fs = require('node:fs');
const path = require('node:path');

const CHANNELS = Object.freeze({
  stable: Object.freeze({
    channel: 'stable', productName: 'VANTARA', appId: 'com.vantara.desktop', title: 'VANTARA · ويندوز',
    manifestUrl: 'https://github.com/Meshal515/VANTARA/releases/latest/download/vantara-update.json',
  }),
  debug: Object.freeze({
    channel: 'debug', productName: 'VANTARA Debug', appId: 'com.vantara.desktop.debug', title: 'VANTARA Debug · ويندوز',
    manifestUrl: 'https://github.com/Meshal515/VANTARA/releases/download/windows-debug-channel/desktop-debug.json',
  }),
});

/** يقرأ ويتحقق من channel.json؛ غيابه يعني Stable بلا رقم بناء (بناء محلي أو قديم). */
function parseChannel(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const base = CHANNELS[data.channel] ?? CHANNELS.stable;
  const build = Number.isSafeInteger(data.build) && data.build > 0 ? data.build : null;
  const sourceSha = typeof data.sourceSha === 'string' && /^[0-9a-f]{7,40}$/.test(data.sourceSha) ? data.sourceSha : null;
  const builtAt = typeof data.builtAt === 'string' && !Number.isNaN(Date.parse(data.builtAt)) ? new Date(data.builtAt).toISOString() : null;
  return Object.freeze({ ...base, build, sourceSha, builtAt });
}

function readChannel(dir = __dirname) {
  try { return parseChannel(JSON.parse(fs.readFileSync(path.join(dir, 'channel.json'), 'utf8'))); }
  catch { return parseChannel(null); }
}

/** معاملات سطر الأوامر التي يقرؤها preload (الواجهة معزولة ولا تقرأ الملفات). */
function rendererArguments(info, version) {
  return [
    `--vantara-version=${version}`,
    `--vantara-channel=${info.channel}`,
    ...(info.build ? [`--vantara-build=${info.build}`] : []),
    ...(info.sourceSha ? [`--vantara-source=${info.sourceSha}`] : []),
    ...(info.builtAt ? [`--vantara-built=${info.builtAt}`] : []),
  ];
}

module.exports = { CHANNELS, parseChannel, readChannel, rendererArguments };
