/**
 * المرحلة 3 من «صفر مصادر مدمجة» (docs/audits/ZERO_BUILTIN_MIGRATION_PLAN.md): قائمة الإضافات في حسابك.
 *
 * النموذج الهجين (قرار المالك 21 نوفمبر): الإضافات نفسها (الكود) على الجهاز دائمًا، تُنزَّل من مستودعها موقّعة؛ والحساب
 * يحفظ **القائمة** فقط، بياناتك أنت: روابط المستودعات التي أضفتها ومفاتيح توقيعها، وأسماء الإضافات التي ثبّتها.
 * الخادم لا يفتحها ولا يعرضها لأحد (صف `settings` لصاحبه وحده)، ولا يمر عبره أي كود أو محتوى.
 *
 *  - حقل لكل مستودع (`extrepo_<بصمة الرابط>`) ولكل إضافة (`extpkg_<بصمة الحزمة>`)، بقيمة {on, at}: الدمج على مستوى
 *    الحقل في الخادم لا يضيّع تغيير جهاز آخر، والأحدث (at) يغلب.
 *  - ما تفعله بيدك يُكتب فورًا (onLocalExtensionChange)، ويُحفظ في سجل محلي حتى يرجع من الخادم، فلا تعيد المزامنة
 *    تثبيت ما حذفته وأنت بلا شبكة.
 *  - جهاز يرى في حسابك إضافة غير مثبّتة عنده: يضيف مستودعها (بمفتاح التوقيع نفسه، وإلا يرفض) ويثبّتها. وحذف من جهاز
 *    يحذف من الباقي.
 *  - أول مرة لكل حساب على جهاز: ما عنده يُضاف للحساب (التبنّي). بعدها ما ليس في الحساب لا يُلمس ولا يُكتب.
 *  - فشل تثبيت لا يكرر بلا حد: يُعاد بعد مهلة.
 */

export const REPO_PREFIX = 'extrepo_';
export const EXT_PREFIX = 'extpkg_';
const LEDGER_KEY = 'vantara.extensionSync.v1';
const RETRY_MS = 10 * 60_000;
const PKG_RULE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

/** بصمة ثابتة قصيرة (FNV-1a 64) لاسم الحقل: الرابط واسم الحزمة قد يطولان أو يحويان رموزًا لا يقبلها مفتاح الحقل. */
export function fieldKey(prefix, value) {
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(String(value))) {
    h ^= BigInt(byte);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return prefix + h.toString(16).padStart(16, '0');
}

const httpsUrl = (url) => { try { return new URL(String(url)).protocol === 'https:'; } catch { return false; } };
const fresher = (a, b) => (!a ? b : !b ? a : Number(b.at) > Number(a.at) ? b : a);

/** قائمة الحساب من `settings.data` (نص JSON أو كائن). كل حقل يُتحقق من اسمه ومحتواه؛ الغريب يُتجاهل. */
export function readAccount(data) {
  let value = data;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = null; } }
  const repos = new Map(), exts = new Map();
  if (!value || typeof value !== 'object') return { repos, exts };
  for (const [key, rec] of Object.entries(value)) {
    if (!rec || typeof rec !== 'object' || typeof rec.on !== 'boolean' || !Number.isFinite(Number(rec.at))) continue;
    if (key.startsWith(REPO_PREFIX) && httpsUrl(rec.url) && fieldKey(REPO_PREFIX, rec.url) === key) repos.set(key, rec);
    else if (key.startsWith(EXT_PREFIX) && PKG_RULE.test(String(rec.pkg ?? '')) && fieldKey(EXT_PREFIX, rec.pkg) === key) exts.set(key, rec);
  }
  return { repos, exts };
}

/** حقل ما فعله المستخدم بيده: إضافة/إزالة مستودع، تثبيت/حذف إضافة. */
export function fieldFor(change, at) {
  if (change?.type === 'repo' && httpsUrl(change.url)) {
    return [fieldKey(REPO_PREFIX, change.url), { url: change.url, name: change.name ?? null, fingerprint: change.fingerprint ?? null, on: Boolean(change.on), at }];
  }
  if (change?.type === 'ext' && PKG_RULE.test(String(change.pkg ?? ''))) {
    return [fieldKey(EXT_PREFIX, change.pkg), { pkg: change.pkg, repo: change.repo ?? null, on: Boolean(change.on), at }];
  }
  return null;
}

/**
 * الخطة (دالة خالصة): ما يُكتب للحساب، وما يُضاف ويُثبَّت ويُحذف على هذا الجهاز.
 * `local`: { repos: [{url, name, fingerprint}], installed: [{pkg, repo}] } من المحرك.
 * `ledger`: ما كتبه هذا الجهاز ولم يرجع من الخادم بعد (يغلب الأقدم منه). `adopt`: أول مرة لهذا الحساب هنا.
 */
export function planSync({ account, ledger = {}, local, adopt = false, now = Date.now() }) {
  const push = {};
  const addRepos = [], removeRepos = [], installs = [], uninstalls = [];
  const localRepos = new Map((local?.repos ?? []).map((r) => [String(r.url), r]));
  const installed = new Map((local?.installed ?? []).map((x) => [String(x.pkg), x]));
  const effective = (map, prefix) => {
    const out = new Map(map);
    for (const [key, rec] of Object.entries(ledger)) if (key.startsWith(prefix)) out.set(key, fresher(out.get(key), rec));
    return out;
  };
  const repos = effective(account.repos, REPO_PREFIX);
  const exts = effective(account.exts, EXT_PREFIX);

  for (const rec of repos.values()) {
    const here = localRepos.has(String(rec.url));
    if (rec.on && !here) addRepos.push({ url: rec.url, fingerprint: rec.fingerprint ?? null });
    if (!rec.on && here) removeRepos.push(rec.url);
  }
  for (const rec of exts.values()) {
    const here = installed.has(String(rec.pkg));
    if (rec.on && !here && rec.repo) installs.push({ pkg: rec.pkg, repo: rec.repo });
    if (!rec.on && here) uninstalls.push(rec.pkg);
  }
  if (adopt) {
    for (const r of localRepos.values()) {
      const key = fieldKey(REPO_PREFIX, r.url);
      if (!repos.has(key) && httpsUrl(r.url)) push[key] = { url: r.url, name: r.name ?? null, fingerprint: r.fingerprint ?? null, on: true, at: now };
    }
    for (const x of installed.values()) {
      const key = fieldKey(EXT_PREFIX, x.pkg);
      if (!exts.has(key) && PKG_RULE.test(String(x.pkg))) push[key] = { pkg: x.pkg, repo: x.repo ?? null, on: true, at: now };
    }
  }
  return { push, addRepos, removeRepos, installs, uninstalls };
}

/**
 * المشغّل: يقرأ حسابك من المزامنة، ويطبّق الخطة على المحرك. `target` من المحرك (`syncTarget` في extension-engine.js):
 * نداءاته لا تمر بـonLocalExtensionChange، فما تطبّقه المزامنة لا يُكتب من جديد.
 */
export function startExtensionSync({ sync, target, storage = globalThis.localStorage, now = () => Date.now(), retryMs = RETRY_MS } = {}) {
  if (!sync || !target) return null;
  // المحرك يُسأل عند كل جولة: جسر ويندوز أو الجوال قد يجهز بعد بدء الواجهة
  const engineTarget = () => (typeof target === 'function' ? target() : target);
  const owner = () => sync.user?.userId ?? null;
  const readLedger = () => { try { return JSON.parse(storage?.getItem(LEDGER_KEY) ?? '{}') ?? {}; } catch { return {}; } };
  const writeLedger = (all) => { try { storage?.setItem(LEDGER_KEY, JSON.stringify(all)); } catch { /* تخزين ممتلئ: السجل في الذاكرة يكفي للجلسة */ } };
  const failedAt = new Map();
  let running = null, again = false, stopped = false;

  async function write(user, fields) {
    if (!Object.keys(fields).length) return;
    const all = readLedger();
    const mine = all[user] ?? { adopted: false, fields: {} };
    mine.fields = { ...mine.fields, ...fields };
    all[user] = mine;
    writeLedger(all);
    await sync.enqueue('settings.patch', { fields }, { requireDurable: true });
  }

  /** ما فعلته بيدك: يُكتب لحسابك فورًا. */
  async function onLocal(change) {
    const user = owner();
    if (!user || stopped) return;
    const field = fieldFor(change, now());
    if (field) await write(user, { [field[0]]: field[1] }).catch(() => {});
  }

  async function pass() {
    const user = owner();
    if (!user || stopped) return null;
    const account = readAccount(sync.row('settings', user)?.data ?? null);
    const all = readLedger();
    const mine = all[user] ?? { adopted: false, fields: {} };
    // ما رجع من الخادم بقيمة لا تقل حداثة يخرج من السجل
    for (const [key, rec] of Object.entries(mine.fields)) {
      const back = account.repos.get(key) ?? account.exts.get(key);
      if (back && Number(back.at) >= Number(rec.at)) delete mine.fields[key];
    }
    all[user] = mine;
    writeLedger(all);
    const t = engineTarget();
    if (!t) return null;
    const state = await t.list();
    const local = {
      repos: (state?.repos ?? []).map((r) => ({ url: r.url, name: r.name, fingerprint: r.fingerprint ?? null })),
      installed: (state?.installed ?? []).map((x) => ({ pkg: x.pkg, repo: x.repo ?? null })),
    };
    const plan = planSync({ account, ledger: mine.fields, local, adopt: !mine.adopted, now: now() });
    await write(user, plan.push);
    if (!mine.adopted) { const latest = readLedger(); latest[user] = { ...(latest[user] ?? { fields: {} }), adopted: true }; writeLedger(latest); }
    // لم يفشل قط = مستحق الآن؛ فشل = بعد المهلة من فشله فقط
    const due = (key) => !failedAt.has(key) || failedAt.get(key) + retryMs <= now();
    const attempt = async (key, fn) => {
      if (!due(key) || owner() !== user || stopped) return;
      try { await fn(); failedAt.delete(key); } catch { failedAt.set(key, now()); }
    };
    for (const r of plan.addRepos) await attempt(`repo:${r.url}`, () => t.addRepo(r));
    for (const x of plan.installs) await attempt(`ext:${x.pkg}`, () => t.install(x));
    for (const pkg of plan.uninstalls) await attempt(`del:${pkg}`, () => t.uninstall({ pkg }));
    for (const url of plan.removeRepos) await attempt(`unrepo:${url}`, () => t.removeRepo({ url }));
    return plan;
  }

  /** مطابقة جهازك بحسابك: عند الإقلاع وعند كل تغيّر في الحساب. نداء واحد في كل مرة، والمتأخر يُجمع في جولة تالية. */
  function reconcile() {
    if (running) { again = true; return running; }
    running = pass().catch(() => null).finally(() => {
      running = null;
      if (again && !stopped) { again = false; void reconcile(); }
    });
    return running;
  }

  return { reconcile, onLocal, stop: () => { stopped = true; } };
}
