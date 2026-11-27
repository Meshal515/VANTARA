'use strict';
// إضافات Mihon في ويندوز عبر محرك Suwayomi المحلي (suwayomi-runtime.cjs)، بعقد المحرك الأصلي نفسه في الـAPK
// (ExtensionEnginePlugin.kt): نفس أسماء الدوال ونفس أشكال النتائج ونفس معرّفات المصادر `pkg#id`، فالمكتبة والتقدم
// يتزامنان بين الجوال وويندوز بلا ترجمة. Suwayomi هنا محمِّل ومشغّل فقط؛ المستودعات والثقة عندنا:
//  - المستودع يُقرأ بقواعد الـAPK نفسها (manga-repo.cjs) ومفتاح توقيعه يُثبَّت عند إضافته.
//  - كل APK يُتحقق من توقيعه بمفتاح المستودع (apk-signature.cjs) قبل أن يصل للمحرك، ولا رجوع لإصدار أقدم.
//  - آخر إصدار سليم يبقى على القرص للرجوع إليه، والتحديث لا يُعتمد إلا إن حمّل المحرك مصادره المعلنة.
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const repoLib = require('./manga-repo.cjs');
const { requireSignedBy } = require('./apk-signature.cjs');

const MEDIA = 'vantara-engine://suwayomi';
const STATUS = Object.freeze({ UNKNOWN: 0, ONGOING: 1, COMPLETED: 2, LICENSED: 3, PUBLISHING_FINISHED: 4, CANCELLED: 5, ON_HIATUS: 6 });
const APK_LIMIT = 40 * 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const MANGA_FIELDS = 'id url title thumbnailUrl author artist description genre status initialized';
const CHAPTER_FIELDS = 'id url name uploadDate chapterNumber scanlator sourceOrder';

const arabic = (message, code) => Object.assign(new Error(message), code ? { code } : {});
/** خطأ مصدر بالعربية: كود الإضافة الذي لا يعمل في المحرك يُسمّى كذلك، وغيره بسببه. */
const sourceFailure = (message) => (/VerifyError|IncompatibleClassChangeError|NoSuchMethodError|NoClassDefFoundError|AbstractMethodError/.test(String(message))
  ? arabic('هذا المصدر لا يعمل في محرك ويندوز بعد (كود إضافته لا يتوافق معه)؛ يعمل في تطبيق الجوال', 'ENGINE_VERIFY')
  // جسر Cloudflare (cf-bridge.cjs) يرد 409 حين يطلب الموقع إنسانًا؛ والمحرك يقول «bypass» حين لا يصل كوكي التحقق
  : /HTTP error 409\b|CloudflareBypassException|Cloudflare bypass/.test(String(message))
    ? arabic('المصدر يطلب تحققًا من المتصفح: افتح الإضافات واضغط «تحقق» ثم أعد المحاولة', 'challenge')
    : arabic(cleanError(message) || 'تعذّر الطلب من المصدر', 'SOURCE_ERROR'));
const gqlString = (value) => JSON.stringify(String(value ?? ''));
const cleanError = (message) => String(message ?? '').replace(/(?:https?:\/\/)\S+/gi, '[رابط]').replace(/^(?:[\w.]+(?:Exception|Error):\s*)+/, '').slice(0, 220);

/** `pkg#id` ← [pkg, id]؛ غير ذلك ليس مصدر إضافة مستخدم. */
function splitSourceId(sourceId) {
  const m = /^([A-Za-z][\w]*(?:\.[\w]+)+)#(-?\d{1,20})$/.exec(String(sourceId ?? ''));
  return m ? { pkg: m[1], id: m[2] } : null;
}
const isEngineSource = (sourceId) => splitSourceId(sourceId) != null;

/** مسار وسائط مسموح فقط: غلاف عمل، أو صفحة فصل. أي شيء آخر يُرفض. */
function mediaPath(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'vantara-engine:' || u.host !== 'suwayomi' || u.username || u.password) return null;
  const thumb = /^\/manga\/(\d{1,9})\/thumbnail$/.exec(u.pathname);
  if (thumb) return `/api/v1/manga/${thumb[1]}/thumbnail`;
  const page = /^\/manga\/(\d{1,9})\/chapter\/(\d{1,9})\/page\/(\d{1,5})$/.exec(u.pathname);
  return page ? `/api/v1/manga/${page[1]}/chapter/${page[2]}/page/${page[3]}` : null;
}

function toManga(m) {
  return {
    url: m.url, title: m.title ?? '', thumbnailUrl: m.thumbnailUrl ? `${MEDIA}/manga/${m.id}/thumbnail` : null,
    author: m.author ?? null, artist: m.artist ?? null, description: m.description ?? null,
    genre: Array.isArray(m.genre) && m.genre.length ? m.genre.join(', ') : null,
    status: STATUS[m.status] ?? 0, initialized: Boolean(m.initialized),
  };
}
const toChapter = (c) => ({ url: c.url, name: c.name ?? '', dateUpload: Number(c.uploadDate) || 0, chapterNumber: Number.isFinite(c.chapterNumber) ? c.chapterNumber : -1, scanlator: c.scanlator ?? null });

function createSuwayomiEngine({ root, runtime, fetchBytes, convert = null, onEvent = () => {}, now = Date.now }) {
  const stateFile = path.join(root, 'extensions.json');
  const apkDir = path.join(root, 'apks');
  const client = repoLib.createRepoClient({ fetchBytes });
  let state = null, recovered = false, chain = Promise.resolve();
  const mangaIds = new Map();     // `${source}\n${url}` → id
  const chapterIds = new Map();   // `${source}\n${url}` → id
  const loadedIn = new Map();     // pkg → endpoint.base الذي حُمِّلت فيه
  const listings = new Map();     // source → 'SEARCH' | 'POPULAR' (مسار الكتالوج الكامل)
  const locks = new Map();        // عمل واحد = نداء واحد في كل مرة (حارس lib 1.6)
  const conversions = new Map();  // pkg → آخر نتيجة لطبقة التحويل (للتشخيص)

  // ---------- الحالة على القرص ----------
  const empty = () => ({ version: 1, repos: [], extensions: [], updates: {} });
  const valid = (s) => s && s.version === 1 && Array.isArray(s.repos) && Array.isArray(s.extensions);
  async function load() {
    if (state) return state;
    let raw = null;
    try { raw = await fsp.readFile(stateFile, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (raw == null) { state = empty(); return state; }
    try {
      const parsed = JSON.parse(raw);
      if (!valid(parsed)) throw new Error('shape');
      state = { updates: {}, ...parsed };
    } catch {
      // تالف: يُنقل جانبًا (لا يُحذف) ويُستعاد آخر نسخة سليمة إن وُجدت، ويُقال مرة للواجهة
      await fsp.rename(stateFile, `${stateFile}.corrupt-${now()}`).catch(() => {});
      recovered = true;
      try { const bak = JSON.parse(await fsp.readFile(`${stateFile}.bak`, 'utf8')); state = valid(bak) ? { updates: {}, ...bak } : empty(); } catch { state = empty(); }
    }
    return state;
  }
  async function save(next) {
    await fsp.mkdir(root, { recursive: true });
    const text = JSON.stringify(next);
    const tmp = `${stateFile}.tmp`;
    await fsp.writeFile(tmp, text);
    await fsp.rename(tmp, stateFile);
    state = next;
    // نسخة ثانية من آخر حالة سليمة (تُكتب بعد نجاح الأولى): إن تلف الملف لاحقًا لا يضيع آخر تغيير
    await fsp.writeFile(`${stateFile}.bak.tmp`, text).then(() => fsp.rename(`${stateFile}.bak.tmp`, `${stateFile}.bak`)).catch(() => {});
  }
  /** تغييرات الحالة واحدة بعد أخرى (تثبيت وحذف ورجوع لا تتسابق). */
  const exclusive = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
  const changed = () => onEvent({ type: 'manga-extensions/changed' });

  const apkFile = (pkg, sha) => path.join(apkDir, `${pkg}-${sha.slice(0, 16)}.apk`);
  const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

  // ---------- طلبات المحرك ----------
  async function gql(query) {
    const response = await runtime.request('/api/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
    const body = await response.json().catch(() => null);
    if (!body) throw arabic(`المحرك ردّ بخطأ ${response.status}`, 'ENGINE_HTTP');
    if (body.errors?.length && !body.data) throw sourceFailure(body.errors[0]?.message);
    return { data: body.data, errors: body.errors ?? [] };
  }
  async function engineExtensions() {
    const { data } = await gql('{ extensions { nodes { pkgName versionName versionCodeLong isInstalled } } }');
    return new Map((data?.extensions?.nodes ?? []).filter((x) => x.isInstalled).map((x) => [x.pkgName, x]));
  }
  async function engineSourceIds(pkg) {
    // من الإضافة إلى مصادرها (لا العكس): المصدر المحلي (0) بلا إضافة يُسقط القائمة كلها في GraphQL
    const { data } = await gql(`{ extension(pkgName:${gqlString(pkg)}) { source { nodes { id } } } }`).catch(() => ({ data: null }));
    return (data?.extension?.source?.nodes ?? []).map((s) => String(s.id));
  }
  /**
   * رفع APK موقّع عبر GraphQL (installExternalExtension، مواصفة رفع الملفات المعيارية: operations وmap والملف). مسار
   * REST القديم /api/v1/extension/install أُزيل من Suwayomi بعد v2.4.2366 (ويندوز حقيقي: Not Found).
   */
  async function uploadOnce(pkg, bytes, version, kind = 'apk') {
    const form = new FormData();
    form.append('operations', JSON.stringify({
      query: 'mutation ($file: Upload!) { installExternalExtension(input: { extensionFile: $file }) { extension { pkgName isInstalled } } }',
      variables: { file: null },
    }));
    form.append('map', JSON.stringify({ 0: ['variables.file'] }));
    // الاسم يحمل الإصدار: Suwayomi يشتق منه اسم ملف jar، فإصداران مختلفان لا يتصادمان عند التحديث والرجوع
    const type = kind === 'jar' ? 'application/java-archive' : 'application/vnd.android.package-archive';
    form.append('0', new Blob([bytes], { type }), `${pkg}-v${String(version ?? '0').replace(/[^\w.-]/g, '')}.${kind}`);
    const r = await runtime.request('/api/graphql', { method: 'POST', body: form, timeout: 180_000 });
    const body = await r.json().catch(() => null);
    const installed = body?.data?.installExternalExtension?.extension;
    if (r.status < 400 && installed?.pkgName && !body?.errors?.length) return { ok: true };
    const said = runtime.recentOutput?.() ?? '';
    const text = body?.errors?.[0]?.message ?? (body ? '' : `HTTP ${r.status}`);
    return { ok: false, verify: /VerifyError/.test(text) || /java\.lang\.VerifyError/.test(said.slice(-6000)), text };
  }
  /**
   * رفع إضافة موقّعة. رفض مدقق الـJVM (VerifyError: كود تحويل DEX إلى JVM تالف) يُقال صراحة: تشغيلها بلا تدقيق أسقط
   * المحرك كله على ويندوز حقيقي، فلا تُشغَّل.
   */
  async function upload(pkg, bytes, version) {
    // طبقة ويندوز (engine-tools/VantaraExtensionJar): تحويل APK إلى jar يصلح ما يكسره dex2jar في كود R8، بعد
    // التحقق من التوقيع على APK الأصلي. فشل التحويل نفسه لا يمنع شيئًا: يُرفع APK فيحوّله Suwayomi بطريقته.
    let jar = null;
    if (convert) {
      try {
        const out = await convert(bytes, { pkg, version });
        jar = out?.jar ?? null;
        conversions.set(pkg, { ok: Boolean(jar), report: out?.report ?? null });
      } catch (error) {
        conversions.set(pkg, { ok: false, error: String(error?.message ?? error).slice(0, 300) });
      }
    }
    const out = jar ? await uploadOnce(pkg, jar, version, 'jar') : await uploadOnce(pkg, bytes, version);
    if (!out.ok) throw arabic(out.verify ? 'هذه الإضافة لا تعمل في محرك ويندوز بعد (كودها لا يتحوّل سليمًا)؛ تعمل في تطبيق الجوال' : `المحرك لم يقبل الإضافة: ${cleanError(out.text)}`.trim(), out.verify ? 'ENGINE_VERIFY' : 'ENGINE_INSTALL');
  }
  async function engineUninstall(pkg) {
    // GraphQL (مسار REST القديم أُزيل). إضافة غير موجودة في المحرك ليست خطأ: النتيجة المطلوبة حاصلة
    const { errors } = await gql(`mutation { updateExtension(input:{id:${gqlString(pkg)}, patch:{uninstall:true}}) { extension { pkgName isInstalled } } }`).catch((error) => ({ errors: [{ message: error.message }] }));
    if (errors.length && !/not found|no such|could not find|Collection is empty/i.test(String(errors[0]?.message))) throw arabic('تعذّر إزالة الإضافة من المحرك', 'ENGINE_UNINSTALL');
    loadedIn.delete(pkg);
  }

  /** الإضافة محمّلة في هذا التشغيل للمحرك؛ وإن غابت (بيانات المحرك أعيدت) تُرفع من نسختها الموثّقة. */
  async function ensureLoaded(pkg) {
    const st = await load();
    const ext = st.extensions.find((x) => x.pkg === pkg);
    if (!ext) throw arabic('هذا المصدر غير مثبت على هذا الجهاز؛ ثبّت إضافته من «إضافاتي»', 'SOURCE_NOT_INSTALLED');
    if (ext.enabled === false) throw arabic('هذه الإضافة معطّلة', 'SOURCE_DISABLED');
    const endpoint = await runtime.start();
    if (loadedIn.get(pkg) === endpoint.base) return ext;
    const present = await engineExtensions();
    if (!present.has(pkg)) {
      const bytes = await fsp.readFile(apkFile(pkg, ext.sha256)).catch(() => null);
      if (!bytes || sha256(bytes) !== ext.sha256) throw arabic('نسخة الإضافة المحفوظة غير موجودة؛ أعد تثبيتها من «إضافاتي»', 'APK_MISSING');
      await upload(pkg, bytes, ext.version);
    }
    loadedIn.set(pkg, endpoint.base);
    return ext;
  }

  async function sourceOf(sourceId) {
    const ids = splitSourceId(sourceId);
    if (!ids) throw arabic('معرّف المصدر غير صالح', 'SOURCE_ID');
    const ext = await ensureLoaded(ids.pkg);
    return { ...ids, ext };
  }

  // ---------- التصفح ----------
  async function fetchPage(source, type, page, query = '') {
    const q = type === 'SEARCH' ? `, query:${gqlString(query)}` : '';
    const { data, errors } = await gql(`mutation { fetchSourceManga(input:{source:${gqlString(source)}, type:${type}, page:${Number(page) || 1}${q}}) { hasNextPage mangas { ${MANGA_FIELDS} } } }`);
    const out = data?.fetchSourceManga;
    // فشل المصدر لا يُعرض قائمة فارغة صامتة (ويندوز حقيقي: Team X «فارغ» في 93ms كان VerifyError مخفيًا)
    if (!out && errors.length) throw sourceFailure(errors[0]?.message);
    const mangas = (out?.mangas ?? []).map((m) => { mangaIds.set(`${source}\n${m.url}`, m.id); return toManga(m); });
    return { mangas, hasNextPage: Boolean(out?.hasNextPage), page: Number(page) || 1 };
  }
  async function paged(args, type) {
    const { id } = await sourceOf(args?.sourceId);
    return fetchPage(id, type, args?.page ?? 1, args?.query ?? '');
  }
  async function catalogue(args) {
    const { id } = await sourceOf(args?.sourceId);
    const page = Number(args?.page) || 1;
    const known = listings.get(id);
    if (known) return fetchPage(id, known, page);
    // مثل الـAPK: البحث الفارغ بفلاتر المصدر الافتراضية هو الكتالوج الكامل، وإلا الرائج
    const all = await fetchPage(id, 'SEARCH', 1, '').catch(() => null);
    if (all?.mangas?.length) { listings.set(id, 'SEARCH'); return page === 1 ? all : fetchPage(id, 'SEARCH', page); }
    listings.set(id, 'POPULAR');
    return fetchPage(id, 'POPULAR', page);
  }

  /** رقم العمل في المحرك: من الذاكرة، ثم قاعدة المحرك، ثم بحث بالعنوان يطابق الرابط نفسه (عمل من مكتبة جهاز آخر). */
  async function mangaIdOf(source, manga) {
    const url = manga?.url;
    if (typeof url !== 'string' || !url) throw arabic('العمل بلا رابط', 'MANGA_URL');
    const key = `${source}\n${url}`;
    if (mangaIds.has(key)) return mangaIds.get(key);
    const { data } = await gql(`{ mangas(condition:{sourceId:${gqlString(source)}, url:${gqlString(url)}}, first:1) { nodes { id } } }`);
    let id = data?.mangas?.nodes?.[0]?.id ?? null;
    if (id == null && manga?.title) {
      await fetchPage(source, 'SEARCH', 1, manga.title).catch(() => null);
      id = mangaIds.get(key) ?? null;
    }
    if (id == null) throw arabic('لم نجد هذا العمل في المصدر؛ افتحه من بحث المصدر نفسه مرة', 'MANGA_NOT_FOUND');
    mangaIds.set(key, id);
    return id;
  }
  const chaptersFrom = (source, list) => [...(list ?? [])].sort((a, b) => (b.sourceOrder ?? 0) - (a.sourceOrder ?? 0)).map((c) => { chapterIds.set(`${source}\n${c.url}`, c.id); return toChapter(c); });
  function locked(key, fn) {
    const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(key, tail);
    tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
    return run;
  }
  async function series(args) {
    const { id: source } = await sourceOf(args?.sourceId);
    const mangaId = await mangaIdOf(source, args?.manga);
    return locked(`${source}\n${mangaId}`, async () => {
      const { data, errors } = await gql(`mutation { fetchMangaAndChapters(input:{id:${mangaId}, fetchManga:true, fetchChapters:true}) { manga { ${MANGA_FIELDS} } chapters { ${CHAPTER_FIELDS} } } }`);
      const out = data?.fetchMangaAndChapters;
      // فشل المصدر بلا فصول محفوظة = خطأ واضح؛ وإن كانت محفوظة من قبل تُعرض (كالـAPK: الوصف المكسور لا يمنع القراءة)
      if (!out || (errors.length && !out.chapters?.length)) throw (errors.length ? sourceFailure(errors[0]?.message) : arabic('تعذّر جلب العمل من المصدر', 'SOURCE_ERROR'));
      const manga = { ...toManga(out.manga), url: args.manga.url };
      if (!manga.title) manga.title = args.manga.title ?? '';
      const chapters = chaptersFrom(source, out.chapters);
      return { manga, chapters, count: chapters.length };
    });
  }
  async function chapters(args) {
    const { id: source } = await sourceOf(args?.sourceId);
    const mangaId = await mangaIdOf(source, args?.manga);
    return locked(`${source}\n${mangaId}`, async () => {
      // fetchChapters قديمة في Suwayomi (lib 1.6): النداء الجامع بلا تفاصيل
      const { data, errors } = await gql(`mutation { fetchMangaAndChapters(input:{id:${mangaId}, fetchManga:false, fetchChapters:true}) { chapters { ${CHAPTER_FIELDS} } } }`);
      if (!data?.fetchMangaAndChapters || errors.length) throw (errors.length ? sourceFailure(errors[0]?.message) : arabic('تعذّر جلب الفصول', 'SOURCE_ERROR'));
      const list = chaptersFrom(source, data.fetchMangaAndChapters.chapters);
      return { chapters: list, count: list.length };
    });
  }
  async function chapterIdOf(source, chapter) {
    const url = chapter?.url;
    if (typeof url !== 'string' || !url) throw arabic('الفصل بلا رابط', 'CHAPTER_URL');
    const key = `${source}\n${url}`;
    if (chapterIds.has(key)) return chapterIds.get(key);
    const { data } = await gql(`{ chapters(condition:{url:${gqlString(url)}}) { nodes { id manga { sourceId } } } }`);
    const hit = (data?.chapters?.nodes ?? []).find((c) => String(c.manga?.sourceId) === String(source));
    if (!hit) throw arabic('افتح صفحة العمل أولًا ليُعرف هذا الفصل', 'CHAPTER_NOT_FOUND');
    chapterIds.set(key, hit.id);
    return hit.id;
  }
  async function pages(args) {
    const { id: source } = await sourceOf(args?.sourceId);
    const chapterId = await chapterIdOf(source, args?.chapter);
    const { data, errors } = await gql(`mutation { fetchChapterPages(input:{chapterId:${chapterId}}) { pages } }`);
    if (!data?.fetchChapterPages) throw (errors.length ? sourceFailure(errors[0]?.message) : arabic('تعذّر جلب صفحات الفصل', 'SOURCE_ERROR'));
    const list = data.fetchChapterPages.pages.map((p, index) => {
      const m = /^\/api\/v1\/manga\/(\d+)\/chapter\/(\d+)\/page\/(\d+)/.exec(p);
      const imageUrl = m ? `${MEDIA}/manga/${m[1]}/chapter/${m[2]}/page/${m[3]}` : null;
      return { index, url: '', imageUrl };
    }).filter((p) => p.imageUrl);
    return { pages: list, count: list.length };
  }

  /** طلب الوسائط من بروتوكول `vantara-engine:` (صور الصفحات والأغلفة) بمصادقة المحرك. */
  async function media(url) {
    const pathname = mediaPath(url);
    if (!pathname) return new Response('غير مسموح', { status: 403 });
    try {
      const r = await runtime.request(pathname, { timeout: 120_000 });
      const headers = { 'content-type': r.headers.get('content-type') || 'image/jpeg', 'cache-control': 'private, max-age=86400', 'access-control-allow-origin': '*' };
      return new Response(r.body, { status: r.status, headers });
    } catch {
      return new Response('', { status: 502 });
    }
  }

  // ---------- المستودعات والإضافات ----------
  // البصمة علنية (مفتاح توقيع المستودع): مزامنة الإضافات بين الأجهزة تثبّتها فلا يُقبل مستودع غيّر مفتاحه
  const repoJson = (r) => ({ url: r.url, name: r.name, fingerprint: r.fingerprint, ...(r.iconUrl ? { iconUrl: r.iconUrl } : {}) });
  async function repos() {
    const st = await load();
    return {
      readyCatalogDismissed: true, repos: st.repos.map(repoJson),
      installed: st.extensions.map((x) => ({ pkg: x.pkg, name: x.name, version: x.version, repo: x.repo, enabled: x.enabled !== false, ...(x.iconUrl ? { iconUrl: x.iconUrl } : {}) })),
    };
  }
  const addRepo = ({ url, fingerprint = null } = {}) => exclusive(async () => {
    const root = repoLib.base(url);
    const { meta, list } = await client.read(root);
    // من مزامنة الحساب: المفتاح الذي عرفه جهازك الآخر شرط، فمستودع غيّر مفتاحه لا يُضاف هنا بصمت
    if (fingerprint && String(fingerprint).toLowerCase() !== String(meta.fingerprint).toLowerCase()) throw arabic('مفتاح توقيع المستودع لا يطابق ما في حسابك؛ لم يُضف.', 'MANGA_REPOSITORY_KEY_MISMATCH');
    const st = await load();
    const existing = st.repos.find((r) => r.url === root);
    if (existing && existing.fingerprint !== meta.fingerprint) throw arabic('تغيّر مفتاح توقيع المستودع؛ احتُفظ بالمستودع وإضافاته الحالية ولم يُعتمد المفتاح الجديد.', 'MANGA_REPOSITORY_KEY_CHANGED');
    const repo = { url: root, name: meta.name, fingerprint: meta.fingerprint, ...(meta.iconUrl ? { iconUrl: meta.iconUrl } : {}) };
    if (!existing) await save({ ...st, repos: [...st.repos, repo] });
    changed();
    return { repo: repoJson(repo), count: list.length };
  });
  const removeRepo = ({ url } = {}) => exclusive(async () => {
    const root = repoLib.base(url);
    const st = await load();
    // الإضافات المثبتة منه تبقى تعمل (كما في الـAPK)؛ تحديثها يحتاج إضافة المستودع من جديد
    await save({ ...st, repos: st.repos.filter((r) => r.url !== root) });
    changed();
  });
  async function repoIndex({ url } = {}) {
    const root = repoLib.base(url);
    const st = await load();
    const repo = st.repos.find((r) => r.url === root);
    if (!repo) throw arabic('أضف المستودع أولًا');
    const list = await client.readTrusted(repo);
    return {
      extensions: list.map((ext) => {
        const mine = st.extensions.find((x) => x.pkg === ext.pkg);
        return {
          pkg: ext.pkg, name: ext.name, version: ext.version, lang: ext.lang, nsfw: ext.nsfw, anime: ext.pkg.includes('.animeextension.'),
          arabic: ext.sources.some((s) => s.lang.toLowerCase() === 'ar'), builtin: false, installed: mine?.version ?? null,
          update: Boolean(mine && mine.version !== ext.version && !(mine.versionCode && ext.versionCode && ext.versionCode < mine.versionCode)),
          sources: repoLib.visibleSources(ext).map((s) => s.name), ...(ext.iconUrl || repo.iconUrl ? { iconUrl: ext.iconUrl ?? repo.iconUrl } : {}),
        };
      }),
    };
  }

  /**
   * تنزيل ⇒ توقيع المستودع ⇒ رفع للمحرك ⇒ تأكيد أن المحرك حمّل المصادر المعلنة ⇒ اعتماد. فشل أي خطوة لا يغيّر
   * الإصدار العامل: التحديث الفاشل يُرجَع فيه المحرك إلى النسخة السابقة المحفوظة.
   */
  async function stageAndCommit(st, repo, ext, { auto = false } = {}) {
    if (ext.pkg.includes('.animeextension.')) throw arabic('إضافات الأنمي (Aniyomi) غير مدعومة بعد');
    const prev = st.extensions.find((x) => x.pkg === ext.pkg) ?? null;
    if (prev && prev.versionCode > 0 && ext.versionCode > 0 && ext.versionCode < prev.versionCode)
      throw arabic(`${ext.name}: الإصدار في المستودع (${ext.version}) أقدم من المثبت عندك (${prev.version})؛ لا نرجع لإصدار أقدم`);
    const visible = repoLib.visibleSources(ext);
    if (!visible.length) throw arabic(`${ext.name}: المستودع لا يعلن مصادر لهذه الإضافة`);
    const bytes = await fetchBytes(ext.apkUrl, APK_LIMIT);
    requireSignedBy(bytes, repo.fingerprint);
    const sha = sha256(bytes);
    if (prev && prev.sha256 === sha) {
      await ensureLoaded(ext.pkg);
      return prev;
    }
    await fsp.mkdir(apkDir, { recursive: true });
    await fsp.writeFile(apkFile(ext.pkg, sha), bytes);
    onEvent({ type: 'manga-extensions/installing', pkg: ext.pkg, name: ext.name });
    await runtime.start();
    const present = await engineExtensions();
    const prevBytes = prev ? await fsp.readFile(apkFile(prev.pkg, prev.sha256)).catch(() => null) : null;
    // نفس رقم الإصدار أو أقل في المحرك: Suwayomi يقبل الرفع كتحديث فقط إن كان الرقم أكبر، فيُزال القديم أولًا
    const engineCode = Number(present.get(ext.pkg)?.versionCodeLong ?? -1);
    if (present.has(ext.pkg) && !(ext.versionCode > engineCode)) await engineUninstall(ext.pkg);
    const restore = async () => {
      await engineUninstall(ext.pkg).catch(() => {});
      if (prevBytes) await upload(ext.pkg, prevBytes, prev.version).catch(() => {});
      await fsp.rm(apkFile(ext.pkg, sha), { force: true }).catch(() => {});
    };
    try {
      await upload(ext.pkg, bytes, ext.version);
      const ids = await engineSourceIds(ext.pkg);
      if (!visible.some((s) => ids.includes(s.id))) throw arabic(`${ext.name}: الحزمة لا تحوي المصادر التي أعلنها المستودع`);
      if (auto) await preflight(visible[0].id);
    } catch (error) {
      await restore();
      throw error;
    }
    loadedIn.set(ext.pkg, (await runtime.start()).base);
    const record = {
      pkg: ext.pkg, repo: repo.url, name: ext.name, version: ext.version, versionCode: ext.versionCode, lib: ext.lib, lang: ext.lang,
      nsfw: ext.nsfw, iconUrl: ext.iconUrl ?? null, sha256: sha, sources: visible.map(({ id, name, lang }) => ({ id, name, lang })),
      enabled: prev?.enabled !== false,
      previous: prev ? { version: prev.version, versionCode: prev.versionCode, lib: prev.lib, sha256: prev.sha256, sources: prev.sources } : null,
    };
    const fresh = await load();
    await save({ ...fresh, extensions: [...fresh.extensions.filter((x) => x.pkg !== ext.pkg), record] });
    await prune(ext.pkg, [record.sha256, record.previous?.sha256].filter(Boolean));
    changed();
    return record;
  }
  async function prune(pkg, keep) {
    for (const name of await fsp.readdir(apkDir).catch(() => [])) {
      if (name.startsWith(`${pkg}-`) && !keep.some((sha) => name === `${pkg}-${sha.slice(0, 16)}.apk`)) await fsp.rm(path.join(apkDir, name), { force: true }).catch(() => {});
    }
  }
  /** فحص تشغيل حقيقي قبل اعتماد تحديث تلقائي: صفحة الرائج الأولى. */
  async function preflight(source) {
    const out = await fetchPage(source, 'POPULAR', 1);
    if (!Array.isArray(out.mangas)) throw arabic('الإصدار الجديد لم يعمل في الفحص');
  }

  const installExtension = ({ repo: repoUrl, pkg } = {}) => exclusive(async () => {
    if (typeof pkg !== 'string' || !repoLib.PKG.test(pkg)) throw arabic('الإضافة مطلوبة');
    const st = await load();
    const repo = st.repos.find((r) => r.url === repoLib.base(repoUrl));
    if (!repo) throw arabic('أضف المستودع أولًا');
    const ext = (await client.readTrusted(repo)).find((x) => x.pkg === pkg);
    if (!ext) throw arabic('الإضافة لم تعد في المستودع');
    const record = await stageAndCommit(st, repo, ext);
    const fresh = await load();
    if (fresh.updates?.[pkg]?.held) await save({ ...fresh, updates: { ...fresh.updates, [pkg]: { ...fresh.updates[pkg], held: null } } });
    return { pkg: record.pkg, version: record.version, sources: record.sources.map((s) => `${record.pkg}#${s.id}`) };
  });

  const enableExtension = ({ pkg, enabled } = {}) => exclusive(async () => {
    const st = await load();
    if (!st.extensions.some((x) => x.pkg === pkg)) throw arabic('الإضافة غير مثبتة');
    if (typeof enabled !== 'boolean') throw arabic('حالة التفعيل مطلوبة');
    await save({ ...st, extensions: st.extensions.map((x) => x.pkg === pkg ? { ...x, enabled } : x) });
    changed();
    return { ok: true };
  });

  const uninstallExtension = ({ pkg } = {}) => exclusive(async () => {
    const st = await load();
    if (!st.extensions.some((x) => x.pkg === pkg)) return;
    if (runtime.installed()) await engineUninstall(pkg);
    const fresh = await load();
    await save({ ...fresh, extensions: fresh.extensions.filter((x) => x.pkg !== pkg) });
    await prune(pkg, []);
    changed();
  });

  const rollbackExtension = ({ pkg } = {}) => exclusive(async () => {
    const st = await load();
    const current = st.extensions.find((x) => x.pkg === pkg);
    if (!current) throw arabic('الإضافة غير مثبتة');
    const prev = current.previous;
    if (!prev) throw arabic('لا إصدار سابق محفوظ لهذه الإضافة');
    const bytes = await fsp.readFile(apkFile(pkg, prev.sha256)).catch(() => null);
    if (!bytes || sha256(bytes) !== prev.sha256) throw arabic('نسخة الإصدار السابق لم تعد على الجهاز');
    await runtime.start();
    await engineUninstall(pkg);
    await upload(pkg, bytes, prev.version);
    loadedIn.set(pkg, (await runtime.start()).base);
    const back = { ...current, version: prev.version, versionCode: prev.versionCode, lib: prev.lib, sha256: prev.sha256, sources: prev.sources, previous: null };
    const fresh = await load();
    await save({ ...fresh, extensions: fresh.extensions.map((x) => (x.pkg === pkg ? back : x)), updates: { ...fresh.updates, [pkg]: { ...(fresh.updates?.[pkg] ?? {}), held: current.versionCode || null } } });
    await prune(pkg, [back.sha256, current.sha256]);
    changed();
    return { version: back.version, from: current.version };
  });

  async function updateState({ pkg } = {}) {
    const st = await load();
    const ext = st.extensions.find((x) => x.pkg === pkg);
    const log = st.updates?.[pkg] ?? {};
    return { installed: ext?.version ?? null, previous: ext?.previous?.version ?? null, held: log.held ?? null, lastAction: log.lastAction ?? null, lastVersion: log.lastVersion ?? null, lastCode: log.lastCode ?? null, lastAt: log.lastAt ?? null };
  }

  /**
   * التحديث التلقائي اليومي (قرار المالك 20 نوفمبر): لا يُعتمد إصدار إلا إن حمّله المحرك وعملت صفحة رائج حقيقية،
   * وإلا يبقى الحالي. يعمل فقط والمحرك شغّال (لا يُشغَّل المحرك من أجله)، ومرة كل 24 ساعة.
   */
  async function autoUpdate() {
    if (!runtime.state().running) return { checked: 0 };
    const st = await load();
    if (now() - (st.updates?.__lastRun ?? 0) < DAY) return { checked: 0 };
    let checked = 0;
    for (const repo of st.repos) {
      const list = await client.readTrusted(repo).catch(() => null);
      if (!list) continue;
      for (const mine of (await load()).extensions.filter((x) => x.repo === repo.url && x.enabled !== false)) {
        const ext = list.find((x) => x.pkg === mine.pkg);
        const log = (await load()).updates?.[mine.pkg] ?? {};
        if (!ext || ext.version === mine.version || !(ext.versionCode > mine.versionCode)) continue;
        if (log.held && ext.versionCode <= log.held) { await note(mine.pkg, 'SKIP_HELD', ext); continue; }
        checked += 1;
        await exclusive(async () => {
          try { await stageAndCommit(await load(), repo, ext, { auto: true }); await note(mine.pkg, 'APPLY', ext); }
          catch (error) { await note(mine.pkg, /لم يرد|timeout|Timeout|UnknownHost/i.test(String(error?.message)) ? 'SKIP_UNVERIFIED' : 'SKIP_REJECTED', ext); }
        });
      }
    }
    const fresh = await load();
    await save({ ...fresh, updates: { ...fresh.updates, __lastRun: now() } });
    return { checked };
  }
  async function note(pkg, action, ext) {
    const st = await load();
    await save({ ...st, updates: { ...st.updates, [pkg]: { ...(st.updates?.[pkg] ?? {}), lastAction: action, lastVersion: ext.version, lastCode: String(ext.versionCode || ''), lastAt: now() } } });
  }

  /** بيان المصادر من الحالة المحفوظة وحدها: لا يُشغَّل المحرك لمجرد عرض القائمة. */
  async function sources() {
    const st = await load();
    const running = runtime.state().running;
    const list = [];
    for (const ext of st.extensions) {
      const repo = st.repos.find((r) => r.url === ext.repo);
      for (const s of ext.sources) {
        list.push({
          id: `${ext.pkg}#${s.id}`, pkg: ext.pkg, label: s.name, lib: ext.lib, version: ext.version, warning: ext.nsfw ? 'MIXED' : 'SAFE',
          names: [s.name], lang: s.lang, filler: s.lang.toLowerCase() !== 'ar', user: true, repo: repo?.name ?? null, repoUrl: ext.repo,
          domain: null, enabled: ext.enabled !== false, ready: running && loadedIn.has(ext.pkg), engine: 'suwayomi', ...(ext.iconUrl ? { iconUrl: ext.iconUrl } : {}),
        });
      }
    }
    const said = recovered; recovered = false;
    return { sources: list, stateRecovered: said };
  }

  async function prepare({ sourceId } = {}) {
    await sourceOf(sourceId);
    return { ok: true };
  }

  const engineState = () => ({ ...runtime.state(), engine: 'suwayomi' });
  const enableEngine = async () => { await runtime.start(); return engineState(); };

  const METHODS = {
    sources, prepare, catalogue, popular: (a) => paged(a, 'POPULAR'), latest: (a) => paged(a, 'LATEST'), search: (a) => paged(a, 'SEARCH'),
    genre: async (a) => { await sourceOf(a?.sourceId); return { mangas: [], hasNextPage: false, page: Number(a?.page) || 1 }; },
    series, chapters, pages,
    image: async ({ page } = {}) => { if (!mediaPath(page?.imageUrl)) throw arabic('صفحة غير صالحة'); return { path: page.imageUrl, bytes: 0, cached: false }; },
    cover: async ({ url } = {}) => { if (!mediaPath(url)) throw arabic('غلاف غير صالح'); return { path: url }; },
    repos, addRepo, removeRepo, repoIndex, installExtension, uninstallExtension, enableExtension, rollbackExtension, updateState, engineState, enableEngine,
  };

  /** نقطة الدخول الوحيدة من الواجهة: دالة معروفة فقط. */
  async function call(method, args) {
    const fn = Object.hasOwn(METHODS, method) ? METHODS[method] : null;
    if (!fn) throw arabic('وظيفة المحرك غير متاحة', 'ENGINE_METHOD');
    return fn(args ?? {});
  }

  /**
   * تسخين بعد الإقلاع: من عنده إضافات Mihon يجد المحرك جاهزًا (إقلاع JVM يأخذ 20–40 ثانية)، فلا يتجاوز أول تصفح
   * مهلة الشاشة. لا يُنزّل المحرك ولا يشغّله لمن لا إضافات عنده.
   */
  async function warmUp() {
    if (!runtime.installed()) return false;
    const st = await load().catch(() => null);
    if (!st?.extensions?.some((x) => x.enabled !== false)) return false;
    await runtime.start({ quiet: true });
    return true;
  }

  return { call, media, autoUpdate, warmUp, isEngineSource, conversion: (pkg) => conversions.get(pkg) ?? null, METHODS: Object.keys(METHODS) };
}

module.exports = { createSuwayomiEngine, splitSourceId, isEngineSource, mediaPath, toManga, MEDIA };
