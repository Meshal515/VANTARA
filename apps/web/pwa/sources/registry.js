/**
 * سجلّ مصادر الويب: Stable / Candidate / Last Known Good، فوق Plugin Vault محلي.
 *
 * التعريفات تصل مع حزمة الواجهة (defs.json). وتعريف جديد لا يُعتمد بالثقة:
 *
 *   أول مرة نرى المصدر      ⇒ يُستعمل فورًا (stable، غير مُتحقَّق) ويُفحص في الخلفية.
 *   إصدار أعلى أو تعديل     ⇒ candidate؛ يبقى الـstable شغّالًا حتى ينجح فحص المرشح،
 *                              فيصير هو stable والقديم last known good.
 *   إصدار أقدم من المثبت    ⇒ يُرفض (DOWNGRADE_REFUSED). الرجوع المشروع الوحيد هو LKG المحلي.
 *   فشل فحص المرشح          ⇒ يبقى الـstable، والمرشح «فاشل» ويُعاد فحصه بعد 6 ساعات.
 *   الـstable يفشل مرارًا    ⇒ رجوع إلى last known good (rollback) إن وُجد.
 *   فشل متتالٍ              ⇒ تبريد قصير: البحث لا ينتظر مصدرًا ميتًا.
 *
 * الإضافة المثبتة مستقلة عن مستودعها (docs/addons/PERSISTENT_PLUGINS.md):
 *   - كل تعريف يُحفظ بعنوان محتواه sha256 في مخزن بلا كنس (lib/plugin-vault.js)، والحالة معه.
 *   - الحزمة لم تُقرأ (دون اتصال)      ⇒ كل مصدر مثبت يعمل من نسخته المحلية، ولا يُحذف شيء.
 *   - مصدر مانجا غاب من الحزمة          ⇒ يبقى ويعمل، ويُعلَّم «لم يعد في مستودعه».
 *   - معرّفه تغيّر (تطابق وحيد بالاسم واللغة) ⇒ يُرحَّل: المعرّف القديم يصل للجديد، فالمكتبة لا تنقطع.
 *     التطابق الغامض لا يُرحَّل.
 *   - معرّف مكرر أو محجوز أو يملكه مصدر آخر ⇒ يُرفض (ID_COLLISION) ولا يحلّ مصدر محلّ آخر.
 *
 * الفحص (probe): بحث بكلمة التعريف ← تفاصيل أول نتيجة ← فصول ← صفحات أول فصل.
 */

import { checkListing, checkPages, checkSeries, defErrors } from './contract.js';
import { configVariants, siteDef, siteOrigin } from './detect.js';
import { createPluginVault } from '../../lib/plugin-vault.js';
import { describeFailure } from '../../lib/plugin-failure.js';

const LEGACY_KEY = 'registry:v1';
const STATE_KEY = 'sources:v2';
const RETRY_FAILED_MS = 6 * 60 * 60 * 1000;
const FAILS_TO_ROLLBACK = 4;
const FAILS_TO_COOL = 3;
const COOLDOWN_MS = 10 * 60 * 1000;
/** حد عدد التعريفات المقروءة من الحزمة، وحد سلسلة الترحيل (حماية من حلقة أو فهرس ضخم). */
const MAX_DEFS = 500;
const MAX_ALIAS_HOPS = 8;
/** معرّفات محجوزة لا يحملها مصدر: أسماء فارغة، ونطاقات معرّفات الإضافات (`addon|`، `core|`)، ورموز تحكم. */
const RESERVED = /^(?:0|null|undefined|none)$|^(?:addon|core)\||[\u0000-\u001f]/i;
/** أخطاء من الموقع أو الجهاز لا من التعريف: تبريد فقط، لا رجوع لنسخة سابقة. */
const NOT_STRUCTURAL = ['challenge', 'host_not_allowed', 'signed_out', 'aborted', 'timeout', 'network', 'HOST_COOLING'];

export const ID_COLLISION = 'ID_COLLISION';
export const DOWNGRADE_REFUSED = 'DOWNGRADE_REFUSED';
/** ما يُعرض للمستخدم عن مصدر لم يعد في حزمة التعريفات لكنه يعمل من نسخته المحلية. */
export const OUT_OF_REPOSITORY = 'لم يعد في مستودعه؛ يعمل من النسخة المحفوظة على جهازك';

/** هوية المطابقة لترحيل معرّف: النوع واللغة والاسم المطبّع. لا عنوان ولا رابط. */
const identityOf = (def) => `${def?.content}|${String(def?.lang ?? 'ar').toLowerCase()}|${String(def?.label ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')}`;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * @param {{ engines: Record<string, {create: Function, content: string}>, store: any, ctx: object,
 *           now?: () => number, log?: (msg: string) => void,
 *           durable?: { store: any, ns: string } }} deps
 *   `durable`: مخزن بلا كنس ولا انتهاء صلاحية لحالة السجل ونسخ التعريفات (Plugin Vault).
 *   بدونه تُستعمل مساحة `state` في `store` نفسه.
 */
export function createRegistry({ engines, store, ctx, now = () => Date.now(), log = () => {}, durable = null }) {
  const keep = durable ?? { store, ns: 'state' };
  const vault = createPluginVault({ store: keep.store, ns: keep.ns });
  /** @type {Record<string, any>} */
  let state = Object.create(null);
  /** معرّف قديم → معرّف جديد (ترحيل معتمد بتطابق وحيد). */
  let aliases = Object.create(null);
  /** كل بصمة كُتبت في المخزن، للكنس بعد أن تفقد آخر مرجع لها. */
  let blobs = new Set();
  const live = new Map(); // id → { def, source }
  /** أسباب عدم التشغيل الظاهرة للمستخدم (محرك غائب، حظر أمني). */
  const unavailable = new Map();
  let loaded = null;
  let writing = Promise.resolve();

  const engineNames = Object.keys(engines);
  const fresh = () => ({ ok: 0, fail: 0, streak: 0, lastOk: 0, lastError: null, coolUntil: 0 });

  /** الحالة على القرص بلا نص التعريفات: كل تعريف في المخزن ببصمته. */
  function persisted() {
    const slot = (x) => (x ? (({ def, ...rest }) => rest)(x) : x);
    const sources = {};
    for (const [id, rec] of Object.entries(state)) sources[id] = { ...rec, stable: slot(rec.stable), lkg: slot(rec.lkg), candidate: slot(rec.candidate) };
    return { v: 2, sources, aliases: { ...aliases }, blobs: [...blobs] };
  }

  /** الكتابات متسلسلة: الأحدث يصل القرص أخيرًا دائمًا. */
  function save() {
    const snapshot = persisted();
    writing = writing.then(() => keep.store.set(keep.ns, STATE_KEY, snapshot)).catch(() => {});
    return writing;
  }

  /** المعرّف الحالي لمعرّف قد يكون قديمًا (ترحيل). */
  function resolve(id) {
    let cur = String(id ?? '');
    for (let i = 0; i < MAX_ALIAS_HOPS && !own(state, cur) && own(aliases, cur); i += 1) cur = aliases[cur];
    return cur;
  }

  function instantiate(def) {
    const engine = engines[def.engine];
    if (!engine) throw new Error('محرك هذا المصدر غير موجود في هذا الإصدار من التطبيق');
    return engine.create(def, ctx);
  }

  function activate(id) {
    const rec = state[id];
    unavailable.delete(id);
    if (!rec?.stable?.def) return live.delete(id);
    if (rec.blocked) {
      live.delete(id);
      unavailable.set(id, rec.blocked);
      return;
    }
    try {
      live.set(id, { def: rec.stable.def, source: instantiate(rec.stable.def) });
    } catch (error) {
      // عطل مصدر واحد لا يُسقط تحميل البقية
      live.delete(id);
      unavailable.set(id, String(error?.message ?? error));
    }
  }

  /** نسخة تعريف إلى المخزن، وبصمتها. */
  async function stash(def) {
    const hash = await vault.put(def);
    blobs.add(hash);
    return hash;
  }

  /** يقرأ الحالة: v2 من المخزن الدائم، أو ينقل حالة v1 القديمة (كاش `health`) مرة واحدة. */
  async function hydrate() {
    const saved = await keep.store.get(keep.ns, STATE_KEY).catch(() => null);
    const value = saved?.value;
    if (value?.v === 2 && value.sources && typeof value.sources === 'object') {
      for (const [from, to] of Object.entries(value.aliases ?? {})) if (typeof to === 'string' && from !== to) aliases[from] = to;
      blobs = new Set(Array.isArray(value.blobs) ? value.blobs.filter((x) => typeof x === 'string') : []);
      for (const [id, rec] of Object.entries(value.sources)) {
        if (!rec || typeof rec !== 'object') continue;
        const load = async (slot) => {
          if (!slot?.hash) return null;
          const def = await vault.get(slot.hash);
          // النسخة تُقبل فقط إن طابقت بصمتها وكانت للمعرّف نفسه
          return def && def.id === id ? { ...slot, def } : null;
        };
        const next = { ...rec, stable: await load(rec.stable), lkg: await load(rec.lkg), candidate: await load(rec.candidate) };
        if (!next.stable && next.lkg) {
          log(`استُعيدت آخر نسخة سليمة لـ${id}: النسخة الفاعلة تالفة على الجهاز`);
          next.stable = next.lkg;
          next.lkg = null;
          next.restored = { at: now(), reason: 'النسخة الفاعلة تالفة على الجهاز؛ عادت آخر نسخة سليمة' };
        }
        if (next.stable) state[id] = next;
      }
      return;
    }
    const legacy = await store.get('health', LEGACY_KEY).catch(() => null);
    const old = legacy?.value && typeof legacy.value === 'object' ? legacy.value : {};
    for (const [id, rec] of Object.entries(old)) {
      if (!rec?.stable?.def || RESERVED.test(id)) continue;
      const move = async (slot) => {
        if (!slot?.def || slot.def.id !== id) return null;
        try {
          return { ...slot, hash: await stash(slot.def) };
        } catch {
          return null;
        }
      };
      const stable = await move(rec.stable);
      if (stable) state[id] = { ...rec, stable, lkg: await move(rec.lkg), candidate: await move(rec.candidate) };
    }
  }

  /**
   * يقرأ التعريفات المشحونة ويقارنها بالمحفوظ. لا ينتظر أي فحص.
   * `defs === null` (أو غير مصفوفة) يعني أن الحزمة لم تُقرأ: تعمل المصادر المثبتة من نسختها
   * المحلية ولا يُحذف شيء. `blocked`: حظر أمني من حزمة التطبيق نفسها (`[{id?, hash?, reason}]`)
   * يعطّل المصدر ويشرح السبب ولا يمس المكتبة، ويُفحص قبل أي رجوع لـLKG.
   */
  async function init(defs, { blocked = [] } = {}) {
    loaded ??= (async () => {
      await hydrate();
      const bundle = Array.isArray(defs) ? defs.slice(0, MAX_DEFS) : null;
      if (bundle) {
        const accepted = [];
        const seen = new Set();
        for (const def of bundle) {
          const errors = defErrors(def, engineNames);
          if (!errors.length && RESERVED.test(def.id)) errors.push('reserved-id');
          if (errors.length) {
            log(`تعريف مرفوض ${def?.id}: ${errors.join(', ')}`);
            continue;
          }
          // معرّف مكرر في الحزمة، أو يملكه موقع أضافه المستخدم: يُرفض ولا يحلّ محلّ غيره
          if (seen.has(def.id) || state[def.id]?.user) {
            log(`${ID_COLLISION}: المعرّف ${def.id} محجوز لمصدر آخر`);
            continue;
          }
          let hash;
          try {
            hash = await stash(def);
          } catch (error) {
            log(`تعريف مرفوض ${def.id}: ${error?.message ?? error}`);
            continue;
          }
          seen.add(def.id);
          accepted.push({ def, hash });
        }

        // معرّف مشحون سابقًا غاب: ترحيل بتطابق وحيد، وإلا يبقى من نسخته المحلية
        const missing = Object.keys(state).filter((id) => !state[id].user && !seen.has(id));
        const fresh_ = accepted.filter(({ def }) => !state[def.id]);
        for (const id of missing) {
          const key = identityOf(state[id].stable.def);
          const targets = fresh_.filter(({ def }) => identityOf(def) === key);
          const rivals = missing.filter((m) => identityOf(state[m].stable.def) === key);
          if (targets.length === 1 && rivals.length === 1) {
            const to = targets[0].def.id;
            log(`رُحّل ${id} إلى ${to} (تطابق وحيد بالاسم واللغة)`);
            for (const [from, target] of Object.entries(aliases)) if (target === id) aliases[from] = to;
            aliases[id] = to;
            delete state[id];
            live.delete(id);
            continue;
          }
          if (targets.length > 1 || rivals.length > 1) log(`لم يُرحَّل ${id}: التطابق غامض ويحتاج قرار المستخدم`);
          if (state[id].stable.def.content !== 'manga') {
            // مصادر الفيديو المدمجة أُزيلت بقرار المالك (الانتقال للإضافات): لا تُستبقى
            delete state[id];
            live.delete(id);
            continue;
          }
          state[id] = { ...state[id], orphan: state[id].orphan ?? { since: now(), reason: OUT_OF_REPOSITORY } };
        }

        for (const { def, hash } of accepted) {
          const rec = state[def.id];
          // معرّف عاد للحزمة: لم يعد اسمًا قديمًا لغيره
          delete aliases[def.id];
          if (!rec?.stable) {
            state[def.id] = { stable: { version: def.version, hash, def, verified: false }, lkg: null, candidate: null, health: fresh() };
            continue;
          }
          const { orphan, refused, ...back } = rec;
          if (rec.stable.hash !== hash && rec.candidate?.hash !== hash && rec.lkg?.hash !== hash) {
            if (def.version < rec.stable.version) {
              // لا رجوع لإصدار أقدم من حزمة (TUF): قد تكون نسخة قديمة مخبأة أو متلاعبًا بها
              log(`${DOWNGRADE_REFUSED}: ${def.id} v${def.version} أقدم من المثبت v${rec.stable.version}`);
              state[def.id] = { ...back, refused: { version: def.version, hash, at: now(), code: DOWNGRADE_REFUSED } };
            } else {
              state[def.id] = { ...back, candidate: { version: def.version, hash, def, status: 'pending', at: 0 } };
            }
          } else if (rec.candidate?.hash === hash && rec.candidate.status === 'failed' && now() - rec.candidate.at > RETRY_FAILED_MS) {
            state[def.id] = { ...back, candidate: { ...rec.candidate, status: 'pending' } };
          } else {
            state[def.id] = back;
          }
        }
      }

      // الحظر الأمني: يعطّل ويشرح، ولا يحذف تعريفًا ولا مكتبة. LKG المحظور لا يُستعاد
      const rules = (Array.isArray(blocked) ? blocked : []).filter((b) => b && typeof b === 'object' && (typeof b.id === 'string' || typeof b.hash === 'string'));
      const isBlocked = (id, slot) => Boolean(slot) && rules.find((b) => (!b.id || b.id === id) && (!b.hash || b.hash === slot.hash));
      for (const [id, rec] of Object.entries(state)) {
        const hit = isBlocked(id, rec.stable);
        const { blocked: _old, ...clean } = rec;
        if (hit && rec.lkg && !isBlocked(id, rec.lkg)) {
          log(`النسخة الفاعلة من ${id} محظورة؛ رجوع لآخر نسخة سليمة`);
          state[id] = { ...clean, stable: rec.lkg, lkg: null };
        } else if (hit) {
          state[id] = { ...clean, blocked: `عُطّل لسبب أمني من VANTARA: ${String(hit.reason ?? 'غير مذكور').slice(0, 160)}` };
        } else {
          state[id] = clean;
        }
        if (isBlocked(id, state[id].candidate)) state[id] = { ...state[id], candidate: null };
        if (isBlocked(id, state[id].lkg)) state[id] = { ...state[id], lkg: null };
      }

      for (const id of Object.keys(state)) activate(id);
      for (const id of [...live.keys()]) if (!own(state, id)) live.delete(id);
      await save();
      await sweep();
    })();
    return loaded;
  }

  /** يكنس نسخ التعريفات التي لم يعد يشير إليها شيء (الفاعلة وLKG والمرشح تبقى). */
  async function sweep() {
    const referenced = new Set();
    for (const rec of Object.values(state)) for (const slot of [rec.stable, rec.lkg, rec.candidate, rec.refused]) if (slot?.hash) referenced.add(slot.hash);
    const doomed = [...blobs].filter((sha) => !referenced.has(sha));
    if (!doomed.length) return;
    await vault.sweep(referenced, doomed).catch(() => 0);
    for (const sha of doomed) blobs.delete(sha);
    await save();
  }

  /** فحص كامل لتعريف (يُستعمل للمرشح وللمستقر غير المُتحقَّق). */
  async function probe(def) {
    const source = instantiate(def);
    const query = def.probe?.query ?? 'a';
    if (def.content === 'manga') {
      let list = checkListing(await source.search(query, 1));
      if (!list.mangas.length) list = checkListing(await source.popular(1));
      if (!list.mangas.length) throw new Error('البحث والقائمة فارغان');
      const series = checkSeries(await source.series(list.mangas[0]));
      if (!series.chapters.length) throw new Error('لا فصول');
      const pages = checkPages(await source.pages(series.chapters[0]));
      if (!pages.length) throw new Error('لا صفحات');
      return { items: list.mangas.length, chapters: series.chapters.length, pages: pages.length };
    }
    const items = await source.search(query);
    if (!Array.isArray(items) || !items.length) throw new Error('البحث فارغ');
    const episodes = await source.episodes(items[0]);
    if (!episodes?.length) throw new Error('لا حلقات');
    const servers = await source.servers(episodes[0]);
    if (!servers?.length) throw new Error('لا سيرفرات');
    return { items: items.length, episodes: episodes.length, servers: servers.length };
  }

  /** يفحص ما ينتظر الفحص (مرشحون، ومستقر لم يُتحقَّق منه)، واحدًا واحدًا. */
  async function verifyPending({ only = null } = {}) {
    await loaded;
    const results = [];
    for (const [id, rec] of Object.entries(state)) {
      if (only && id !== only) continue;
      if (rec.blocked) continue;
      if (rec.candidate?.status === 'pending') {
        try {
          const summary = await probe(rec.candidate.def);
          // تبديل ذري: المرشح لا يصير فاعلًا إلا بعد نجاح فحصه كاملًا، والسابق يبقى LKG
          const current = state[id] ?? rec;
          state[id] = { ...current, lkg: current.stable, stable: { ...rec.candidate, verified: true, summary }, candidate: null, health: fresh() };
          activate(id);
          results.push({ id, kind: 'candidate', ok: true, summary });
          log(`اعتُمد ${id} v${rec.candidate.version}`);
        } catch (error) {
          state[id] = { ...(state[id] ?? rec), candidate: { ...rec.candidate, status: 'failed', at: now(), error: String(error?.message ?? error) } };
          results.push({ id, kind: 'candidate', ok: false, error: String(error?.message ?? error) });
          log(`رُفض مرشح ${id}: ${error?.message ?? error}`);
        }
      } else if (rec.stable && !rec.stable.verified) {
        try {
          const summary = await probe(rec.stable.def);
          state[id] = { ...state[id], stable: { ...rec.stable, verified: true, summary } };
          results.push({ id, kind: 'stable', ok: true, summary });
        } catch (error) {
          results.push({ id, kind: 'stable', ok: false, error: String(error?.message ?? error) });
        }
      }
      await save();
    }
    await sweep();
    return results;
  }

  /** نتيجة كل نداء حقيقي: نجاح يصفّر العدّاد، والفشل المتكرر يبرّد أو يرجع. */
  function report(sourceId, ok, error = null) {
    const id = resolve(sourceId);
    const rec = state[id];
    if (!rec) return;
    const h = { ...fresh(), ...(rec.health ?? {}) };
    if (ok) {
      h.ok += 1;
      h.streak = 0;
      h.lastOk = now();
      h.coolUntil = 0;
    } else {
      // الإلغاء ليس نجاحًا ولا فشلًا للمصدر: لا يُحسب
      if (error?.name === 'AbortError' || error?.code === 'aborted') return;
      // تحقق Cloudflare أو مضيف محجوب أو موقع طلب التوقف ليس عطلًا في التعريف: تبريد فقط
      const structural = !NOT_STRUCTURAL.includes(error?.code);
      h.fail += 1;
      h.streak += 1;
      // سبب عربي صريح يقول من أين جاء الفشل (الموقع، الشبكة، VANTARA)
      h.lastError = describeFailure(error).text;
      h.lastDetail = String(error?.message ?? error ?? '').replace(/(?:https?|stremio):\/\/\S+/gi, '[رابط]').slice(0, 200);
      if (h.streak >= FAILS_TO_COOL) h.coolUntil = now() + COOLDOWN_MS;
      if (structural && h.streak >= FAILS_TO_ROLLBACK && rec.lkg && rec.lkg.hash !== rec.stable.hash) {
        log(`رجوع ${id} إلى آخر نسخة سليمة v${rec.lkg.version}`);
        state[id] = {
          ...rec,
          candidate: { ...rec.stable, status: 'failed', at: now(), error: h.lastError },
          stable: rec.lkg,
          lkg: null,
          health: fresh(),
          restored: { at: now(), reason: `تعطّلت النسخة v${rec.stable.version} بعد تفعيلها؛ عادت آخر نسخة سليمة v${rec.lkg.version}` },
        };
        activate(id);
        void save();
        return;
      }
    }
    state[id] = { ...rec, health: h };
    void save();
  }

  /** يغلّف نداء مصدر: يسجّل نجاحه أو فشله. المعرّف القديم بعد ترحيل يصل للجديد. */
  async function call(sourceId, fn) {
    const id = resolve(sourceId);
    const entry = live.get(id);
    if (!entry) {
      const why = unavailable.get(id);
      throw Object.assign(new Error(why ?? 'مصدر غير معروف'), { code: why ? 'source_unavailable' : 'unknown_source' });
    }
    try {
      const out = await fn(entry.source, entry.def);
      report(id, true);
      return out;
    } catch (error) {
      report(id, false, error);
      throw error;
    }
  }

  const cooling = (id) => (state[resolve(id)]?.health?.coolUntil ?? 0) > now();

  /**
   * موقع أضافه المستخدم (detect.js): يُفحص كاملًا أولًا كأي مصدر، ولا يُحفظ إن فشل.
   * إعادة إضافة نفس الموقع تستبدل تعريفه.
   */
  async function addUser(def) {
    await loaded;
    const errors = defErrors(def, engineNames);
    if (!errors.length && RESERVED.test(def.id)) errors.push('reserved-id');
    if (errors.length) throw new Error(`تعريف الموقع غير صالح: ${errors.join('، ')}`);
    if (state[def.id] && !state[def.id].user) throw Object.assign(new Error('هذا الموقع مصدر مدمج أصلًا'), { code: ID_COLLISION });
    if (own(aliases, def.id)) throw Object.assign(new Error('هذا المعرّف محجوز لمصدر مدمج رُحّل'), { code: ID_COLLISION });
    const summary = await probe(def);
    const hash = await stash(def);
    const before = state[def.id];
    state[def.id] = { user: true, stable: { version: def.version, hash, def, verified: true, summary }, lkg: before?.stable && before.stable.hash !== hash ? before.stable : null, candidate: null, health: fresh() };
    activate(def.id);
    await save();
    return { id: def.id, label: def.label, engine: def.engine, summary };
  }

  /** يفتح الموقع، يتعرّف على قالبه، ويضيفه بعد الفحص. */
  async function addSite(input) {
    const origin = siteOrigin(input);
    let res;
    try {
      res = await ctx.fetch.text(origin);
    } catch (error) {
      if (error?.code === 'host_not_allowed' || /host_not_allowed|غير مسموح/.test(String(error?.message)))
        throw new Error('نسخة المتصفح تفتح مواقع محددة فقط. أضف الموقع من التطبيق أو برنامج الويندوز');
      throw new Error(`تعذر فتح الموقع: ${error?.message ?? error}`);
    }
    if (!res?.text || (res.status && res.status >= 400)) throw new Error(`تعذر فتح الموقع (${res?.status ?? 'بلا رد'})`);
    const base = siteDef({ origin, html: res.text });
    let last = null;
    for (const config of configVariants(base.engine, res.text, base.domain)) {
      try {
        return await addUser({ ...base, config });
      } catch (error) {
        last = error;
      }
    }
    throw new Error(`القالب ${base.engine} معروف لكن الموقع معدّل ولم ينجح فحصه: ${last?.message ?? last}`);
  }

  /** الحذف بأمر المستخدم وحده. */
  async function removeUser(id) {
    await loaded;
    if (!state[id]?.user) throw new Error('ليس موقعًا أضفته');
    delete state[id];
    live.delete(id);
    unavailable.delete(id);
    await save();
    await sweep();
  }

  const listed = (e) => {
    const rec = state[e.def.id];
    return rec?.orphan ? { ...e.def, inRepository: false, repositoryNote: rec.orphan.reason } : e.def;
  };

  return {
    init,
    verifyPending,
    addUser,
    addSite,
    removeUser,
    userSites: () => Object.values(state).filter((r) => r.user && r.stable).map((r) => ({ id: r.stable.def.id, label: r.stable.def.label, engine: r.stable.def.engine, domain: r.stable.def.domain })),
    report,
    call,
    cooling,
    resolve,
    def: (id) => live.get(resolve(id))?.def ?? null,
    source: (id) => live.get(resolve(id))?.source ?? null,
    /** سبب عربي لمصدر مثبت لا يعمل الآن (حظر أمني، محرك غائب)، أو null. */
    unavailableReason: (id) => unavailable.get(resolve(id)) ?? null,
    aliases: () => ({ ...aliases }),
    // `edge: 'challenge'`: الموقع يتحدّى عناوين جالب الويب (Cloudflare) فلا يصل منه شيء في
    // المتصفح — يبقى للـAPK (يحل التحدي محليًا)، ومصفوفة الحافة الأسبوعية تقول متى يُعاد
    list: (content = null) => [...live.values()].filter((e) => (!content || e.def.content === content) && e.def.edge !== 'challenge').map(listed),
    status: () => JSON.parse(JSON.stringify(state)),
    probe,
  };
}
