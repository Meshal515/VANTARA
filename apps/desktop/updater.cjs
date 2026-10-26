'use strict';
/**
 * تحديث ويندوز كما في الـAPK: ينزّل المثبّت الرسمي في الخلفية ويتحقق من بايتاته، ثم
 * يثبّته بصمت (/S) — المثبّت ينتظر خروج كل عمليات VANTARA — ويعيد تشغيله.
 *
 * لا يُنزَّل إلا مثبّت VANTARA المنشور على GitHub (نفس قاعدة open-update-page)، ولا
 * يُشغَّل ملف لم تطابق بصمته SHA-256 وحجمه ما في بيان القناة.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const OFFICIAL_PATH = /^\/Meshal515\/VANTARA\/releases\/download\/(?:stable-\d+|windows-v\d+\.\d+\.\d+)\/VANTARA-[^/]+-Windows-x64-Setup\.exe$/;
const MAX_SIZE = 1024 * 1024 * 1024;

function officialInstallerUrl(value) {
  let u;
  try { u = new URL(value); } catch { throw new Error('رابط تحديث غير صالح'); }
  if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.username || u.password || u.port || u.search || u.hash || !OFFICIAL_PATH.test(u.pathname))
    throw new Error('التحديث يجب أن يكون مثبت VANTARA الرسمي المنشور');
  return u.href;
}

/** يتحقق من عنصر البيان ويعيده بشكل ثابت. */
function validUpdate(update) {
  const version = String(update?.version ?? '');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(version)) throw new Error('رقم إصدار التحديث غير صالح');
  const sha256 = String(update?.sha256 ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('بصمة التحديث غير صالحة');
  const size = Number(update?.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_SIZE) throw new Error('حجم التحديث غير صالح');
  return { version, sha256, size, url: officialInstallerUrl(update?.url) };
}

/** Check again in the main process; a renderer cannot authorize a rollback. */
function assertForwardUpdate(update, installed) {
  if (!/^\d+\.\d+\.\d+(?:-preview\.\d+)?$/.test(installed ?? '') || installed === '0.0.0') throw new Error('إصدار التطبيق المثبت غير معروف');
  const next = validUpdate(update);
  const parsed = new URL(next.url);
  const match = /\/download\/(stable-(\d+)|windows-v([^/]+))\/VANTARA-([^/]+)-Windows-x64-Setup\.exe$/.exec(parsed.pathname);
  if (!match || match[4] !== next.version || (match[3] && match[3] !== next.version)) throw new Error('هوية مثبت التحديث لا تطابق الإصدار');
  const code = value => /^0\.(?:0|4)\.(\d+)$/.exec(String(value ?? ''))?.[1];
  const installedCode = code(installed);
  if (match[2]) {
    if (code(next.version) !== match[2] || (installedCode !== undefined && Number(match[2]) <= Number(installedCode))) throw new Error('رفض تحديث أقدم من Stable المثبتة');
  } else if (installedCode !== undefined || !newer(next.version, installed)) throw new Error('رفض العودة إلى قناة ويندوز القديمة');
  return next;
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', reject).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * ينزّل المثبّت إلى `dir` ويعيد مساره بعد التحقق. ملف سابق مطابق يُعاد بلا تنزيل.
 * `fetch` هو net.fetch في Electron (يتبع تحويل GitHub إلى خادم الملفات).
 */
async function downloadUpdate({ update, dir, fetch, onProgress = () => {} }) {
  const u = validUpdate(update);
  await fs.promises.mkdir(dir, { recursive: true });
  const target = path.join(dir, `VANTARA-${u.version}-Setup.exe`);
  const stat = await fs.promises.stat(target).catch(() => null);
  if (stat?.size === u.size && (await hashFile(target)) === u.sha256) return target;
  // ملفات تحديث قديمة أو ناقصة لا تبقى تأكل المساحة
  for (const name of await fs.promises.readdir(dir).catch(() => [])) if (name !== 'attempt.json') await fs.promises.rm(path.join(dir, name), { force: true }).catch(() => {});
  const res = await fetch(u.url, { redirect: 'follow' });
  if (!res?.ok || !res.body) throw new Error(`تعذر تنزيل التحديث (${res?.status ?? 'لا اتصال'})`);
  const partial = `${target}.part`;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(partial);
  let received = 0, lastReport = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > u.size) throw new Error('حجم التحديث أكبر من المعلن');
      hash.update(value);
      if (!out.write(value)) await new Promise((resolve) => out.once('drain', resolve));
      if (received - lastReport >= 1024 * 1024 || received === u.size) { lastReport = received; onProgress({ received, total: u.size }); }
    }
    await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
    if (received !== u.size) throw new Error('التحديث وصل ناقصًا');
    if (hash.digest('hex') !== u.sha256) throw new Error('بصمة التحديث لا تطابق المنشور');
    await fs.promises.rename(partial, target);
    return target;
  } catch (error) {
    out.destroy();
    await fs.promises.rm(partial, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * أمر التثبيت: المثبّت نفسه، بلا PowerShell. الأمر السابق (powershell مخفي + EncodedCommand +
 * ExecutionPolicy Bypass + SilentlyContinue) هو النمط الذي يحجبه مضاد الفيروسات بصمت من تطبيق غير
 * موقّع، ويبتلع أي فشل: لا يُثبَّت شيء، ويعود التطبيق القديم فيعرض «التحديث جاهز» مرة أخرى للأبد.
 *
 * المثبّت (windows.nsi) يفهم /UPDATE: ينتظر تحرر VANTARA.exe والمحرّكات المرفقة قبل الكتابة، ثم
 * /RELAUNCH يعيد التشغيل. /D= يثبّت فوق المجلد الذي يعمل منه التطبيق فعلًا (آخر معامل، بلا علامات
 * تنصيص كما يشترط NSIS)، فالنسخة التي تُفتح بعد التحديث هي المحدَّثة نفسها.
 * `interactive`: إعادة محاولة بعد تحديث لم يكتمل — المثبّت بواجهته، فيرى المستخدم أي خطأ.
 */
function installCommand({ installer, exe, relaunch, interactive = false }) {
  const folder = path.win32.dirname(exe);
  if (/["\r\n]/.test(folder) || /["\r\n]/.test(installer)) throw new Error('مسار التثبيت غير صالح');
  const flags = [interactive ? null : '/S', '/UPDATE', relaunch ? '/RELAUNCH' : null, `/D=${folder}`].filter(Boolean);
  // سطر أوامر حرفي: Node كان سيضع /D=... بين علامات تنصيص عند وجود مسافة، وNSIS يرفضها
  return { file: installer, args: [flags.join(' ')], options: { detached: true, stdio: 'ignore', windowsVerbatimArguments: true, argv0: `"${installer}"` } };
}

/** هل يحمل الإصدار المثبّت تحديثًا حاول التطبيق تثبيته ولم يكتمل؟ */
function newer(candidate, installed) {
  const parse = (value) => /^(\d+)\.(\d+)\.(\d+)/.exec(String(value ?? ''))?.slice(1).map(Number) ?? null;
  const a = parse(candidate), b = parse(installed);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function attemptFailed(attempt, installed) {
  return !!attempt && typeof attempt.version === 'string' && newer(attempt.version, installed);
}

module.exports = { officialInstallerUrl, validUpdate, assertForwardUpdate, downloadUpdate, installCommand, attemptFailed, newer, hashFile };
