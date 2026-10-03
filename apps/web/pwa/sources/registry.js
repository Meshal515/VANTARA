/**
 * سجلّ مصادر الويب: Stable / Candidate / Last Known Good.
 *
 * التعريفات تصل مع حزمة الواجهة (defs.json). وتعريف جديد لا يُعتمد بالثقة:
 *
 *   أول مرة نرى المصدر      ⇒ يُستعمل فورًا (stable، غير مُتحقَّق) ويُفحص في الخلفية.
 *   إصدار أعلى أو تعديل     ⇒ candidate؛ يبقى الـstable شغّالًا حتى ينجح فحص المرشح،
 *                              فيصير هو stable والقديم last known good.
 *   فشل فحص المرشح          ⇒ يبقى الـstable، والمرشح «فاشل» ويُعاد فحصه بعد 6 ساعات.
 *   الـstable يفشل مرارًا    ⇒ رجوع إلى last known good (rollback) إن وُجد.
 *   فشل متتالٍ              ⇒ تبريد قصير: البحث لا ينتظر مصدرًا ميتًا.
 *
 * الحالة محفوظة في كاش `health` (pwa/cache/store.js) فتبقى بين الجلسات.
 * الفحص (probe): بحث بكلمة التعريف ← تفاصيل أول نتيجة ← فصول ← صفحات أول فصل.
 */

import { checkListing, checkPages, checkSeries, defErrors, defHash } from './contract.js';

const STATE_KEY = 'registry:v1';
const RETRY_FAILED_MS = 6 * 60 * 60 * 1000;
const FAILS_TO_ROLLBACK = 4;
const FAILS_TO_COOL = 3;
const COOLDOWN_MS = 10 * 60 * 1000;

/**
 * @param {{ engines: Record<string, {create: Function, content: string}>, store: any, ctx: object,
 *           now?: () => number, log?: (msg: string) => void }} deps
 */
export function createRegistry({ engines, store, ctx, now = () => Date.now(), log = () => {} }) {
  let state = {};
  const live = new Map(); // id → { def, source }
  let loaded = null;

  const engineNames = Object.keys(engines);

  async function save() {
    await store.set('health', STATE_KEY, state).catch(() => {});
  }

  function instantiate(def) {
    const engine = engines[def.engine];
    return engine.create(def, ctx);
  }

  function activate(id) {
    const rec = state[id];
    if (!rec?.stable) return live.delete(id);
    live.set(id, { def: rec.stable.def, source: instantiate(rec.stable.def) });
  }

  /** يقرأ التعريفات المشحونة ويقارنها بالمحفوظ. لا ينتظر أي فحص. */
  async function init(defs) {
    loaded ??= (async () => {
      const saved = await store.get('health', STATE_KEY).catch(() => null);
      state = saved?.value && typeof saved.value === 'object' ? saved.value : {};
      for (const def of defs) {
        const errors = defErrors(def, engineNames);
        if (errors.length) {
          log(`تعريف مرفوض ${def?.id}: ${errors.join(', ')}`);
          continue;
        }
        const hash = defHash(def);
        const rec = state[def.id];
        if (!rec?.stable) {
          state[def.id] = { stable: { version: def.version, hash, def, verified: false }, lkg: null, candidate: null, health: fresh() };
        } else if (rec.stable.hash !== hash && rec.candidate?.hash !== hash && rec.lkg?.hash !== hash) {
          state[def.id] = { ...rec, candidate: { version: def.version, hash, def, status: 'pending', at: 0 } };
        } else if (rec.candidate?.hash === hash && rec.candidate.status === 'failed' && now() - rec.candidate.at > RETRY_FAILED_MS) {
          state[def.id] = { ...rec, candidate: { ...rec.candidate, status: 'pending' } };
        }
        activate(def.id);
      }
      // مصادر لم تعد في الحزمة: تُزال
      const shipped = new Set(defs.map((d) => d.id));
      for (const id of Object.keys(state)) if (!shipped.has(id)) {
        delete state[id];
        live.delete(id);
      }
      await save();
    })();
    return loaded;
  }

  const fresh = () => ({ ok: 0, fail: 0, streak: 0, lastOk: 0, lastError: null, coolUntil: 0 });

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
      if (rec.candidate?.status === 'pending') {
        try {
          const summary = await probe(rec.candidate.def);
          state[id] = { ...rec, lkg: rec.stable, stable: { ...rec.candidate, verified: true, summary }, candidate: null, health: fresh() };
          activate(id);
          results.push({ id, kind: 'candidate', ok: true, summary });
          log(`اعتُمد ${id} v${rec.candidate.version}`);
        } catch (error) {
          state[id] = { ...rec, candidate: { ...rec.candidate, status: 'failed', at: now(), error: String(error?.message ?? error) } };
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
    return results;
  }

  /** نتيجة كل نداء حقيقي: نجاح يصفّر العدّاد، والفشل المتكرر يبرّد أو يرجع. */
  function report(id, ok, error = null) {
    const rec = state[id];
    if (!rec) return;
    const h = { ...fresh(), ...(rec.health ?? {}) };
    if (ok) {
      h.ok += 1;
      h.streak = 0;
      h.lastOk = now();
      h.coolUntil = 0;
    } else {
      // تحقق Cloudflare أو مضيف محجوب ليس عطلًا في التعريف: تبريد فقط
      const structural = !['challenge', 'host_not_allowed', 'signed_out', 'aborted', 'timeout', 'network'].includes(error?.code);
      h.fail += 1;
      h.streak += 1;
      h.lastError = String(error?.message ?? error ?? 'فشل');
      if (h.streak >= FAILS_TO_COOL) h.coolUntil = now() + COOLDOWN_MS;
      if (structural && h.streak >= FAILS_TO_ROLLBACK && rec.lkg && rec.lkg.hash !== rec.stable.hash) {
        log(`رجوع ${id} إلى آخر نسخة سليمة v${rec.lkg.version}`);
        state[id] = { ...rec, candidate: { ...rec.stable, status: 'failed', at: now(), error: h.lastError }, stable: rec.lkg, lkg: null, health: fresh() };
        activate(id);
        void save();
        return;
      }
    }
    state[id] = { ...rec, health: h };
    void save();
  }

  /** يغلّف نداء مصدر: يسجّل نجاحه أو فشله. */
  async function call(id, fn) {
    const entry = live.get(id);
    if (!entry) throw Object.assign(new Error('مصدر غير معروف'), { code: 'unknown_source' });
    try {
      const out = await fn(entry.source, entry.def);
      report(id, true);
      return out;
    } catch (error) {
      report(id, false, error);
      throw error;
    }
  }

  const cooling = (id) => (state[id]?.health?.coolUntil ?? 0) > now();

  return {
    init,
    verifyPending,
    report,
    call,
    cooling,
    def: (id) => live.get(id)?.def ?? null,
    source: (id) => live.get(id)?.source ?? null,
    // `edge: 'challenge'`: الموقع يتحدّى عناوين جالب الويب (Cloudflare) فلا يصل منه شيء في
    // المتصفح — يبقى للـAPK (يحل التحدي محليًا)، ومصفوفة الحافة الأسبوعية تقول متى يُعاد
    list: (content = null) => [...live.values()].map((e) => e.def).filter((d) => (!content || d.content === content) && d.edge !== 'challenge'),
    status: () => JSON.parse(JSON.stringify(state)),
    probe,
  };
}
