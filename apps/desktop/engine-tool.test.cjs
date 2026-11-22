'use strict';
// طبقة ويندوز فوق Suwayomi: الأداة المشحونة هي المبنية من مصدرها (tools/build-engine-tool.mjs)، لإصدار المحرك المثبّت،
// ولا تحوي إلا أصنافها. ومصدرها لا يملك شبكة ولا تشغيل برامج: يقرأ APK ويكتب jar فقط.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { PINNED, TOOL_JAR } = require('./suwayomi-runtime.cjs');

const dir = path.join(__dirname, 'engine-tools');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'vantara-extension-jar.json'), 'utf8'));
// بأسطر LF كما بُنيت (git في ويندوز قد يحوّلها إلى CRLF)
const source = Buffer.from(fs.readFileSync(path.join(dir, 'VantaraExtensionJar.java'), 'utf8').replace(/\r\n/g, '\n'));
const jar = fs.readFileSync(TOOL_JAR);

/** أسماء ملفات zip ومحتواها من الدليل المركزي (بلا مكتبات). */
function zipEntries(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'zip end record');
  let at = bytes.readUInt32LE(end + 16);
  const out = new Map();
  for (let i = 0, n = bytes.readUInt16LE(end + 10); i < n; i++) {
    assert.equal(bytes.readUInt32LE(at), 0x02014b50);
    const method = bytes.readUInt16LE(at + 10), size = bytes.readUInt32LE(at + 20);
    const nameLen = bytes.readUInt16LE(at + 28), extra = bytes.readUInt16LE(at + 30), comment = bytes.readUInt16LE(at + 32), local = bytes.readUInt32LE(at + 42);
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLen);
    const dataAt = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const raw = bytes.subarray(dataAt, dataAt + size);
    out.set(name, method === 8 ? zlib.inflateRawSync(raw) : raw);
    at += 46 + nameLen + extra + comment;
  }
  return out;
}

test('the shipped converter is the one built from its source, for the pinned engine', () => {
  assert.equal(manifest.sourceSha256, sha256(source), 'المصدر تغيّر: أعد البناء بـtools/build-engine-tool.mjs');
  assert.equal(manifest.jarSha256, sha256(jar));
  assert.equal(manifest.bytes, jar.length);
  assert.equal(manifest.suwayomi.version, PINNED.version, 'إصدار المحرك تغيّر: أعد بناء الأداة ضده واختبرها');
  assert.ok(jar.length < 64 * 1024, 'أداة صغيرة');
});

test('the jar holds only the converter classes and a manifest naming its source', () => {
  const entries = zipEntries(jar);
  for (const name of entries.keys()) assert.match(name, /^(META-INF\/|META-INF\/MANIFEST\.MF|VantaraExtensionJar(\$[\w$]+)?\.class)$/, name);
  const mf = String(entries.get('META-INF/MANIFEST.MF')).replace(/\r?\n /g, ''); // أسطر البيان تُلف عند 72 بايت
  assert.match(mf, /Main-Class: VantaraExtensionJar/);
  assert.match(mf, new RegExp(`Vantara-Source-SHA256: ${sha256(source)}`));
  assert.match(mf, new RegExp(`Vantara-Suwayomi: ${PINNED.version.replace(/\./g, '\\.')}`));
});

test('the converter source has no network and starts no programs', () => {
  const text = String(source);
  for (const banned of [/\bjava\.net\b/, /\bSocket\b/, /HttpClient/, /\bURL\b/, /ProcessBuilder/, /Runtime\.getRuntime/, /\bokhttp3\b/, /System\.load/, /Class\.forName/])
    assert.doesNotMatch(text, banned, String(banned));
  assert.match(text, /AGPL-3\.0-only/);
});
