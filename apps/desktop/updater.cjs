'use strict';
/**
 * تحديث ويندوز كما في الـAPK: ينزّل المثبّت الرسمي في الخلفية ويتحقق من بايتاته، ثم
 * يثبّته بصمت (/S) بعد خروج كل عمليات VANTARA ويعيد تشغيله.
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
  for (const name of await fs.promises.readdir(dir).catch(() => [])) await fs.promises.rm(path.join(dir, name), { force: true }).catch(() => {});
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
 * أمر PowerShell منفصل: ينتظر خروج كل عمليات مجلد VANTARA (الواجهة والمشغّل والتورنت)
 * حتى لا يبقى ملف مقفول، ثم يثبّت بصمت، ثم يعيد التشغيل إن طُلب. يُمرَّر مرمّزًا
 * (EncodedCommand) فلا تكسره المسارات العربية أو الفواصل.
 */
function installCommand({ installer, exe, relaunch }) {
  const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
  const folder = path.win32.dirname(exe);
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    `$dir=${q(folder + path.win32.sep)}`,
    'Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) } | Wait-Process -Timeout 60',
    `Start-Process -FilePath ${q(installer)} -ArgumentList '/S' -Wait`,
    relaunch ? `Start-Process -FilePath ${q(exe)}` : null,
    `Remove-Item -LiteralPath ${q(installer)} -Force`,
  ].filter(Boolean).join('; ');
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    script,
  };
}

module.exports = { officialInstallerUrl, validUpdate, downloadUpdate, installCommand, hashFile };
