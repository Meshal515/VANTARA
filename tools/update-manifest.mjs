#!/usr/bin/env node
/**
 * يكتب `vantara-update.json`: البيان الذي يقرؤه التطبيق من آخر إصدار مستقر.
 *
 *   node tools/update-manifest.mjs --out dist/vantara-update.json \
 *     --version 0.0.5 --code 5 --native <بصمة> --base <رابط الإصدار> \
 *     --apk dist/VANTARA-stable.apk --web dist/VANTARA-web.zip [--since stable-4]
 *
 * `minimumSupportedVersionCode` من `tools/update-policy.json`: أي APK أقدم
 * منه يرى «تحديث مطلوب» ولا يكمل حتى يثبّت. الافتراضي صفر: كل تحديث اختياري.
 * `changelog` عناوين طلبات الدمج منذ الإصدار السابق.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
/** للنسخة 0.0.3 وحدها: تعرض الـAPK حين يختلف عن رقمها (1). */
export const LEGACY_NATIVE_API = 2;

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** عناوين طلبات الدمج (السطر الأول من جسم commit الدمج)، أو موضوع الـcommit. */
export function changelogFrom(log) {
  return log
    .split('\x1e')
    .map((entry) => {
      const [subject = '', body = ''] = entry.trim().split('\x1f');
      const title = body.trim().split('\n')[0]?.trim();
      return (/^Merge pull request/.test(subject) && title ? title : subject).trim();
    })
    .filter((line) => line && !/^Merge (branch|remote-tracking)/.test(line))
    .slice(0, 8);
}

export function buildManifest({ version, code, native, base, apk, web, changelog, policy }) {
  if (!/^[0-9a-f]{24}$/.test(native)) throw new Error(`bad native fingerprint: ${native}`);
  return {
    format: 2,
    versionName: version,
    versionCode: Number(code),
    native,
    minimumSupportedVersionCode: Number(policy?.minimumSupportedVersionCode ?? 0),
    changelog,
    apk: { url: `${base}/VANTARA-stable.apk`, sha256: sha256(apk), size: statSync(apk).size },
    web: { url: `${base}/VANTARA-web.zip`, sha256: sha256(web), size: statSync(web).size },
    // للنسخة 0.0.3: تقرأ هذين الحقلين فقط
    nativeApi: LEGACY_NATIVE_API,
    notes: changelog[0] ?? '',
  };
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = args(process.argv.slice(2));
  const range = a.since ? [`${a.since}..HEAD`] : ['-1'];
  const log = execFileSync('git', ['log', '--first-parent', '--format=%s%x1f%b%x1e', ...range], { cwd: ROOT }).toString();
  const policy = JSON.parse(readFileSync(resolve(ROOT, 'tools/update-policy.json'), 'utf8'));
  const manifest = buildManifest({ ...a, changelog: changelogFrom(log), policy });
  writeFileSync(a.out, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}
