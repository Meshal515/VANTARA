/**
 * يضع إضافات الأنمي/السينما (Aniyomi) داخل التطبيق نفسه، كما فعلنا للمانجا.
 *
 *   node tools/bundle-anime-extensions.mjs            # يحمّل ما في البيان ويتحقق من بصمته
 *   node tools/bundle-anime-extensions.mjs --update   # يرفع كل إضافة لآخر إصدار في المستودع
 *
 * البيان (`apps/web/anime/sources.json`) يثبّت رابط إصدار بعينه في مستودع yuzono،
 * والمستودع يحذف الإصدار القديم مع كل بناء: فصار رابط Anime4Up وOkAnime 404 وظهر
 * على الجهاز «تعذّر تنزيل الإضافة» — والمصدر ميت لكل تثبيت جديد. الآن الملف نفسه
 * في `android/app/src/main/assets/anime-extensions/<pkg>.apk` ببصمة البيان، والمحمِّل
 * يقرأ منه أولًا؛ التنزيل احتياط لا طريق.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MANIFEST = join(ROOT, 'apps/web/anime/sources.json');
const OUT = join(ROOT, 'android/app/src/main/assets/anime-extensions');
const REPO = 'https://raw.githubusercontent.com/yuzono/anime-repo/repo';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function bytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

const update = process.argv.includes('--update');
let text = await readFile(MANIFEST, 'utf8');
const manifest = JSON.parse(text);
const index = update ? Object.fromEntries((await (await fetch(`${REPO}/index.min.json`)).json()).map((e) => [e.pkg, e])) : {};

await mkdir(OUT, { recursive: true });
const keep = new Set();
for (const s of manifest.sources) {
  const ext = s.extension;
  if (!ext) continue;
  let { apk, sha256: want, version } = ext;
  const latest = index[ext.pkg];
  if (update && latest && latest.version !== version) {
    apk = `${REPO}/apk/${latest.apk}`;
    const buf = await bytes(apk);
    want = sha256(buf);
    // تعديل نصي يحفظ تنسيق البيان كما هو
    text = text.replace(ext.apk, apk).replace(ext.sha256, want).replace(`"version": "${version}"`, `"version": "${latest.version}"`);
    console.log(`${s.id.padEnd(12)} ${version} → ${latest.version}`);
    version = latest.version;
  }
  const buf = await bytes(apk);
  const got = sha256(buf);
  if (got !== want) throw new Error(`${s.id}: بصمة مختلفة ${got.slice(0, 12)} ≠ ${want.slice(0, 12)}`);
  await writeFile(join(OUT, `${ext.pkg}.apk`), buf);
  keep.add(`${ext.pkg}.apk`);
  console.log(`${s.id.padEnd(12)} ${version.padEnd(6)} ${(buf.length / 1024).toFixed(0)}KB ✓`);
}
for (const f of await readdir(OUT)) if (!keep.has(f)) await rm(join(OUT, f));
if (update) await writeFile(MANIFEST, text);
