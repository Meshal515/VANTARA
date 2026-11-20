/**
 * «إضافاتي» في ملف واحد ينتقل بين أجهزتك ومنصاتك (طلب المالك، 20 نوفمبر 2026).
 *
 * الملف يحمل **مراجع لا كودًا**: روابط المستودعات، وحزم الإضافات المثبتة بإصداراتها، وروابط إضافات الويب (Stremio:
 * إعداداتها داخل رابطها نفسه)، ومواقع المانجا المضافة، وحالة كل إضافة (مفعّلة، مثبّتة أعلى). الاستيراد يعرض كل عنصر
 * بحالته على هذا الجهاز وزر «تثبيت»؛ التثبيت يمر بالطريق المعتاد نفسه (توقيع المستودع وبصمة الحزمة وتحميل تجريبي)،
 * فالملف لا يفتح بابًا لكود غير موثّق. عنصر لا يعمل على هذه المنصة (Mihon على الويب) يظهر بوضوح ولا يُحذف من الملف.
 *
 * لا أسرار في الملف: لا كوكيز ولا جلسات ولا رموز دخول للحساب.
 */

export const FORMAT = 'vantara.extensions';
export const VERSION = 1;
const MAX_BYTES = 1024 * 1024;
const MAX_ITEMS = 2000;

/** المجموعات الأصلية (APK) بأسمائها المعروضة. */
export const GROUPS = Object.freeze({
  manga: 'إضافات المانجا (Mihon)',
  anime: 'إضافات الأنمي (Aniyomi)',
  cloudstream: 'إضافات CloudStream',
});

const https = (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; } };
const text = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : v == null ? null : String(v).slice(0, max));
const PKG = /^[A-Za-z][\w]*(\.[\w-]+)+$/;
/** رابط موقع مانجا من صفه: `url`/`baseUrl`، أو `domain` (شكل قائمة المواقع الفعلي). */
const siteUrl = (s) => https(s?.url ?? s?.baseUrl ?? (typeof s?.domain === 'string' && /^[\w.-]+$/.test(s.domain) ? `https://${s.domain}/` : null));

/**
 * يجمع إضافات هذا الجهاز. `stores` بشكل مدير الإضافات: `[{ id: 'manga'|'anime'|'cloudstream', api }]` حيث
 * `api.list()` يعيد `{ repos, installed }`. `registry` سجل إضافات الويب، و`sites` مواقع المانجا (أيها غائب يُتجاهل).
 */
export async function collectExtensions({ stores = [], registry = null, sites = null, platform = 'unknown', now = Date.now } = {}) {
  const doc = { format: FORMAT, version: VERSION, exportedAt: now(), platform, native: {}, addons: [], sites: [] };
  for (const store of stores) {
    if (!GROUPS[store?.id] || doc.native[store.id]) continue;
    let state = null;
    try { state = await store.api.list(); } catch { continue; }
    doc.native[store.id] = {
      repos: (state?.repos ?? []).map((r) => ({ url: https(r.url), name: text(r.name) })).filter((r) => r.url),
      extensions: (state?.installed ?? []).filter((x) => x?.pkg && PKG.test(x.pkg)).map((x) => ({
        pkg: x.pkg, name: text(x.name), version: text(x.version ?? x.versionName, 40), repo: https(x.repo ?? x.repoUrl),
        ...(x.content ? { content: text(x.content, 20) } : {}), ...(x.enabled === false ? { enabled: false } : {}),
      })),
    };
  }
  for (const a of registry?.list?.() ?? []) {
    if (a?.bundled) continue;
    const url = https(a.url ?? a.manifestUrl ?? a.transportUrl);
    if (!url) continue;
    doc.addons.push({ url, name: text(a.manifest?.name ?? a.name), ...(a.enabled === false ? { enabled: false } : {}), ...(a.pinned ? { pinned: true } : {}) });
  }
  try {
    for (const s of (await sites?.list?.()) ?? []) { const url = siteUrl(s); if (url) doc.sites.push({ url, name: text(s.name ?? s.label) }); }
  } catch { /* مواقع غير متاحة: لا شيء */ }
  return doc;
}

/** نص الملف بشكل مقروء. */
export const serialize = (doc) => JSON.stringify(doc, null, 2);

/** يقرأ الملف ويتحقق منه بصرامة. يرمي برسالة عربية واضحة. */
export function parseExtensions(raw) {
  const str = String(raw ?? '');
  if (str.length > MAX_BYTES) throw new Error('الملف أكبر من 1MB؛ ليس ملف إضافات فانتارا');
  let doc;
  try { doc = JSON.parse(str); } catch { throw new Error('الملف ليس JSON صالحًا'); }
  if (doc?.format !== FORMAT) throw new Error('هذا ليس ملف «إضافاتي» من فانتارا');
  if (!Number.isInteger(doc.version) || doc.version > VERSION) throw new Error('الملف من إصدار أحدث من فانتارا؛ حدّث التطبيق ثم أعد المحاولة');
  const out = { format: FORMAT, version: doc.version, exportedAt: Number(doc.exportedAt) || null, platform: text(doc.platform, 20), native: {}, addons: [], sites: [] };
  let count = 0;
  for (const id of Object.keys(GROUPS)) {
    const g = doc.native?.[id];
    if (!g) continue;
    const repos = (Array.isArray(g.repos) ? g.repos : []).map((r) => ({ url: https(r?.url), name: text(r?.name) })).filter((r) => r.url);
    const extensions = (Array.isArray(g.extensions) ? g.extensions : []).filter((x) => typeof x?.pkg === 'string' && PKG.test(x.pkg)).map((x) => ({
      pkg: x.pkg, name: text(x.name) ?? x.pkg, version: text(x.version, 40), repo: https(x.repo),
      ...(x.content ? { content: text(x.content, 20) } : {}), ...(x.enabled === false ? { enabled: false } : {}),
    }));
    count += repos.length + extensions.length;
    out.native[id] = { repos, extensions };
  }
  out.addons = (Array.isArray(doc.addons) ? doc.addons : []).map((a) => ({ url: https(a?.url), name: text(a?.name), ...(a?.enabled === false ? { enabled: false } : {}), ...(a?.pinned ? { pinned: true } : {}) })).filter((a) => a.url);
  out.sites = (Array.isArray(doc.sites) ? doc.sites : []).map((s) => ({ url: https(s?.url), name: text(s?.name) })).filter((s) => s.url);
  count += out.addons.length + out.sites.length;
  if (count > MAX_ITEMS) throw new Error('الملف يحوي عناصر أكثر من المسموح');
  if (!count) throw new Error('الملف لا يحوي إضافات');
  return out;
}

/**
 * خطة الاستيراد على هذا الجهاز: كل عنصر بحالته.
 *  - `installed`: موجود هنا أصلًا.
 *  - `ready`: يُثبَّت بضغطة.
 *  - `unavailable`: لا يعمل على هذه المنصة (يبقى في الملف)، مع السبب.
 * المستودعات لا تُعرض عناصر مستقلة: تُضاف تلقائيًا عند تثبيت أول إضافة منها، بعد موافقة واحدة على الثقة.
 */
export async function planImport(doc, { stores = [], registry = null, sites = null } = {}) {
  const items = [];
  for (const [id, g] of Object.entries(doc.native)) {
    const store = stores.find((s) => s.id === id);
    let installed = new Set();
    if (store) { try { installed = new Set(((await store.api.list())?.installed ?? []).map((x) => x.pkg)); } catch { /* يُعامل كغير مثبت */ } }
    for (const ext of g.extensions) {
      const repo = ext.repo ?? g.repos[0]?.url ?? null;
      items.push({
        kind: 'native', group: id, key: `${id}:${ext.pkg}`, name: ext.name, version: ext.version, pkg: ext.pkg, repo, content: ext.content ?? null, enabled: ext.enabled !== false,
        status: !store ? 'unavailable' : installed.has(ext.pkg) ? 'installed' : repo ? 'ready' : 'unavailable',
        reason: !store ? 'تعمل في تطبيق الجوال' : !repo ? 'مستودعها غير معروف في الملف' : null,
      });
    }
  }
  const have = new Set((registry?.list?.() ?? []).map((a) => https(a.url ?? a.manifestUrl ?? a.transportUrl)).filter(Boolean));
  for (const a of doc.addons) {
    items.push({ kind: 'addon', group: 'addons', key: `addon:${a.url}`, name: a.name ?? new URL(a.url).hostname, url: a.url, enabled: a.enabled !== false, pinned: Boolean(a.pinned),
      status: !registry?.inspect ? 'unavailable' : have.has(a.url) ? 'installed' : 'ready', reason: !registry?.inspect ? 'غير مدعومة هنا' : null });
  }
  let siteUrls = new Set();
  if (sites) { try { siteUrls = new Set(((await sites.list()) ?? []).map(siteUrl).filter(Boolean)); } catch { /* */ } }
  for (const s of doc.sites) {
    items.push({ kind: 'site', group: 'sites', key: `site:${s.url}`, name: s.name ?? new URL(s.url).hostname, url: s.url,
      status: !sites ? 'unavailable' : siteUrls.has(s.url) ? 'installed' : 'ready', reason: !sites ? 'مواقع المانجا تعمل في الويب وويندوز' : null });
  }
  return items;
}

/**
 * يثبّت عنصرًا من الخطة بالطريق المعتاد. المستودع يُضاف أولًا إن لم يكن مضافًا (المستدعي أخذ موافقة الثقة).
 * يعيد العنصر بحالته الجديدة؛ الفشل يعيد `failed` بسبب واضح ولا يوقف بقية العناصر.
 */
export async function installItem(item, { stores = [], registry = null, sites = null } = {}) {
  try {
    if (item.kind === 'native') {
      const store = stores.find((s) => s.id === item.group);
      if (!store) return { ...item, status: 'unavailable' };
      const state = await store.api.list().catch(() => null);
      if (!(state?.repos ?? []).some((r) => https(r.url) === item.repo)) await store.api.add(item.repo);
      await store.api.install(item.repo, item.pkg, ...(item.group === 'anime' || item.group === 'cloudstream' ? [item.content ?? undefined] : []));
      if (item.enabled === false && typeof store.api.enable === 'function') await store.api.enable(item.pkg, false).catch(() => {});
      return { ...item, status: 'installed', error: null };
    }
    if (item.kind === 'addon') {
      const preview = await registry.inspect(item.url);
      const added = await registry.install(preview);
      const key = added?.key ?? preview?.key ?? null;
      if (key && item.enabled === false) await registry.enable?.(key, false);
      if (key && item.pinned) await registry.pin?.(key, true);
      return { ...item, status: 'installed', error: null };
    }
    if (item.kind === 'site') {
      await sites.add(item.url);
      return { ...item, status: 'installed', error: null };
    }
    return { ...item, status: 'failed', error: 'نوع غير معروف' };
  } catch (error) {
    return { ...item, status: 'failed', error: String(error?.message ?? error ?? 'تعذّر التثبيت').replace(/(?:https?:\/\/)\S+/gi, '[رابط]').slice(0, 160) };
  }
}

/** اسم ملف بتاريخ اليوم. */
export const fileName = (now = Date.now()) => `vantara-extensions-${new Date(now).toISOString().slice(0, 10)}.json`;
