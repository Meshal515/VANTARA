'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const updater = require('./updater.cjs');
const { runUpdateSmoke, MARKER_KEY } = require('./update-smoke.cjs');

// نافذة مزيفة: تنفّذ ما يطلبه الإثبات من الواجهة كما تفعله update-check.js، والزرّان يكتبان المثبّت ويغيّران العنوان
function fakeWindow({ update, userData, installerBytes, failDownload = false }) {
  let title = '', clicks = [];
  const storage = new Map();
  const executeJavaScript = async (code) => {
    if (code.includes('!!window.VantaraDesktopUpdates')) return true;
    if (code.includes('localStorage.setItem')) { storage.set(MARKER_KEY, JSON.parse(code.split(', ')[1].slice(0, -1))); return undefined; }
    if (code.includes('.check({force:true})')) { title = `تحديث متاح: VANTARA Debug ${update.version}`; return { status: 'available', installed: 'VANTARA Debug 0.4.7 · بناء 7', update, offer: title }; }
    if (code.includes("import('/desktop/update-check.js')")) { const m = await import('../web/desktop/update-check.js'); return eval(code.replace("import('/desktop/update-check.js')", 'Promise.resolve(m)')); }
    if (code.includes('find(x=>x.textContent.trim()===')) {
      const label = JSON.parse(code.match(/===(".*?")\)/)[1]); clicks.push(label);
      if (label === 'تنزيل وتثبيت') {
        if (failDownload) title = 'تحديث متاح: تعذر تنزيل التحديث';
        else { fs.mkdirSync(path.join(userData, 'updates'), { recursive: true }); fs.writeFileSync(path.join(userData, 'updates', `VANTARA-${update.version}-Setup.exe`), installerBytes); title = `التحديث جاهز: VANTARA Debug ${update.version}`; }
      }
      return true;
    }
    if (code.includes('[data-update-title]')) return title.startsWith('التحديث جاهز') || title.includes('تعذر') ? title : null;
    throw new Error(`unexpected renderer call: ${code.slice(0, 60)}`);
  };
  return { window: { webContents: { executeJavaScript } }, clicks: () => clicks, storage };
}
const setup = (opts = {}) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vantara-update-smoke-'));
  const installerBytes = Buffer.from('VANTARA Debug 0.4.8 installer');
  const update = { channel: 'debug', version: '0.4.8', build: 8, size: installerBytes.length, sha256: crypto.createHash('sha256').update(installerBytes).digest('hex'), url: 'https://github.com/Meshal515/VANTARA/releases/download/windows-debug-8/VANTARA-Debug-0.4.8-Windows-x64-Setup.exe' };
  const fake = fakeWindow({ update, userData, installerBytes, ...opts });
  const reportPath = path.join(userData, 'report.json');
  return { userData, update, fake, reportPath, run: () => runUpdateSmoke({ window: fake.window, reportPath, channelInfo: { channel: 'debug', build: 7 }, appVersion: '0.4.7', updater, userData }) };
};

test('N→N+1 من الواجهة: فحص، حارس رجوع، تنزيل بنفس البصمة، ثم «أعد التشغيل وحدّث» مع علامة بيانات المستخدم', async () => {
  const t = setup();
  const report = await t.run();
  assert.equal(report.error, undefined);
  assert.equal(report.stage, 'applying');
  assert.equal(report.check.update.build, 8);
  assert.equal(report.rollback.acceptsNewer, true);
  for (const key of ['rejectsSameBuild', 'rejectsOlder', 'rejectsStableInstaller', 'rejectsForeignHost']) assert.ok(typeof report.rollback[key] === 'string' && report.rollback[key].length, key);
  assert.equal(report.rollback.rendererHidesSameBuild, true);
  assert.equal(report.download.sha256Matches, true);
  assert.deepEqual(t.fake.clicks(), ['تنزيل وتثبيت', 'أعد التشغيل وحدّث']);
  assert.equal(fs.readFileSync(path.join(t.userData, 'update-smoke-marker.txt'), 'utf8'), report.marker);
  assert.equal(t.fake.storage.get(MARKER_KEY), report.marker);
  assert.deepEqual(JSON.parse(fs.readFileSync(t.reportPath, 'utf8')).stage, 'applying');
});

test('فشل التنزيل يُكتب في التقرير ولا يضغط «أعد التشغيل وحدّث»', async () => {
  const t = setup({ failDownload: true });
  const report = await t.run();
  assert.match(report.error, /فشل التنزيل/);
  assert.deepEqual(t.fake.clicks(), ['تنزيل وتثبيت']);
});
