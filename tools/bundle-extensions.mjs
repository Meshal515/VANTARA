/**
 * يضع إضافات المصادر داخل التطبيق نفسه.
 *
 *   node tools/bundle-extensions.mjs
 *
 * التطبيق كان ينزّل كل إضافة وقت التشغيل من رابط إصدار في keiyoushi. وkeiyoushi
 * يعيد وسم إصداراته مع كل بناء للفهرس ويحذف القديم، فتصير كل الروابط المثبّتة
 * 404 بين ليلة وضحاها — وسقطت المصادر الستة عشر كلها مرة واحدة على الجهاز.
 *
 * الآن تُحمَّل الإضافات مرة هنا، ويُتحقق من SHA-256 كل ملف مقابل
 * `GeneratedSources.kt` (المصدر الوحيد للبصمات)، وتُكتب في
 * `android/app/src/main/assets/extensions/<package>.apk`. التطبيق يقرأ منها أولًا،
 * والتنزيل يبقى احتياطًا لا طريقًا.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCES = join(ROOT, 'android/app/src/main/kotlin/dev/vantara/spike/GeneratedSources.kt');
const OUT = join(ROOT, 'android/app/src/main/assets/extensions');

export function parseSpecs(kotlin) {
  const specs = [];
  const re = /pkg = "([^"]+)",[\s\S]*?apkUrl = "([^"]+)",\s*sha256 = "([0-9a-f]{64})"/g;
  for (const m of kotlin.matchAll(re)) specs.push({ pkg: m[1], url: m[2], sha256: m[3] });
  return specs;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const specs = parseSpecs(await readFile(SOURCES, 'utf8'));
  if (!specs.length) throw new Error('no sources parsed from GeneratedSources.kt');
  await mkdir(OUT, { recursive: true });
  const keep = new Set(specs.map((s) => `${s.pkg}.apk`));
  for (const name of await readdir(OUT)) if (!keep.has(name)) await rm(join(OUT, name));

  for (const spec of specs) {
    const target = join(OUT, `${spec.pkg}.apk`);
    const existing = await readFile(target).catch(() => null);
    if (existing && sha256(existing) === spec.sha256) {
      console.log(`ok     ${spec.pkg}`);
      continue;
    }
    const res = await fetch(spec.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ← ${spec.url}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const actual = sha256(bytes);
    if (actual !== spec.sha256) throw new Error(`${spec.pkg}: sha256 ${actual.slice(0, 16)}… ≠ pinned ${spec.sha256.slice(0, 16)}…`);
    await writeFile(target, bytes);
    console.log(`wrote  ${spec.pkg}  ${bytes.length} B`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
