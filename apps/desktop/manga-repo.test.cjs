'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const repo = require('./manga-repo.cjs');

const FP = '9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2';
const ROOT = 'https://raw.githubusercontent.com/keiyoushi/extensions/repo';

// مُرمِّز protobuf صغير للاختبار (نفس الحقول التي يقرؤها المحلل)
const varint = (n) => { let v = BigInt(n); const out = []; do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b); } while (v); return Buffer.from(out); };
const field = (f, value) => (typeof value === 'bigint' || typeof value === 'number'
  ? Buffer.concat([varint((f << 3) | 0), varint(value)])
  : Buffer.concat([varint((f << 3) | 2), varint(Buffer.byteLength(value)), Buffer.from(value)]));
const msg = (...parts) => Buffer.concat(parts);
const source = (id, name, lang) => msg(field(1, BigInt(id)), field(2, name), field(3, lang));
const extension = ({ name, pkg, apk, version, code = 0, warning = 1, sources }) => msg(
  field(1, name), field(2, pkg), field(3, msg(field(1, apk), field(2, 'icon/x.png'))), field(5, code), field(6, version), field(7, warning), ...sources.map((s) => field(8, s)));
const index = (exts, fp = FP) => zlib.gzipSync(msg(field(1, 'Keiyoushi'), field(3, fp), field(101, msg(...exts.map((e) => field(1, e))))));

test('repository base is the same canonical form the APK stores', () => {
  assert.equal(repo.base('https://github.com/keiyoushi/extensions/raw/refs/heads/repo/index.min.json'), ROOT);
  assert.equal(repo.base(`${ROOT}/repo.json`), ROOT);
  assert.equal(repo.base(`${ROOT}/`), ROOT);
  for (const bad of ['http://x.example/repo', 'https://x.example:8443/r', 'https://u:p@x.example/r', 'https://x.example/r?x=1', 'nope'])
    assert.throws(() => repo.base(bad));
});

test('repo.json without a signing key is refused; v2 index is followed and canonicalised', () => {
  assert.throws(() => repo.parseMeta(JSON.stringify({ meta: { name: 'X' } })), /مفتاح توقيع/);
  assert.equal(repo.parseMeta(JSON.stringify({ meta: { name: 'K', signingKeyFingerprint: FP.toUpperCase() } })).fingerprint, FP);
  assert.equal(repo.indexV2(JSON.stringify({ index_v2: 'https://github.com/keiyoushi/extensions/raw/repo/index.pb' })), `${ROOT}/index.pb`);
  assert.equal(repo.indexV2(JSON.stringify({ index_v2: 'http://evil.example/index.pb' })), null);
});

test('index.pb (v2) parses packages, APK links, versions and source ids (64-bit as text)', () => {
  const big = '3339599426223341161';
  const { meta, list } = repo.parseIndexV2(index([
    extension({ name: 'MangaDex', pkg: 'eu.kanade.tachiyomi.extension.all.mangadex', apk: 'https://github.com/k/e/releases/download/a/md.apk', version: '1.6.4', code: 106004, sources: [source(big, 'MangaDex', 'ar'), source('7', 'MangaDex', 'en')] }),
    extension({ name: 'Bad', pkg: '../evil', apk: 'https://x/y.apk', version: '1.6.1', sources: [] }),
    extension({ name: 'Http', pkg: 'eu.kanade.tachiyomi.extension.ar.x', apk: 'http://x/y.apk', version: '1.6.1', sources: [] }),
  ]), ROOT);
  assert.equal(meta.fingerprint, FP);
  assert.equal(list.length, 1);
  assert.deepEqual({ pkg: list[0].pkg, version: list[0].version, code: list[0].versionCode, lib: list[0].lib, lang: list[0].lang }, { pkg: 'eu.kanade.tachiyomi.extension.all.mangadex', version: '1.6.4', code: 106004, lib: 1.6, lang: 'all' });
  assert.deepEqual(repo.visibleSources(list[0]).map((s) => s.id), [big]);
  assert.equal(list[0].iconUrl, `${ROOT}/icon/x.png`);
});

test('legacy index.min.json and the visible-source rule (Arabic, own, English, then stable choice)', () => {
  const list = repo.parseIndex(JSON.stringify([
    { name: 'Tachiyomi: Team X', pkg: 'eu.kanade.tachiyomi.extension.ar.teamx', apk: 'tachiyomi-ar.teamx-v1.4.12.apk', lang: 'ar', code: 12, version: '1.4.12', nsfw: 0, sources: [{ id: '1', name: 'Team X', lang: 'ar' }] },
    { name: 'Multi', pkg: 'eu.kanade.tachiyomi.extension.all.multi', apk: 'm.apk', lang: 'all', version: '1.4.1', sources: [{ id: '9', name: 'M', lang: 'fr' }, { id: '3', name: 'M', lang: 'de' }] },
    { name: 'NoVersion', pkg: 'eu.kanade.tachiyomi.extension.ar.nov', apk: 'n.apk' },
    { name: 'Path', pkg: 'eu.kanade.tachiyomi.extension.ar.p', apk: '../x.apk', version: '1.4.1' },
  ]), ROOT);
  assert.deepEqual(list.map((x) => x.pkg), ['eu.kanade.tachiyomi.extension.ar.teamx', 'eu.kanade.tachiyomi.extension.all.multi']);
  assert.equal(list[0].name, 'Team X');
  assert.equal(list[0].apkUrl, `${ROOT}/apk/tachiyomi-ar.teamx-v1.4.12.apk`);
  assert.deepEqual(repo.visibleSources(list[1]).map((s) => s.lang), ['de']);
});

test('client: fingerprint in repo.json must match the index and must not change after adding', async () => {
  const files = new Map([
    [`${ROOT}/repo.json`, Buffer.from(JSON.stringify({ index_v2: `${ROOT}/index.pb`, meta: { name: 'Keiyoushi', signingKeyFingerprint: FP } }))],
    [`${ROOT}/index.pb`, index([extension({ name: 'A', pkg: 'eu.kanade.tachiyomi.extension.ar.a', apk: 'https://x.example/a.apk', version: '1.6.1', sources: [source('5', 'A', 'ar')] })])],
  ]);
  const client = repo.createRepoClient({ fetchBytes: async (url) => { if (!files.has(url)) throw new Error(`404 ${url}`); return files.get(url); } });
  const { meta, list } = await client.read(ROOT);
  assert.equal(meta.name, 'Keiyoushi');
  assert.equal(list.length, 1);
  await assert.rejects(client.readTrusted({ url: ROOT, fingerprint: 'f'.repeat(64) }), /تغيّر منذ أضفته/);
  files.set(`${ROOT}/index.pb`, index([], 'a'.repeat(64)));
  await assert.rejects(client.read(ROOT), /لا يطابق الفهرس/);
});
