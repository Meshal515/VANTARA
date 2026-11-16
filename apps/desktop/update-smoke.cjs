'use strict';
// وضع إثبات صريح (سطر أوامر فقط): التحديث الداخلي كما يفعله المستخدم، داخل VANTARA المثبّت نفسه.
//   1) «البحث عن تحديثات»: نفس دالة زر الإعدادات (VantaraDesktopUpdates.check) على بيان القناة المنشور فعلًا.
//   2) منع الرجوع: نفس حارس العملية الرئيسية (updater.acceptableUpdate) يرفض البناء نفسه، والأقدم، ومثبّت Stable.
//   3) «تنزيل وتثبيت» ثم «أعد التشغيل وحدّث»: أزرار الإشعار نفسها؛ التنزيل عبر net.fetch والتحقق من البصمة.
// قبل الخروج يُكتب التقرير وعلامة بيانات مستخدم (ملف في userData ومفتاح localStorage) ليتحقق السكربت بعد
// إعادة التشغيل أن البيانات بقيت. لا يغيّر سلوك التطبيق العادي: يعمل فقط مع --update-smoke-report.
const fs = require('node:fs/promises');
const path = require('node:path');

const MARKER_KEY = 'vantara.updateSmoke.marker';
// جاهزية الإقلاع: جسر التحديث وأي شاشة من القشرة. تثبيت جديد بلا حساب يعرض شاشة الدخول (#root .gate) لا الواجهة
// (#root .v35)؛ «البحث عن تحديثات» لا يحتاج حسابًا. انتظار الواجهة وحدها أفشل الإثبات في تشغيل #9 (فحص الإقلاع
// العادي في main.cjs يقبل الحالتين أصلًا).
const BOOT_READY_JS = '!!window.VantaraDesktopUpdates && !!document.querySelector("#root .v35, #root .gate")';
async function until(fn, timeout, label) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise((r) => setTimeout(r, 250)); }
  throw new Error(`انتهت مهلة إثبات التحديث: ${label}`);
}
const rejects = (fn) => { try { fn(); return false; } catch (error) { return error.message; } };

async function runUpdateSmoke({ window, reportPath, channelInfo, appVersion, updater, userData }) {
  const installed = { channel: channelInfo.channel, version: appVersion, build: channelInfo.build ?? null };
  const report = { installed, stage: 'boot', userData };
  const save = () => fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  const js = (code) => window.webContents.executeJavaScript(code);
  try {
    await until(() => js(BOOT_READY_JS), 60000, 'إقلاع الواجهة');
    // علامة بيانات المستخدم: يجب أن تبقى بعد التثبيت فوق المجلد نفسه وإعادة التشغيل
    report.marker = `${appVersion}#${installed.build}@${Date.now()}`;
    await fs.writeFile(path.join(userData, 'update-smoke-marker.txt'), report.marker);
    await js(`localStorage.setItem(${JSON.stringify(MARKER_KEY)}, ${JSON.stringify(report.marker)})`);

    report.stage = 'check';
    const t0 = Date.now();
    report.check = await js('window.VantaraDesktopUpdates.check({force:true}).then(r=>({status:r.status,installed:r.installed,update:r.update,offer:document.querySelector("[data-vantara-desktop-update] [data-update-title]")?.textContent??null}))');
    report.check.ms = Date.now() - t0;
    const update = report.check.update;
    if (!update) throw new Error(`لم يُعرض تحديث أحدث من ${appVersion} (بناء ${installed.build})`);

    // حارس العملية الرئيسية على التحديث الحقيقي المعروض: يقبله، ويرفض كل رجوع
    report.stage = 'rollback-guard';
    const accepted = updater.acceptableUpdate(update, installed);
    report.rollback = {
      acceptsNewer: accepted.build === update.build,
      rejectsSameBuild: rejects(() => updater.acceptableUpdate({ ...update, build: installed.build, version: appVersion, url: update.url.replace(`windows-debug-${update.build}`, `windows-debug-${installed.build}`).replace(update.version, appVersion) }, installed)),
      rejectsOlder: rejects(() => updater.acceptableUpdate({ ...update, build: 1, version: '0.4.1', url: 'https://github.com/Meshal515/VANTARA/releases/download/windows-debug-1/VANTARA-Debug-0.4.1-Windows-x64-Setup.exe' }, installed)),
      rejectsStableInstaller: rejects(() => updater.acceptableUpdate({ ...update, url: 'https://github.com/Meshal515/VANTARA/releases/download/stable-215/VANTARA-0.0.215-Windows-x64-Setup.exe' }, installed)),
      rejectsForeignHost: rejects(() => updater.acceptableUpdate({ ...update, url: update.url.replace('github.com', 'example.com') }, installed)),
    };
    // واجهة: بيان بنفس البناء المثبت لا يُعرض أبدًا (نفس desktopUpdateFromManifest)
    report.rollback.rendererHidesSameBuild = await js(`import('/desktop/update-check.js').then(m=>m.desktopUpdateFromManifest({format:3,product:'VANTARA',channel:'windows-debug',platform:'win32-x64',installer:'nsis',version:${JSON.stringify(appVersion)},build:${Number(installed.build)},size:1,sha256:'${'0'.repeat(64)}',url:'https://github.com/Meshal515/VANTARA/releases/download/windows-debug-${installed.build}/VANTARA-Debug-${appVersion}-Windows-x64-Setup.exe'},{version:${JSON.stringify(appVersion)},channel:'debug',build:${Number(installed.build)}})===null)`);
    const failedGuards = Object.entries(report.rollback).filter(([k, v]) => (k.startsWith('rejects') ? !v : v !== true));
    if (failedGuards.length) throw new Error(`حارس الرجوع لم يعمل: ${failedGuards.map(([k]) => k).join(', ')}`);

    // «تنزيل وتثبيت» من الإشعار نفسه
    report.stage = 'download';
    const click = (label) => js(`(()=>{const b=[...document.querySelectorAll('[data-vantara-desktop-update] button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});b?.click();return !!b;})()`);
    if (!(await click('تنزيل وتثبيت'))) throw new Error('زر «تنزيل وتثبيت» غير ظاهر');
    const d0 = Date.now();
    report.download = { readyTitle: await until(() => js('(()=>{const t=document.querySelector("[data-vantara-desktop-update] [data-update-title]")?.textContent??"";return t.startsWith("التحديث جاهز")||t.includes("تعذر")?t:null;})()'), 15 * 60000, 'التنزيل') };
    report.download.ms = Date.now() - d0;
    if (!report.download.readyTitle.startsWith('التحديث جاهز')) throw new Error(`فشل التنزيل: ${report.download.readyTitle}`);
    const dir = path.join(userData, 'updates');
    const file = (await fs.readdir(dir)).find((n) => n.endsWith('-Setup.exe'));
    report.download.file = file;
    report.download.sha256Matches = !!file && (await updater.hashFile(path.join(dir, file))) === update.sha256;
    if (!report.download.sha256Matches) throw new Error('بصمة المثبّت المنزّل لا تطابق البيان');

    // «أعد التشغيل وحدّث»: المثبّت بصمت فوق مجلد التطبيق نفسه ثم يعيد تشغيله
    report.stage = 'apply';
    report.applyAt = new Date().toISOString();
    await save();
    if (!(await click('أعد التشغيل وحدّث'))) throw new Error('زر «أعد التشغيل وحدّث» غير ظاهر');
    report.stage = 'applying';
  } catch (error) {
    report.error = error.message;
  }
  await save();
  return report;
}
module.exports = { runUpdateSmoke, MARKER_KEY, BOOT_READY_JS };
