'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSuwayomiEngine, mediaPath, splitSourceId } = require('./suwayomi-engine.cjs');

const ROOT = 'https://repo.example/ext';
const RSA_CERT = '6b1ece4bb5d452286d30e5427fa41285dd4735efe47fb078efc5dc2558b7e46e';
const APK = fs.readFileSync(path.join(__dirname, 'test-fixtures/signed-rsa-v2.apk'));
const APK_NEW = fs.readFileSync(path.join(__dirname, 'test-fixtures/signed-rsa-v2-update.apk'));
const APK_OTHER_KEY = fs.readFileSync(path.join(__dirname, 'test-fixtures/signed-ec-v3.apk'));
const PKG = 'eu.kanade.tachiyomi.extension.ar.teamx';
const SRC = '7154000000000000001';

function repoFiles({ version = '1.4.12', code = 12, apk = 'teamx.apk', sources = [{ id: SRC, name: 'Team X', lang: 'ar' }] } = {}) {
  return new Map([
    [`${ROOT}/repo.json`, Buffer.from(JSON.stringify({ meta: { name: 'مستودع تجربة', signingKeyFingerprint: RSA_CERT } }))],
    [`${ROOT}/index.min.json`, Buffer.from(JSON.stringify([{ name: 'Tachiyomi: Team X', pkg: PKG, apk, lang: 'ar', code, version, nsfw: 0, sources }]))],
  ]);
}

/** محرك Suwayomi مزيف بالشكل الذي يرد به الحقيقي (GraphQL وREST) — لا شبكة. */
function fakeSuwayomi({ declares = [SRC] } = {}) {
  const engine = { installed: new Map(), uploads: [], calls: [], base: 'http://127.0.0.1:41000', running: true, mangas: new Map() };
  const respond = (data) => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
  const runtime = {
    installed: () => true,
    state: () => ({ supported: true, installed: true, running: engine.running }),
    start: async () => { engine.running = true; return { base: engine.base, auth: 'Basic x' }; },
    request: async (pathname, { method = 'GET', body } = {}) => {
      engine.calls.push(`${method} ${pathname}`);
      if (pathname === '/api/v1/extension/install') {
        const file = body.get('file');
        const bytes = Buffer.from(await file.arrayBuffer());
        engine.uploads.push(bytes);
        engine.names = [...(engine.names ?? []), file.name];
        engine.installed.set(PKG, { pkgName: PKG, versionName: bytes.equals(APK_NEW) ? '1.4.13' : '1.4.12', versionCodeLong: bytes.equals(APK_NEW) ? 13 : 12, isInstalled: true });
        return new Response('', { status: 201 });
      }
      if (pathname.startsWith('/api/v1/extension/uninstall/')) { engine.installed.delete(decodeURIComponent(pathname.split('/').pop())); return new Response('', { status: 200 }); }
      if (pathname.startsWith('/api/v1/manga/')) return new Response(Buffer.from('IMG'), { headers: { 'content-type': 'image/webp' } });
      const query = JSON.parse(body).query;
      engine.calls.push(query.replace(/\s+/g, ' ').slice(0, 60));
      if (query.includes('extensions {')) return respond({ extensions: { nodes: [...engine.installed.values()] } });
      if (query.includes('extension(pkgName:')) return respond({ extension: engine.installed.has(PKG) && query.includes(PKG) ? { source: { nodes: declares.map((id) => ({ id })) } } : null });
      if (query.includes('fetchSourceManga')) {
        assert.match(query, new RegExp(`source:"${SRC}"`));
        const m = { id: 77, url: '/series/solo', title: 'سولو', thumbnailUrl: '/api/v1/manga/77/thumbnail', author: 'A', artist: null, description: 'وصف', genre: ['أكشن', 'خيال'], status: 'ONGOING', initialized: false };
        return respond({ fetchSourceManga: { hasNextPage: true, mangas: [m] } });
      }
      if (query.includes('mangas(condition')) return respond({ mangas: { nodes: query.includes('/series/library') ? [{ id: 88 }] : [] } });
      if (query.includes('fetchManga:false')) {
        engine.chaptersFor = Number(/id:(\d+)/.exec(query)[1]);
        return respond({ fetchMangaAndChapters: { chapters: [{ id: 9, url: '/c/9', name: 'الفصل 9', uploadDate: 1, chapterNumber: 9, scanlator: null, sourceOrder: 1 }] } });
      }
      if (query.includes('fetchMangaAndChapters')) {
        return respond({ fetchMangaAndChapters: {
          manga: { id: 77, url: '/series/solo', title: 'سولو', thumbnailUrl: '/api/v1/manga/77/thumbnail', author: 'A', artist: null, description: 'وصف كامل', genre: ['أكشن'], status: 'COMPLETED', initialized: true },
          chapters: [
            { id: 1, url: '/c/1', name: 'الفصل 1', uploadDate: 1000, chapterNumber: 1, scanlator: null, sourceOrder: 1 },
            { id: 2, url: '/c/2', name: 'الفصل 2', uploadDate: 2000, chapterNumber: 2, scanlator: 'فريق', sourceOrder: 2 },
          ] } });
      }
      if (query.includes('fetchChapterPages')) return respond({ fetchChapterPages: { pages: ['/api/v1/manga/77/chapter/2/page/0', '/api/v1/manga/77/chapter/2/page/1'] } });
      return new Response(JSON.stringify({ errors: [{ message: `unexpected ${query.slice(0, 40)}` }] }), { status: 200 });
    },
  };
  return { engine, runtime };
}

function setup(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantara-suwayomi-'));
  let files = repoFiles(options.repo);
  const blobs = new Map([[`${ROOT}/apk/teamx.apk`, options.apk ?? APK], [`${ROOT}/apk/teamx-new.apk`, APK_NEW]]);
  const fake = fakeSuwayomi(options.fake);
  const events = [];
  const fetchBytes = async (url) => { const b = files.get(url) ?? blobs.get(url); if (!b) throw new Error(`404 ${url}`); return b; };
  const make = () => createSuwayomiEngine({ root: dir, runtime: fake.runtime, fetchBytes, onEvent: (e) => events.push(e) });
  return { dir, fake, events, make, engine: make(), setRepo: (o) => { files = repoFiles(o); } };
}

test('source ids are the APK ones (pkg#id) and only engine media paths are reachable', () => {
  assert.deepEqual(splitSourceId(`${PKG}#${SRC}`), { pkg: PKG, id: SRC });
  assert.equal(splitSourceId('eu.kanade.tachiyomi.extension.ar.teamx'), null);
  assert.equal(mediaPath('vantara-engine://suwayomi/manga/77/thumbnail'), '/api/v1/manga/77/thumbnail');
  assert.equal(mediaPath('vantara-engine://suwayomi/manga/77/chapter/2/page/0'), '/api/v1/manga/77/chapter/2/page/0');
  for (const bad of ['vantara-engine://suwayomi/api/graphql', 'vantara-engine://suwayomi/manga/77/../../settings', 'vantara-engine://other/manga/1/thumbnail', 'https://suwayomi/manga/1/thumbnail'])
    assert.equal(mediaPath(bad), null, bad);
});

test('add repository, install a signed extension, then it is listed without starting the engine', async () => {
  const { engine, fake } = setup();
  const added = await engine.call('addRepo', { url: `${ROOT}/index.min.json` });
  assert.deepEqual(added.repo, { url: ROOT, name: 'مستودع تجربة' });
  const index = await engine.call('repoIndex', { url: ROOT });
  assert.equal(index.extensions[0].installed, null);
  assert.deepEqual(index.extensions[0].sources, ['Team X']);
  const out = await engine.call('installExtension', { repo: ROOT, pkg: PKG });
  assert.deepEqual(out.sources, [`${PKG}#${SRC}`]);
  assert.equal(fake.engine.uploads.length, 1);
  assert.ok(fake.engine.uploads[0].equals(APK));
  assert.deepEqual(fake.engine.names, [`${PKG}-v1.4.12.apk`]);
  const list = (await engine.call('sources')).sources;
  assert.deepEqual(list.map((s) => [s.id, s.label, s.lang, s.user, s.filler]), [[`${PKG}#${SRC}`, 'Team X', 'ar', true, false]]);
  assert.deepEqual((await engine.call('repos')).installed.map((x) => [x.pkg, x.version, x.repo]), [[PKG, '1.4.12', ROOT]]);
});

test('an APK not signed by the repository key never reaches the engine', async () => {
  const { engine, fake } = setup({ apk: APK_OTHER_KEY });
  await engine.call('addRepo', { url: ROOT });
  await assert.rejects(engine.call('installExtension', { repo: ROOT, pkg: PKG }), /توقيع الإضافة لا يطابق مفتاح المستودع/);
  assert.equal(fake.engine.uploads.length, 0);
  assert.deepEqual((await engine.call('sources')).sources, []);
});

test('a package whose loaded sources differ from the repository declaration is removed and not recorded', async () => {
  const { engine, fake } = setup({ fake: { declares: ['999'] } });
  await engine.call('addRepo', { url: ROOT });
  await assert.rejects(engine.call('installExtension', { repo: ROOT, pkg: PKG }), /لا تحوي المصادر التي أعلنها المستودع/);
  assert.equal(fake.engine.installed.has(PKG), false);
  assert.deepEqual((await engine.call('repos')).installed, []);
});

test('browse, details, chapters (newest first), pages and media through the engine contract', async () => {
  const { engine, fake } = setup();
  await engine.call('addRepo', { url: ROOT });
  await engine.call('installExtension', { repo: ROOT, pkg: PKG });
  const sourceId = `${PKG}#${SRC}`;
  const popular = await engine.call('popular', { sourceId, page: 1 });
  assert.deepEqual(popular.mangas[0], { url: '/series/solo', title: 'سولو', thumbnailUrl: 'vantara-engine://suwayomi/manga/77/thumbnail', author: 'A', artist: null, description: 'وصف', genre: 'أكشن, خيال', status: 1, initialized: false });
  assert.equal(popular.hasNextPage, true);
  const detail = await engine.call('series', { sourceId, manga: popular.mangas[0] });
  assert.equal(detail.manga.status, 2);
  assert.equal(detail.manga.url, '/series/solo');
  assert.deepEqual(detail.chapters.map((c) => c.name), ['الفصل 2', 'الفصل 1']);
  assert.equal(detail.chapters[0].scanlator, 'فريق');
  const pages = await engine.call('pages', { sourceId, chapter: detail.chapters[0] });
  assert.deepEqual(pages.pages.map((p) => p.imageUrl), ['vantara-engine://suwayomi/manga/77/chapter/2/page/0', 'vantara-engine://suwayomi/manga/77/chapter/2/page/1']);
  assert.equal((await engine.call('image', { sourceId, page: pages.pages[0] })).path, pages.pages[0].imageUrl);
  const media = await engine.media(pages.pages[1].imageUrl);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('content-type'), 'image/webp');
  assert.ok(fake.engine.calls.includes('GET /api/v1/manga/77/chapter/2/page/1'));
  assert.equal((await engine.media('vantara-engine://suwayomi/api/graphql')).status, 403);
  await assert.rejects(engine.call('image', { sourceId, page: { imageUrl: 'https://evil.example/x.jpg' } }), /صفحة غير صالحة/);
  await assert.rejects(engine.call('deleteEverything', {}), /وظيفة المحرك غير متاحة/);
});

test('a work from another device (library) is found by its source url in the engine database', async () => {
  const { engine, fake } = setup();
  await engine.call('addRepo', { url: ROOT });
  await engine.call('installExtension', { repo: ROOT, pkg: PKG });
  const out = await engine.call('chapters', { sourceId: `${PKG}#${SRC}`, manga: { url: '/series/library', title: 'من الجوال' } });
  assert.equal(fake.engine.chaptersFor, 88);
  assert.deepEqual(out.chapters.map((c) => c.name), ['الفصل 9']);
});

test('update keeps the previous version on disk; rollback restores it and holds the newer one', async () => {
  const t = setup();
  await t.engine.call('addRepo', { url: ROOT });
  await t.engine.call('installExtension', { repo: ROOT, pkg: PKG });
  t.setRepo({ version: '1.4.13', code: 13, apk: 'teamx-new.apk' });
  assert.equal((await t.engine.call('repoIndex', { url: ROOT })).extensions[0].update, true);
  await t.engine.call('installExtension', { repo: ROOT, pkg: PKG });
  assert.deepEqual(await t.engine.call('updateState', { pkg: PKG }), { installed: '1.4.13', previous: '1.4.12', held: null, lastAction: null, lastVersion: null, lastCode: null, lastAt: null });
  const back = await t.engine.call('rollbackExtension', { pkg: PKG });
  assert.deepEqual(back, { version: '1.4.12', from: '1.4.13' });
  assert.ok(t.fake.engine.uploads.at(-1).equals(APK));
  assert.equal((await t.engine.call('updateState', { pkg: PKG })).held, 13);
  // المستودع عاد لإصدار أقدم من المثبت: لا رجوع تلقائي ولا يدوي
  t.setRepo({ version: '1.4.11', code: 11 });
  await t.engine.call('installExtension', { repo: ROOT, pkg: PKG }).then(() => assert.fail('downgrade accepted'), (e) => assert.match(e.message, /أقدم من المثبت/));
});

test('engine data reset: the verified APK copy is uploaded again on first use', async () => {
  const t = setup();
  await t.engine.call('addRepo', { url: ROOT });
  await t.engine.call('installExtension', { repo: ROOT, pkg: PKG });
  t.fake.engine.installed.clear();
  const fresh = t.make();
  await fresh.call('popular', { sourceId: `${PKG}#${SRC}`, page: 1 });
  assert.equal(t.fake.engine.uploads.length, 2);
  assert.ok(t.fake.engine.uploads[1].equals(APK));
});

test('a corrupt state file is moved aside (not deleted), the last good copy is restored and the UI is told once', async () => {
  const t = setup();
  await t.engine.call('addRepo', { url: ROOT });
  await t.engine.call('installExtension', { repo: ROOT, pkg: PKG });
  await t.engine.call('addRepo', { url: ROOT });
  fs.writeFileSync(path.join(t.dir, 'extensions.json'), '{ broken');
  const fresh = t.make();
  const first = await fresh.call('sources');
  assert.equal(first.stateRecovered, true);
  assert.equal(first.sources.length, 1);
  assert.equal((await fresh.call('sources')).stateRecovered, false);
  assert.ok(fs.readdirSync(t.dir).some((n) => n.startsWith('extensions.json.corrupt-')));
});

test('uninstall removes it from the engine, the list and the disk copies', async () => {
  const t = setup();
  await t.engine.call('addRepo', { url: ROOT });
  await t.engine.call('installExtension', { repo: ROOT, pkg: PKG });
  await t.engine.call('uninstallExtension', { pkg: PKG });
  assert.equal(t.fake.engine.installed.has(PKG), false);
  assert.deepEqual((await t.engine.call('sources')).sources, []);
  assert.deepEqual(fs.readdirSync(path.join(t.dir, 'apks')), []);
  await assert.rejects(t.engine.call('popular', { sourceId: `${PKG}#${SRC}` }), /غير مثبت على هذا الجهاز/);
});
