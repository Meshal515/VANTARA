'use strict';
// مستودعات إضافات المانجا (صيغة Mihon/Keiyoushi) في ويندوز: نقل حرفي لقواعد الـAPK (UserExtensions.kt: RepoIndex
// وRepoClient) حتى يتصرف المستودع نفسه بالطريقة نفسها في المنصتين: الرابط الأساسي نفسه، ومفتاح التوقيع إلزامي،
// وindex.pb (v2) أولًا ثم index.min.json (v1)، واختيار المصادر الظاهرة نفسه (العربي أولًا، UE1).
const zlib = require('node:zlib');

const SHA256 = /^[0-9a-f]{64}$/;
const PKG = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const APK_NAME = /^[A-Za-z0-9._-]+\.apk$/;
const MAX_ENTRIES = 5000;

const fail = (message) => { throw new Error(message); };

/** github.com/<o>/<r>/raw/[refs/heads/]<path> ← raw.githubusercontent.com (كما في الـAPK). */
function githubRaw(u) {
  const m = u.hostname.toLowerCase() === 'github.com' ? /^\/([^/]+)\/([^/]+)\/raw\/(?:refs\/heads\/)?(.+)$/.exec(u.pathname) : null;
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : null;
}

/** الرابط الأساسي للمستودع: HTTPS عادي بلا استعلام، بلا اسم ملف الفهرس. */
function base(input) {
  const raw = String(input ?? '').trim().replace(/\/+$/, '');
  let u;
  try { u = new URL(raw); } catch { fail('رابط المستودع غير صالح'); }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password || u.port) fail('المستودع يحتاج رابط HTTPS عاديًا');
  if (u.search || u.hash || /[?#]/.test(raw)) fail('رابط المستودع لا يحمل استعلامًا');
  const canonical = githubRaw(u) ?? raw;
  return canonical.replace(/\/(index\.min\.json|index\.json|index\.pb|repo\.json)$/i, '');
}

/** رابط صورة عام: نسبي يُحل على جذر المستودع، وHTTPS فقط. */
function iconUrl(raw, root = null) {
  try {
    if (!raw || String(raw).length > 2048) return null;
    const u = root ? new URL(String(raw).trim(), `${base(root)}/`) : new URL(String(raw).trim());
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) return null;
    const rawGh = u.hostname === 'raw.githubusercontent.com' ? /^\/([^/]+)\/([^/]+)\/refs\/heads\/(.+)$/.exec(u.pathname) : null;
    const fixed = githubRaw(u) ?? (rawGh ? `https://raw.githubusercontent.com/${rawGh[1]}/${rawGh[2]}/${rawGh[3]}` : null);
    return fixed ? fixed + u.search : u.href;
  } catch { return null; }
}

const legacyIconUrl = (root, pkg) => (PKG.test(pkg) ? iconUrl(`icon/${pkg}.png`, root) : null);
const declaredIcon = (o, root) => ['iconUrl', 'logo', 'icon'].map((k) => (typeof o?.[k] === 'string' ? iconUrl(o[k], root) : null)).find(Boolean) ?? null;

function fingerprintOf(value) {
  const fp = typeof value === 'string' ? value.toLowerCase().replace(/:/g, '') : null;
  if (!fp || !SHA256.test(fp)) fail('المستودع لا يعلن مفتاح توقيع؛ لا نشغّل كودًا بلا توقيع معروف');
  return fp;
}

function parseMeta(text, root = null) {
  let doc;
  try { doc = JSON.parse(text); } catch { fail('repo.json ليس JSON صالحًا'); }
  const meta = doc?.meta;
  if (!meta || typeof meta !== 'object') fail('repo.json بلا meta');
  const name = typeof meta.name === 'string' ? meta.name.slice(0, 80).trim() : '';
  if (!name) fail('المستودع بلا اسم');
  return { name, fingerprint: fingerprintOf(meta.signingKeyFingerprint), iconUrl: declaredIcon(meta, root) };
}

/** رابط index.pb إن أعلنه repo.json (HTTPS فقط، وgithub.com/raw يُوحَّد إلى raw.githubusercontent.com). */
function indexV2(repoJson) {
  try {
    const url = JSON.parse(repoJson)?.index_v2;
    if (typeof url !== 'string') return null;
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return githubRaw(u) ?? u.href;
  } catch { return null; }
}

const libOf = (version) => { const n = Number(String(version).split('.').slice(0, 2).join('.')); return Number.isFinite(n) && String(version).includes('.') ? n : null; };

function parseIndex(text, root) {
  let list;
  try { list = JSON.parse(text); } catch { fail('index.min.json ليس JSON صالحًا'); }
  if (!Array.isArray(list)) fail('index.min.json ليس قائمة');
  if (list.length > MAX_ENTRIES) fail('المستودع أكبر من الحد');
  const out = [];
  for (const o of list) {
    if (!o || typeof o !== 'object') continue;
    const pkg = typeof o.pkg === 'string' && PKG.test(o.pkg) ? o.pkg : null;
    const apk = typeof o.apk === 'string' && APK_NAME.test(o.apk) ? o.apk : null;
    const version = typeof o.version === 'string' ? o.version : null;
    const lib = version ? libOf(version) : null;
    if (!pkg || !apk || !version || lib == null) continue;
    const sources = (Array.isArray(o.sources) ? o.sources : []).filter((s) => s && s.id != null).map((s) => ({
      id: String(s.id), name: typeof s.name === 'string' ? s.name : pkg, lang: typeof s.lang === 'string' ? s.lang : '', baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
    }));
    out.push({
      name: String(o.name ?? pkg).replace(/^Tachiyomi: /, '').replace(/^Aniyomi: /, ''), pkg, apkUrl: `${root}/apk/${apk}`,
      lang: typeof o.lang === 'string' ? o.lang : '', version, lib, nsfw: Number(o.nsfw) === 1, sources,
      iconUrl: declaredIcon(o, root) ?? legacyIconUrl(root, pkg), versionCode: Number.isSafeInteger(o.code) && o.code > 0 ? o.code : 0,
    });
  }
  return out;
}

/** قارئ protobuf صغير: varint ونصوص/رسائل فقط (ما يحتاجه الفهرس)، كقارئ الـAPK. */
function pbFields(buf) {
  const map = new Map();
  let i = 0;
  const varint = () => {
    let r = 0n, shift = 0n;
    for (;;) {
      if (i >= buf.length || shift >= 64n) fail('فهرس تالف');
      const c = buf[i++];
      r |= BigInt(c & 0x7f) << shift;
      if (c < 0x80) return r;
      shift += 7n;
    }
  };
  const put = (f, v) => { if (!map.has(f)) map.set(f, []); map.get(f).push(v); };
  while (i < buf.length) {
    const key = varint();
    const field = Number(key >> 3n);
    switch (Number(key & 7n)) {
      case 0: put(field, varint()); break;
      case 2: {
        const len = Number(varint());
        if (len < 0 || i + len > buf.length) fail('فهرس تالف');
        put(field, buf.subarray(i, i + len)); i += len; break;
      }
      case 1: i += 8; break;
      case 5: i += 4; break;
      default: fail('فهرس تالف');
    }
  }
  const all = (f) => (map.get(f) ?? []).filter((v) => Buffer.isBuffer(v));
  return {
    has: (f) => map.has(f), all, bytes: (f) => all(f)[0] ?? null,
    text: (f) => { const b = all(f)[0]; return b ? b.toString('utf8') : null; },
    varint: (f) => (map.get(f) ?? []).find((v) => typeof v === 'bigint') ?? null,
  };
}

const unpack = (raw) => (raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw, { maxOutputLength: 32 * 1024 * 1024 }) : raw);

function entries(list, root) {
  if (list.length > MAX_ENTRIES) fail('المستودع أكبر من الحد');
  const out = [];
  for (const entry of list) {
    const e = pbFields(entry);
    const pkg = e.text(2);
    if (!pkg || !PKG.test(pkg)) continue;
    const assetsRaw = e.bytes(3);
    if (!assetsRaw) continue;
    const assets = pbFields(assetsRaw);
    const apkUrl = assets.text(1);
    if (!apkUrl?.startsWith('https://')) continue;
    const version = e.text(6);
    if (!version) continue;
    const lib = Number(e.text(4)) || libOf(version);
    if (!lib) continue;
    const sourceField = pkg.includes('.animeextension.') && e.has(9) ? 9 : 8;
    const declared = e.all(sourceField);
    const parsed = declared.map((b) => {
      const s = pbFields(b);
      const id = s.varint(1);
      const name = s.text(2), lang = s.text(3);
      return id && id !== 0n && name?.trim() && lang?.trim() ? { id: BigInt.asIntN(64, id).toString(), name, lang, baseUrl: s.text(4) ?? '' } : null;
    }).filter(Boolean);
    const sources = parsed.length === declared.length && new Set(parsed.map((s) => s.id)).size === parsed.length ? parsed : [];
    const langs = [...new Set(sources.map((s) => s.lang))];
    const code = e.varint(5);
    out.push({
      name: e.text(1) ?? pkg, pkg, apkUrl, lang: langs.length === 1 ? langs[0] : 'all', version, lib,
      nsfw: e.varint(7) === 3n, sources, iconUrl: iconUrl(assets.text(2), root),
      versionCode: code && code > 0n && code <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(code) : 0,
    });
  }
  return out;
}

/** index.pb: Index { 1 name, 3 signingKeyFingerprint, 101 { 1 Extension... }, 102 extensionListUrl }. */
function parseIndexV2(raw, root = null) {
  const top = pbFields(unpack(raw));
  const name = top.text(1)?.slice(0, 80).trim();
  if (!name) fail('فهرس المستودع بلا اسم');
  const fingerprint = fingerprintOf(top.text(3));
  const listUrl = top.text(102)?.startsWith('https://') ? top.text(102) : null;
  return { meta: { name, fingerprint, extensionListUrl: listUrl }, list: entries(top.all(101).flatMap((b) => pbFields(b).all(1)), root) };
}

const parseExtensionList = (raw, root = null) => entries(pbFields(unpack(raw)).all(1), root);

/**
 * المصادر الظاهرة: العربية إن وُجدت، وإلا لغة الإضافة، وإلا الإنجليزية، وإلا أصغر رمز لغة (اختيار ثابت، UE1).
 */
function visibleSources(ext) {
  const by = (lang) => ext.sources.filter((s) => s.lang.toLowerCase() === String(lang).toLowerCase());
  const ar = by('ar'); if (ar.length) return ar;
  const own = by(ext.lang); if (own.length) return own;
  const en = by('en'); if (en.length) return en;
  const first = [...ext.sources].sort((a, b) => `${a.lang.toLowerCase()}|${a.id}`.localeCompare(`${b.lang.toLowerCase()}|${b.id}`))[0];
  return first ? [first] : [];
}

function fillMissingSourcesFromLegacy(v2, legacy) {
  const byPkg = new Map();
  for (const x of legacy) byPkg.set(x.pkg, [...(byPkg.get(x.pkg) ?? []), x]);
  return v2.map((current) => {
    if (current.sources.length) return current;
    const list = byPkg.get(current.pkg);
    const old = list?.length === 1 ? list[0] : null;
    if (!old || old.version !== current.version || !old.sources.length) return current;
    if (old.versionCode && current.versionCode && old.versionCode !== current.versionCode) return current;
    const ids = old.sources.map((s) => s.id);
    if (new Set(ids).size !== ids.length || ids.some((id) => !/^-?\d+$/.test(id)) || old.sources.some((s) => !s.name.trim() || !s.lang.trim())) return current;
    return { ...current, sources: old.sources };
  });
}

/**
 * عميل المستودع: `fetchBytes(url, limit)` يُحقن (طلبات العملية الرئيسية في Electron). repo.json ثم فهرسه.
 */
function createRepoClient({ fetchBytes }) {
  const text = async (url) => (await fetchBytes(url, 8 * 1024 * 1024)).toString('utf8');
  async function read(root) {
    const repoJson = await text(`${root}/repo.json`);
    const declared = parseMeta(repoJson, root);
    const v2 = indexV2(repoJson);
    if (v2) {
      const { meta, list } = parseIndexV2(await fetchBytes(v2, 16 * 1024 * 1024), root);
      if (declared.fingerprint !== meta.fingerprint) fail('مفتاح التوقيع في repo.json لا يطابق الفهرس');
      const all = !list.length && meta.extensionListUrl ? parseExtensionList(await fetchBytes(meta.extensionListUrl, 16 * 1024 * 1024), root) : list;
      return { meta: declared, list: all };
    }
    return { meta: declared, list: parseIndex(await text(`${root}/index.min.json`), root) };
  }
  async function readTrusted(repo) {
    const { meta, list } = await read(repo.url);
    if (meta.fingerprint !== repo.fingerprint) fail('مفتاح توقيع المستودع تغيّر منذ أضفته؛ أزله وأضفه من جديد إن كنت تثق به');
    return list;
  }
  return { read, readTrusted };
}

module.exports = { base, iconUrl, legacyIconUrl, parseMeta, indexV2, parseIndex, parseIndexV2, parseExtensionList, visibleSources, fillMissingSourcesFromLegacy, createRepoClient, PKG };
