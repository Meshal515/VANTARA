/**
 * الخطة ب (docs/audits/MANGA_REMEDIATION_PLAN.md §4): هوية واحدة ثابتة لكل عمل، يعرفها الكل.
 *
 * الهدف (قرار المالك 21 نوفمبر): عمل واحد = هوية واحدة = بطاقة واحدة = مصادر متعددة مهما اختلفت العناوين.
 * تكرار 0، دمج خاطئ 0، وكل مصدر عنده العمل يظهر في بطاقته.
 *
 *  - **المرجع** (`ext:<عنوان>`) هو ما كُتبت به بياناتك (مكتبة، تقدّم، علامات، تنزيلات). لا يُعاد كتابة أي صف: كل
 *    مرجع عقدة في الرسم.
 *  - **الدمج حافة مسجّلة** بين مرجعين، لها دليلها ورتبتها ووقتها. العمل هو المكوّن المتصل من الحواف الفعّالة.
 *  - **الهوية** `vw:<16 ست عشري>` بصمة أصغر مرجع في المكوّن. تُحسب ولا تُخزَّن، فكل جهاز يرى المكوّن نفسه يعطي
 *    المعرّف نفسه بلا خادم، ودمج عملين يُبقي معرّف أحدهما بقاعدة ثابتة.
 *  - **التعارض يمنع الدمج:** معرّفان رسميان مختلفان (AniList)، أو فصلٌ قرره المستخدم. ودمجٌ قديم ظهر تعارضه بعد
 *    حدوثه (معرّف رسمي تُعلِّم لاحقًا) **يُقطع وحده**: أضعف حافة على الطريق بين المتعارضين، والأحدث عند التساوي.
 *    القطع مسجَّل بسببه فيُعاد إن زال سببه (فك الفصل). حافة المستخدم لا تُقطع آليًا أبدًا.
 *  - **نسخة المصدر** (`عائلة|رابط`) تُربط بعمل واحد فقط، وبدليل موثَّق (رتبة SOURCE فأعلى). نسخة مربوطة بعمل لا
 *    تُلصق بعمل آخر بدليل ضعيف. هذا ما يمنع قصة جانبية من أخذ فصول العمل الأصلي.
 *
 * هذا الملف منطق خالص بلا تخزين ولا شبكة. التخزين في manga-alias-store.js.
 */

/** رتب الأدلة، الأعلى أقوى. */
export const RANK = Object.freeze({
  /** سجل دمج من إصدار سابق (refAliases): بلا دليل محفوظ. */
  LEGACY: 0,
  /** تشابه عنوان أو اسم بديل تعلّمه الجهاز. */
  TITLE: 1,
  /** المصدر قالها عن نفسه: اسم النسخة نفسه، أو أسماؤها البديلة في صفحتها، أو رابطها. */
  SOURCE: 2,
  /** معرّف رسمي مؤكد (AniList بمطابقة بلا لبس). */
  OFFICIAL: 3,
  /** قرار المستخدم بيده. */
  USER: 4,
});

const SEP = '\u0000';
const pairKey = (a, b) => (a < b ? `${a}${SEP}${b}` : `${b}${SEP}${a}`);
const splitPair = (key) => key.split(SEP);

/** بصمة FNV-1a 64 ثابتة. */
function fnv64(text) {
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(String(text))) {
    h ^= BigInt(byte);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

/** معرّف الهوية من مرجعها القانوني (أصغر مرجع في المكوّن). */
export const identityIdOf = (canonicalRef) => `vw:${fnv64(canonicalRef)}`;

/**
 * مفتاح نسخة المصدر: العائلة (المرايا عائلة واحدة) ومسار الرابط بلا النطاق ولا الشرطة الأخيرة. تغيّر نطاق الموقع
 * لا يغيّر النسخة.
 */
export function editionKey(family, url) {
  const fam = String(family ?? '').trim();
  let path = String(url ?? '').trim();
  if (!fam || !path) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      const u = new URL(path);
      path = `${u.pathname}${u.search}${u.hash}`;
    } catch {
      // رابط غير صالح: يُستعمل كما هو
    }
  }
  path = path.replace(/\/+(?=$|[?#])/, '') || '/';
  return `${fam}|${path}`;
}

/**
 * رسم الهوية.
 * @param {{ officialOf?: (ref: string) => (number|null), now?: () => number }} options
 *   `officialOf`: المعرّف الرسمي المؤكد للمرجع إن عُرف.
 */
export function createIdentityGraph({ officialOf = () => null, now = () => Date.now() } = {}) {
  /** @type {Map<string, {a: string, b: string, rank: number, at: number, why: string, cut: null|{by: string, at: number}}>} */
  const edges = new Map();
  /** المرجع ← مفاتيح حوافه بترتيب إضافتها. */
  const adj = new Map();
  /** أزواج فصلها المستخدم ← وقت الفصل. */
  const splits = new Map();
  /** مفتاح النسخة ← { ref, rank, at }. */
  const editions = new Map();
  /** آخر الأحداث للتشخيص (الحواف نفسها هي السجل الدائم). */
  const log = [];
  const note = (event) => {
    log.push({ ...event, at: event.at ?? now() });
    if (log.length > 300) log.splice(0, log.length - 300);
  };

  // ── المكوّنات: اتحاد-بحث للحواف الفعّالة، يُبنى من جديد بعد أي قطع ──
  let parent = new Map();
  let minOf = new Map();
  let dirty = true;
  const order = new Map(); // ترتيب BFS مخزن لكل مرجع حتى أي تغيير
  const touch = (ref) => {
    if (!adj.has(ref)) adj.set(ref, []);
  };
  const find = (x) => {
    if (!parent.has(x)) return x;
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    let c = x;
    while (parent.get(c) !== r) {
      const next = parent.get(c);
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const join = (a, b) => {
    if (!parent.has(a)) { parent.set(a, a); minOf.set(a, a); }
    if (!parent.has(b)) { parent.set(b, b); minOf.set(b, b); }
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    parent.set(rb, ra);
    const ma = minOf.get(ra);
    const mb = minOf.get(rb);
    minOf.set(ra, ma < mb ? ma : mb);
  };
  const rebuild = () => {
    parent = new Map();
    minOf = new Map();
    for (const e of edges.values()) if (!e.cut) join(e.a, e.b);
    dirty = false;
  };
  const ensure = () => {
    if (dirty) rebuild();
  };
  const changed = (structural) => {
    order.clear();
    strong = null;
    if (structural) dirty = true;
  };

  /** كل مراجع العمل: المرجع نفسه أولًا ثم بقية المكوّن بترتيب الوصول (BFS على الحواف الفعّالة). */
  function classOf(ref) {
    const start = String(ref ?? '');
    if (!adj.has(start)) return [start];
    const hit = order.get(start);
    if (hit) return hit.slice();
    const out = [start];
    const seen = new Set(out);
    for (let i = 0; i < out.length; i++) {
      for (const key of adj.get(out[i]) ?? []) {
        const e = edges.get(key);
        if (!e || e.cut) continue;
        const next = e.a === out[i] ? e.b : e.a;
        if (seen.has(next)) continue;
        seen.add(next);
        out.push(next);
      }
    }
    order.set(start, out);
    return out.slice();
  }

  const sameClass = (a, b) => {
    ensure();
    return a === b || (parent.has(a) && parent.has(b) && find(a) === find(b));
  };

  // المكوّن الموثَّق: حواف SOURCE فأعلى وحدها. القوائم تجمع به نسخ عمل واحد ربطتها صفحات أعماله، ولا يجرّها دمج
  // عنوان ضعيف قديم إلى عمل آخر
  let strong = null;
  const strongRoot = (x) => {
    if (!strong) {
      strong = { parent: new Map(), min: new Map() };
      const { parent: p, min } = strong;
      const root = (y) => {
        let r = y;
        while (p.get(r) !== r) r = p.get(r);
        p.set(y, r);
        return r;
      };
      for (const e of edges.values()) {
        if (e.cut || e.rank < RANK.SOURCE) continue;
        for (const y of [e.a, e.b]) if (!p.has(y)) { p.set(y, y); min.set(y, y); }
        const ra = root(e.a);
        const rb = root(e.b);
        if (ra === rb) continue;
        p.set(rb, ra);
        min.set(ra, min.get(ra) < min.get(rb) ? min.get(ra) : min.get(rb));
      }
      strong.root = root;
    }
    return strong.parent.has(x) ? strong.min.get(strong.root(x)) : x;
  };

  /** المرجع القانوني: أصغر مرجع في المكوّن (قاعدة ثابتة لا تتبع ترتيب وصول الأدلة). */
  function canonical(ref) {
    const r = String(ref ?? '');
    ensure();
    return parent.has(r) ? minOf.get(find(r)) : r;
  }

  const officialsOf = (refs) => {
    const ids = new Map();
    for (const r of refs) {
      const id = officialOf(r);
      if (Number.isSafeInteger(id) && !ids.has(id)) ids.set(id, r);
    }
    return ids;
  };

  /**
   * سبب يمنع أن يكون المكوّنان عملًا واحدًا، أو null. قرار المستخدم (USER) فوق كل شيء.
   * @param {string[]} A @param {string[]} B مراجع المكوّنين
   */
  function contradiction(A, B, rank = RANK.TITLE) {
    if (rank >= RANK.USER) return null;
    if (splits.size) {
      const setA = new Set(A);
      const setB = new Set(B);
      for (const key of splits.keys()) {
        const [x, y] = splitPair(key);
        if ((setA.has(x) && setB.has(y)) || (setA.has(y) && setB.has(x))) return 'فصلهما المستخدم';
      }
    }
    const ids = officialsOf([...A, ...B]);
    if (ids.size > 1) return `معرّفان رسميان مختلفان (${[...ids.keys()].sort((p, q) => p - q).join(' ≠ ')})`;
    return null;
  }

  /** حافة باتجاهها كما قيلت (`a` الاسم القديم، `b` القانوني)، كما في سجل الدمج القديم. */
  function addEdge(a, b, rank, at, why) {
    touch(a);
    touch(b);
    const key = pairKey(a, b);
    const edge = { a, b, rank, at, why: why ?? '', cut: null };
    edges.set(key, edge);
    adj.get(a).push(key);
    adj.get(b).push(key);
    if (!dirty) join(a, b);
    changed(false);
    return edge;
  }

  /**
   * اقتراح أن المرجعين عمل واحد. يُقبل إن لم يتعارض، ويُرفض بسببه إن تعارض.
   * @returns {boolean} هل صارا عملًا واحدًا
   */
  function propose(a, b, { rank = RANK.TITLE, why = '', at = now() } = {}) {
    a = String(a ?? '');
    b = String(b ?? '');
    if (!a || !b) return false;
    if (a === b) return true;
    const key = pairKey(a, b);
    const existing = edges.get(key);
    if (existing && !existing.cut) {
      if (rank > existing.rank) existing.rank = rank;
      return true;
    }
    if (splits.has(key) && rank < RANK.USER) {
      note({ type: 'refused', a, b, rank, why: 'فصلهما المستخدم' });
      return false;
    }
    // متصلان بطريق آخر: لا حافة زائدة، فالقطع بعدها يفصل فعلًا
    if (sameClass(a, b)) return true;
    const reason = contradiction(classOf(a), classOf(b), rank);
    if (reason) {
      note({ type: 'refused', a, b, rank, why: reason });
      return false;
    }
    if (existing) {
      existing.cut = null;
      existing.rank = Math.max(existing.rank, rank);
      existing.at = at;
      changed(true);
    } else addEdge(a, b, rank, at, why);
    note({ type: 'merge', a, b, rank, why, at });
    return true;
  }

  /** طريق بين مرجعين على الحواف الفعّالة: مفاتيح الحواف، أو null. */
  function pathBetween(x, y) {
    if (!adj.has(x) || !adj.has(y)) return null;
    const via = new Map([[x, null]]);
    const queue = [x];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      if (cur === y) break;
      for (const key of adj.get(cur) ?? []) {
        const e = edges.get(key);
        if (!e || e.cut) continue;
        const next = e.a === cur ? e.b : e.a;
        if (via.has(next)) continue;
        via.set(next, key);
        queue.push(next);
      }
    }
    if (!via.has(y)) return null;
    const out = [];
    for (let cur = y; cur !== x;) {
      const key = via.get(cur);
      out.push(key);
      const e = edges.get(key);
      cur = e.a === cur ? e.b : e.a;
    }
    return out;
  }

  /**
   * يفصل مرجعين بقطع أضعف حافة على كل طريق بينهما (الأحدث عند التساوي) حتى لا يبقى طريق.
   * `keepUser`: حواف المستخدم لا تُقطع (الشفاء الآلي). يرجع ما قُطع، أو null إن لم يمكن الفصل.
   */
  function disconnect(x, y, by, { keepUser = true } = {}) {
    const cuts = [];
    for (let guard = edges.size + 1; guard > 0; guard--) {
      const path = pathBetween(x, y);
      if (!path) return cuts;
      const candidates = path.map((k) => edges.get(k)).filter((e) => !keepUser || e.rank < RANK.USER);
      if (!candidates.length) {
        note({ type: 'unhealed', a: x, b: y, why: by });
        return null;
      }
      candidates.sort((p, q) => p.rank - q.rank || q.at - p.at || (pairKey(p.a, p.b) < pairKey(q.a, q.b) ? -1 : 1));
      const edge = candidates[0];
      edge.cut = { by, at: now() };
      cuts.push(edge);
      changed(true);
      note({ type: 'cut', a: edge.a, b: edge.b, rank: edge.rank, why: by });
    }
    return cuts;
  }

  /** «ليسا عملًا واحدًا»: قرار المستخدم. يُسجَّل، ويفصلهما فورًا، ولا يعيد دمجهما دليل بعده. */
  function split(a, b, at = now()) {
    a = String(a ?? '');
    b = String(b ?? '');
    const key = pairKey(a, b);
    if (!a || !b || a === b || splits.has(key)) return false;
    splits.set(key, at);
    touch(a);
    touch(b);
    disconnect(a, b, `split:${key}`, { keepUser: false });
    changed(true);
    note({ type: 'split', a, b, at });
    return true;
  }

  /** فك الفصل: الحدث نفسه يُزال، وما قُطع بسببه يعود إن لم يتعارض مع غيره. */
  function unsplit(a, b) {
    const key = pairKey(String(a ?? ''), String(b ?? ''));
    if (!splits.has(key)) return false;
    splits.delete(key);
    changed(true);
    for (const edge of edges.values()) {
      if (edge.cut?.by !== `split:${key}`) continue;
      if (sameClass(edge.a, edge.b) || !contradiction(classOf(edge.a), classOf(edge.b), edge.rank)) {
        edge.cut = null;
        changed(true);
      }
    }
    note({ type: 'unsplit', a, b });
    return true;
  }

  const isSplit = (a, b) => splits.has(pairKey(String(a ?? ''), String(b ?? '')));

  /**
   * الشفاء: كل مكوّن فيه معرّفان رسميان مختلفان يُقطع بين حامليهما (حواف المستخدم باقية). يُنادى بعد أي تعلّم
   * لمعرّف رسمي. يرجع الحواف المقطوعة.
   */
  function heal() {
    const cuts = [];
    const queue = [...adj.keys()];
    const done = new Set();
    // طابور عمل: كل قطع يُعيد الجزأين للفحص، فسلسلة دمج خاطئ طويلة تُشفى كلها مهما طالت. ينتهي لأن كل دورة إما
    // تقطع حافة (عددها محدود) أو تُعلِّم مكوّنًا منتهيًا
    while (queue.length) {
      const ref = queue.pop();
      if (done.has(ref)) continue;
      const members = classOf(ref);
      const holders = members.length > 1 ? [...officialsOf(members).values()] : [];
      let healed = false;
      for (let i = 0; i < holders.length && !healed; i++) {
        for (let j = i + 1; j < holders.length && !healed; j++) {
          const out = disconnect(holders[i], holders[j], 'official');
          if (out?.length) {
            cuts.push(...out);
            queue.push(holders[i], holders[j]);
            healed = true;
          }
        }
      }
      // لا تعارض، أو لا يربطه إلا المستخدم: المكوّن منتهٍ
      if (!healed) for (const m of members) done.add(m);
    }
    return cuts;
  }

  /**
   * ربط نسخة مصدر بعمل. لا يُحفظ إلا دليل موثَّق (SOURCE فأعلى). نسخة مربوطة بعمل آخر: دليلان موثَّقان على النسخة
   * نفسها يدمجان العملين (إن لم يتعارضا)، والضعيف لا يأخذها. المستخدم ينقلها حيث شاء.
   * @returns {{ ok: boolean, merged?: boolean, reason?: string }}
   */
  function linkEdition(key, ref, { rank = RANK.SOURCE, at = now(), why = '' } = {}) {
    ref = String(ref ?? '');
    if (!key || !ref) return { ok: false, reason: 'بلا مفتاح' };
    if (rank < RANK.SOURCE) return { ok: false, reason: 'دليل ضعيف' };
    const cur = editions.get(key);
    if (!cur) {
      editions.set(key, { ref, rank, at });
      touch(ref);
      note({ type: 'link', a: key, b: ref, rank, why });
      return { ok: true };
    }
    if (cur.ref === ref || sameClass(cur.ref, ref)) {
      if (rank > cur.rank) cur.rank = rank;
      return { ok: true };
    }
    if (rank >= RANK.USER) {
      editions.set(key, { ref, rank, at });
      touch(ref);
      note({ type: 'relink', a: key, b: ref, rank, why });
      return { ok: true };
    }
    if (propose(cur.ref, ref, { rank: Math.min(rank, cur.rank), why: why || 'نسخة مصدر واحدة', at })) return { ok: true, merged: true };
    return { ok: false, reason: 'النسخة لعمل آخر' };
  }

  /** مرجع العمل الذي رُبطت به النسخة (كما رُبط، لا القانوني)، أو null. */
  const editionRef = (key) => (key && editions.get(key)?.ref) || null;
  const editionRank = (key) => (key && editions.get(key)?.rank) ?? null;

  /**
   * الحفظ في شكلين: `refAliases` بشكل الإصدار السابق ({قانوني: [أسماء قديمة]}) للحواف الفعّالة وحدها، فيقرؤه إصدار
   * أقدم إن رجع إليه المستخدم ولا يتضاعف حجم التخزين؛ و`meta` لما لا يحمله الشكل القديم: رتب الحواف وأوقاتها
   * وأدلتها، والمقطوع منها بسببه، وروابط النسخ.
   */
  function dump() {
    const refAliases = {};
    const rows = [];
    for (const e of edges.values()) {
      if (!e.cut) (refAliases[e.b] ??= []).push(e.a);
      if (e.cut || e.rank > RANK.LEGACY || e.why) {
        const row = [e.a, e.b, e.rank, e.at, e.why];
        if (e.cut) row.push(e.cut.by, e.cut.at);
        rows.push(row);
      }
    }
    return {
      refAliases,
      meta: { v: 1, e: rows, n: Object.fromEntries([...editions].map(([k, v]) => [k, [v.ref, v.rank, v.at]])) },
    };
  }

  /**
   * يحمّل الشكلين، ثم فصل المستخدم (`splits`: [[مرجع، مرجع، وقت]]) والشفاء. حافة في السجل القديم بلا وصف في `meta`
   * جاءت من إصدار سابق: رتبتها LEGACY. والسطر المعطوب يُتجاهل وحده لا السجل كله.
   */
  function load({ refAliases = {}, meta = null, splits: pairs = [] } = {}) {
    const rows = new Map();
    if (meta && typeof meta === 'object' && meta.v === 1) {
      for (const row of Array.isArray(meta.e) ? meta.e : []) {
        if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'string' || !row[0] || !row[1] || row[0] === row[1]) continue;
        rows.set(pairKey(row[0], row[1]), row);
      }
      for (const [key, row] of Object.entries(meta.n && typeof meta.n === 'object' ? meta.n : {})) {
        if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0]) continue;
        editions.set(key, { ref: row[0], rank: Number.isFinite(row[1]) ? row[1] : RANK.SOURCE, at: Number(row[2]) || 0 });
        touch(row[0]);
      }
    }
    let i = 0;
    const add = (a, b, row) => {
      const key = pairKey(a, b);
      if (edges.has(key)) return;
      i += 1;
      const edge = addEdge(a, b, Number.isFinite(row?.[2]) ? row[2] : RANK.LEGACY, Number.isFinite(row?.[3]) ? row[3] : i, typeof row?.[4] === 'string' ? row[4] : '');
      if (typeof row?.[5] === 'string') edge.cut = { by: row[5], at: Number(row[6]) || 0 };
    };
    for (const [canonicalRef, olds] of Object.entries(refAliases && typeof refAliases === 'object' ? refAliases : {})) {
      for (const old of Array.isArray(olds) ? olds : []) {
        if (typeof old !== 'string' || !old || old === canonicalRef) continue;
        const row = rows.get(pairKey(old, canonicalRef));
        // في السجل القديم = فعّالة، ولو وصفتها meta مقطوعة (كتبها إصدار أقدم بعد القطع): القطع يُعاد بسببه أدناه
        add(old, canonicalRef, row ? row.slice(0, 5) : null);
      }
    }
    // المقطوع (أو ما لم يصل السجل القديم) من meta
    for (const row of rows.values()) add(row[0], row[1], row);
    changed(true);
    for (const [a, b, at] of pairs) {
      if (typeof a !== 'string' || typeof b !== 'string' || !a || !b || a === b) continue;
      const key = pairKey(a, b);
      if (!splits.has(key)) splits.set(key, Number(at) || 0);
      touch(a);
      touch(b);
      disconnect(a, b, `split:${key}`, { keepUser: false });
    }
    return heal();
  }

  return {
    RANK,
    propose,
    split,
    unsplit,
    isSplit,
    heal,
    classOf,
    canonical,
    identity: (ref) => identityIdOf(canonical(ref)),
    /** أصغر مرجع في المكوّن الموثَّق (حواف SOURCE فأعلى). */
    strongCanonical: (ref) => strongRoot(String(ref ?? '')),
    sameClass,
    contradiction: (a, b, rank) => contradiction(classOf(a), classOf(b), rank),
    linkEdition,
    editionRef,
    editionRank,
    splitPairs: () => [...splits.keys()].map(splitPair),
    edges: () => [...edges.values()].map((e) => ({ ...e, cut: e.cut ? { ...e.cut } : null })),
    log: () => log.slice(),
    dump,
    load,
    /** بعد تغيّر المعرّفات الرسمية: المكوّنات تُحسب من جديد عند الحاجة. */
    invalidate: () => changed(true),
  };
}
