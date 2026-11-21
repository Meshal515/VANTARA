#!/usr/bin/env node
// يبني طبقة ويندوز فوق محرك Suwayomi (apps/desktop/engine-tools/VantaraExtensionJar.java) إلى
// apps/desktop/engine-tools/vantara-extension-jar.jar، مع بيانها vantara-extension-jar.json (بصمة المصدر والناتج).
// الأداة تُترجم ضد Suwayomi-Server.jar نفسه بالإصدار المثبّت (بصمته هنا)، فلا مكتبة إضافية تُنزَّل أو تُشحن.
// الحاجة: JDK 17 فأكثر (javac وjar). الاستعمال:
//   node tools/build-engine-tool.mjs --suwayomi-jar <Suwayomi-Server.jar من نسخة v2.4.2490 المثبّتة>
// اختبار engine-tool.test.cjs يرفض أي تعديل للمصدر لم يُعَد بناؤه.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(repo, 'apps/desktop/engine-tools');
const source = path.join(dir, 'VantaraExtensionJar.java');
const output = path.join(dir, 'vantara-extension-jar.jar');
const manifestFile = path.join(dir, 'vantara-extension-jar.json');
// Suwayomi-Server.jar داخل Suwayomi-Server-v2.4.2490-windows-x64.zip (PINNED في suwayomi-runtime.cjs)
const SUWAYOMI = { version: 'v2.4.2490', jarSha256: '825e00219bbac816a2405bb5deaf9ab304b864b7fafd03b1fb62f7727ff9c35e' };
const JAVA_RELEASE = '17';
const FIXED_DATE = '2026-11-21T00:00:00Z';

const argument = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const suwayomiJar = argument('suwayomi-jar');
if (!suwayomiJar) throw new Error('--suwayomi-jar مطلوب');
const engineSha = sha256(await fs.readFile(suwayomiJar));
if (engineSha !== SUWAYOMI.jarSha256) throw new Error(`Suwayomi-Server.jar ليس النسخة المثبّتة ${SUWAYOMI.version} (${engineSha})`);

const work = await fs.mkdtemp(path.join(os.tmpdir(), 'vantara-engine-tool-'));
try {
  const classes = path.join(work, 'classes');
  await fs.mkdir(classes);
  execFileSync('javac', ['--release', JAVA_RELEASE, '-encoding', 'UTF-8', '-nowarn', '-cp', suwayomiJar, '-d', classes, source], { stdio: 'inherit' });
  // بصمة المصدر بأسطر LF (نسخة ويندوز من git قد تحوّلها إلى CRLF، والمحتوى واحد)
  const sourceBytes = Buffer.from((await fs.readFile(source, 'utf8')).replace(/\r\n/g, '\n'));
  const mf = path.join(work, 'MANIFEST.MF');
  await fs.writeFile(mf, `Main-Class: VantaraExtensionJar\nVantara-Source-SHA256: ${sha256(sourceBytes)}\nVantara-Suwayomi: ${SUWAYOMI.version}\n`);
  await fs.rm(output, { force: true });
  execFileSync('jar', ['--create', '--date', FIXED_DATE, '--file', output, '--manifest', mf, '-C', classes, '.'], { stdio: 'inherit' });
  const jarBytes = await fs.readFile(output);
  const manifest = {
    source: 'VantaraExtensionJar.java', sourceSha256: sha256(sourceBytes), jar: 'vantara-extension-jar.jar', jarSha256: sha256(jarBytes),
    bytes: jarBytes.length, javaRelease: Number(JAVA_RELEASE), suwayomi: SUWAYOMI,
  };
  await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`بُنيت الأداة: ${jarBytes.length} بايت، ${manifest.jarSha256}`);
} finally {
  await fs.rm(work, { recursive: true, force: true });
}
