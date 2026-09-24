#!/usr/bin/env node
/**
 * بصمة الكود الأصلي: كل ما يُبنى داخل الـAPK ولا تحمله حزمة الواجهة.
 *
 * حزمة الواجهة تُطبَّق فقط فوق APK يحمل البصمة نفسها (`BuildConfig.VANTARA_NATIVE`
 * و`vantara-bundle.json`). تغيّر أي ملف هنا = الواجهة الجديدة تنتظر APK جديدًا،
 * والتطبيق يعرض «يوجد تحديث جديد». لا رقم يُرفع باليد فيُنسى.
 *
 * الخطأ الآمن هو الزيادة: ملفٌ زائد هنا يعني APK بلا داعٍ، وملفٌ ناقص يعني
 * واجهة تنادي كودًا أصليًا غير موجود. فالقائمة واسعة عن قصد:
 *   - `android/` كله (Kotlin، Manifest، الصلاحيات، الموارد، محرّك المصادر
 *     وإضافاته المدمجة، Gradle) عدا مجلد الواجهة الذي ينسخه `cap sync`.
 *   - `capacitor.config.ts`: يُنسخ إلى أصول أندرويد لا إلى الواجهة.
 *   - إصدارات حزم `@capacitor/*` المثبّتة كما في `pnpm-lock.yaml`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const WEB_COPY = 'android/app/src/main/assets/public/';

export function nativeInputs(root = ROOT) {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'android', 'capacitor.config.ts'], { cwd: root })
    .toString()
    .split('\0')
    .filter((path) => path && !path.startsWith(WEB_COPY));
  return tracked.sort();
}

export function capacitorVersions(lockfile) {
  return lockfile
    .split('\n')
    .filter((line) => /^ {2}'@capacitor\/[^']+@[^']+':$/.test(line))
    .map((line) => line.trim())
    .sort();
}

export function nativeFingerprint(root = ROOT) {
  const hash = createHash('sha256');
  for (const path of nativeInputs(root)) {
    hash.update(`${path}\0`);
    hash.update(readFileSync(resolve(root, path)));
    hash.update('\0');
  }
  for (const line of capacitorVersions(readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8'))) hash.update(`${line}\n`);
  return hash.digest('hex').slice(0, 24);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${nativeFingerprint()}\n`);
}
