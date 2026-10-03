/**
 * مسار السينما السريع — الهدف ليس أن ننتهي من فحص كل شيء بسرعة، بل أن يصل
 * المستخدم لأول تشغيل صالح بأسرع وقت، والباقي يكمل في الخلفية.
 *
 * ثلاث قطع مستقلة عن الواجهة (تُختبر بلا محرك):
 *   - [createMemory]: آخر نسخة وسيرفر نجحا لكل عمل، وآخر سيرفر نجح لكل مصدر.
 *     فتح عمل شوهد قبلًا يبدأ التجهيز فورًا بلا انتظار البحث.
 *   - [createLocator]: البحث المتدفق. كل مصدر يُطابَق لحظة يرد، وأول نسخة
 *     مطابقة تُرجع فورًا؛ النسخ المتأخرة تصل لمن اشترك ([onCopies]).
 *   - [createMetrics]: قياس كل فتح: زمن أول نتيجة، أول مطابقة، أول سيرفر، أول
 *     تشغيل صالح، لكل مصدر — لنعرف من السريع ومن يسحب الوقت بلا فائدة.
 */

const DAY = 86_400_000;

function readStore(storage, key, fallback) {
  try {
    return JSON.parse(storage?.getItem(key) ?? '') ?? fallback;
  } catch {
    return fallback;
  }
}
function writeStore(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // ذاكرة تسريع لا حقيقة: فشل الكتابة لا يكسر شيئًا
  }
}

/** النسخة كما يحتاجها المحرك فقط، بلا وصف ولا تصنيفات (التخزين صغير). */
const slim = (c) => ({ sourceId: c.sourceId, url: c.url, title: c.title, thumbnail: c.thumbnail ?? null, hasSeasons: Boolean(c.hasSeasons), seasonNumber: c.seasonNumber ?? -1 });
const copyKey = (c) => `${c.sourceId}|${c.url}`;

// ───────────────────────── الذاكرة ─────────────────────────

export const MEMORY_KEY = 'vantara.cinema.fast.v1';

export function createMemory(storage = globalThis.localStorage, { now = Date.now, ttl = 21 * DAY, max = 300 } = {}) {
  const read = () => readStore(storage, MEMORY_KEY, { works: {}, sources: {} });
  const save = (all) => {
    const keys = Object.keys(all.works);
    if (keys.length > max) {
      for (const k of keys.sort((a, b) => (all.works[a].at ?? 0) - (all.works[b].at ?? 0)).slice(0, keys.length - max)) delete all.works[k];
    }
    writeStore(storage, MEMORY_KEY, all);
  };
  return {
    /** النسخ التي نجحت لهذا العمل (الناجحة أولًا)، أو null إن لم نعرف أو قدُمت. */
    copies(key) {
      const w = read().works[key];
      if (!w?.copies?.length || now() - (w.at ?? 0) > ttl) return null;
      return w.copies;
    },
    /** نجح تشغيل (أو جهز سيرفر) من [winner]: يُقدَّم على بقية النسخ في المرة القادمة. */
    remember(key, copies, winner = null) {
      if (!copies?.length) return;
      const all = read();
      const list = [...copies].map(slim);
      if (winner) list.sort((a, b) => (copyKey(b) === copyKey(winner)) - (copyKey(a) === copyKey(winner)));
      const old = all.works[key] ?? {};
      all.works[key] = { ...old, copies: [...new Map(list.map((c) => [copyKey(c), c])).values()].slice(0, 8), at: now() };
      save(all);
    },
    /** آخر سيرفر اشتغل لهذا العمل؛ وإلا آخر سيرفر اشتغل على الجهاز من مصدره الأول. */
    server(key) {
      const all = read();
      const w = all.works[key];
      if (w?.server && now() - (w.serverAt ?? 0) < ttl) return w.server;
      const lead = w?.copies?.[0]?.sourceId;
      return lead && all.sources[lead] ? { sourceId: lead, server: all.sources[lead].server } : null;
    },
    rememberServer(key, { sourceId, server, code = null }) {
      if (!sourceId || !server) return;
      const all = read();
      all.works[key] = { ...(all.works[key] ?? { copies: [] }), server: { sourceId, server, code }, serverAt: now(), at: now() };
      all.sources[sourceId] = { server, at: now() };
      save(all);
    },
    forget(key) {
      const all = read();
      delete all.works[key];
      save(all);
    },
  };
}

// ───────────────────────── البحث المتدفق ─────────────────────────

/**
 * [searchStream](query, content, onHit) → {done: Promise, cancel()}: كل مصدر
 * يصل بـonHit({sourceId, items, ms, error, skipped}).
 * [match](items) → النسخ المطابقة بثقة مرتّبة (pickCopies بمعايير العمل).
 */
export function createLocator({ searchStream, queries, match, near = () => [], memory = null, content = 'cinema', retryDelayMs = 3000, wait = (ms) => new Promise((r) => setTimeout(r, ms)), clock = Date.now }) {
  /**
   * يرجع مقبضًا حيًّا:
   *   - `found`: {copies, near, total, done, fast, answered, sources}
   *   - `first`: يكتمل عند أول نسخة مطابقة (أو نهاية البحث بلا شيء)
   *   - `done`: يكتمل حين يرد كل مصدر في كل الاستعلامات اللازمة
   *   - `onCopies(fn)`: fn(newCopies) لكل نسخ تصل بعد الأولى
   *   - `onHit(fn)`: fn(hit, {matched, at}) لكل مصدر يرد (للقياس)
   *   - `cancel()`
   */
  return function locate({ key, ready = null, ...input }) {
    // `ready`: معايير الهوية التي تحتاج شبكة (إخوة الاسم وسنواتهم)؛ البحث ينتظرها
    // قبل أول استعلام، والمسار السريع من الذاكرة لا ينتظر شيئًا.
    const criteria = { ...input };
    const started = clock();
    const found = { copies: [], near: [], total: 0, done: false, fast: false, answered: 0, sources: {} };
    const copyListeners = new Set();
    const hitListeners = new Set();
    let resolveFirst;
    let resolveDone;
    const first = new Promise((r) => (resolveFirst = r));
    const done = new Promise((r) => (resolveDone = r));
    let firstSent = false;
    let cancelled = false;
    let current = null;
    const seen = new Map();

    const add = (list) => {
      const known = new Set(found.copies.map(copyKey));
      const fresh = list.filter((c) => !known.has(copyKey(c)));
      if (!fresh.length) return [];
      found.copies.push(...fresh);
      if (!firstSent) {
        firstSent = true;
        resolveFirst(found);
      } else {
        for (const fn of copyListeners) fn(fresh);
      }
      return fresh;
    };

    // المسار السريع: ما نجح لهذا العمل قبلًا يبدأ به التجهيز الآن، والبحث يكمل خلفه
    const remembered = memory?.copies(key);
    if (remembered?.length) {
      found.fast = true;
      add(remembered);
    }

    const finish = () => {
      if (found.done) return;
      found.done = true;
      found.near = near([...seen.values()], criteria);
      if (!firstSent) {
        firstSent = true;
        resolveFirst(found);
      }
      resolveDone(found);
    };

    void (async () => {
      if (ready) Object.assign(criteria, await Promise.resolve(ready).catch(() => null));
      const list = queries(criteria.title, criteria);
      for (let attempt = 0; attempt < 2 && !cancelled; attempt++) {
        let anyAnswer = false;
        for (const query of list) {
          if (cancelled) break;
          let matchedHere = false;
          current = searchStream(query, content, (hit) => {
            if (cancelled) return;
            const at = clock() - started;
            const s = (found.sources[hit.sourceId] ??= { searchMs: null, at: null, items: 0, matched: 0, matchAt: null, error: null, skipped: false });
            s.searchMs = hit.ms ?? s.searchMs;
            s.at ??= at;
            s.items += hit.items?.length ?? 0;
            s.error = hit.error ?? null;
            s.skipped = Boolean(hit.skipped);
            if (!hit.skipped && !hit.error) {
              anyAnswer = true;
              found.answered++;
            }
            for (const c of hit.items ?? []) seen.set(copyKey(c), c);
            found.total = seen.size;
            const matched = add(match(hit.items ?? [], criteria));
            if (matched.length) {
              matchedHere = true;
              s.matched += matched.length;
              s.matchAt ??= at;
            }
            for (const fn of hitListeners) fn(hit, { matched: matched.length, at });
          });
          await current.done;
          current = null;
          // الاستعلام البديل (بلا علامات) لا يُسأل إلا إن لم يطابق الأول شيئًا
          if (matchedHere || found.copies.length > (remembered?.length ?? 0)) break;
        }
        if (cancelled || anyAnswer || found.copies.length > (remembered?.length ?? 0)) break;
        // لم يرد أي مصدر: غالبًا الإضافات تُنزَّل أول مرة — محاولة واحدة بعد لحظات
        await wait(retryDelayMs);
      }
      finish();
    })().catch(() => finish());

    return {
      found,
      criteria,
      /** كل ما ردّت به المصادر (المطابق وغيره) لتتبّع المطابقة. */
      candidates: () => [...seen.values()],
      first,
      done,
      onCopies(fn) {
        copyListeners.add(fn);
        return () => copyListeners.delete(fn);
      },
      onHit(fn) {
        hitListeners.add(fn);
        return () => hitListeners.delete(fn);
      },
      cancel() {
        cancelled = true;
        current?.cancel();
        finish();
      },
    };
  };
}

// ───────────────────────── القياس ─────────────────────────

export const METRICS_KEY = 'vantara.cinema.metrics.v1';

const median = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
};

export function createMetrics(storage = globalThis.localStorage, { clock = Date.now, keep = 40 } = {}) {
  const runs = () => readStore(storage, METRICS_KEY, []);

  /** فتح واحد لعمل: من فتح الصفحة حتى أول تشغيل صالح وما بعده. */
  function start({ key, title, kind }) {
    const t0 = clock();
    const run = {
      key, title, kind, at: t0,
      ttfs: null, // أول نتيجة من أي مصدر
      ttfm: null, // أول نسخة مطابقة
      ttfr: null, // أول سيرفر برابط مستخرج (READY)
      ttfp: null, // أول سيرفر فُحص رابطه ونجح (تشغيل صالح فعلًا)
      fast: false,
      prepareAt: null,
      sources: {},
      routes: {},
    };
    const src = (id) => (run.sources[id] ??= { searchMs: null, at: null, items: 0, matchAt: null, serversMs: null, readyMs: null, playableMs: null, ready: 0, playable: 0, dead: 0, error: null, skipped: false });
    let saved = false;
    const api = {
      run,
      get saved() {
        return saved;
      },
      hit(hit, { matched = 0, at = clock() - t0 } = {}) {
        const s = src(hit.sourceId);
        s.searchMs = hit.ms ?? null;
        s.at ??= at;
        s.items += hit.items?.length ?? 0;
        s.error = hit.error ?? null;
        s.skipped = Boolean(hit.skipped);
        if (hit.items?.length && run.ttfs == null) run.ttfs = at;
        if (matched) {
          s.matchAt ??= at;
          run.ttfm ??= at;
        }
      },
      fastPath() {
        run.fast = true;
        run.ttfm ??= clock() - t0;
      },
      prepared() {
        run.prepareAt ??= clock() - t0;
      },
      route(r) {
        const at = clock() - t0;
        const s = src(r.sourceId);
        // زمن السيرفرات: من بدء التجهيز حتى عرف المصدر قائمة سيرفراته
        if (s.serversMs == null && run.prepareAt != null) s.serversMs = Math.max(0, at - run.prepareAt);
        const prev = run.routes[r.id];
        run.routes[r.id] = { sourceId: r.sourceId, state: r.state, probed: r.probed ?? null };
        if (r.state === 'READY' && prev?.state !== 'READY') {
          s.ready++;
          s.readyMs ??= at;
          run.ttfr ??= at;
        }
        if (r.probed === true && prev?.probed !== true) {
          s.playable++;
          s.playableMs ??= at;
          run.ttfp ??= at;
        }
        if ((r.state === 'UNAVAILABLE' || r.state === 'FAILED') && prev?.state !== r.state) s.dead++;
      },
      /** يُحفظ مرة: عند اكتمال التجهيز أو مغادرة العمل. */
      save() {
        if (saved) return;
        saved = true;
        const list = runs();
        list.unshift(summarize(run));
        writeStore(storage, METRICS_KEY, list.slice(0, keep));
      },
    };
    return api;
  }

  return {
    start,
    runs,
    clear: () => writeStore(storage, METRICS_KEY, []),
    /** لكل مصدر عبر آخر الفتحات: الوسيط والنسب. */
    sources() {
      const by = new Map();
      for (const r of runs()) {
        for (const [id, s] of Object.entries(r.sources ?? {})) {
          const a = by.get(id) ?? { id, runs: 0, answered: 0, matched: 0, playable: 0, skipped: 0, search: [], match: [], servers: [], first: [], ready: 0, good: 0, dead: 0, errors: {} };
          a.runs++;
          if (s.skipped) a.skipped++;
          else if (!s.error) a.answered++;
          if (s.error) a.errors[s.error] = (a.errors[s.error] ?? 0) + 1;
          if (s.matchAt != null) {
            a.matched++;
            a.match.push(s.matchAt);
          }
          if (s.searchMs != null && !s.skipped) a.search.push(s.searchMs);
          if (s.serversMs != null) a.servers.push(s.serversMs);
          if (s.playableMs != null) a.first.push(s.playableMs);
          if (s.playable > 0) a.playable++;
          a.ready += s.ready;
          a.good += s.playable;
          a.dead += s.dead;
          by.set(id, a);
        }
      }
      return [...by.values()]
        .map((a) => ({
          id: a.id,
          runs: a.runs,
          searchMs: median(a.search),
          matchMs: median(a.match),
          serversMs: median(a.servers),
          firstPlayableMs: median(a.first),
          answerRate: a.runs ? a.answered / a.runs : 0,
          matchRate: a.runs ? a.matched / a.runs : 0,
          successRate: a.runs ? a.playable / a.runs : 0,
          skipped: a.skipped,
          playableServers: a.good,
          readyServers: a.ready,
          deadServers: a.dead,
          topError: Object.entries(a.errors).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
        }))
        .sort((x, y) => y.successRate - x.successRate || (x.firstPlayableMs ?? 1e12) - (y.firstPlayableMs ?? 1e12));
    },
  };
}

/** خلاصة الفتح للتخزين: أرقام لا قوائم سيرفرات. */
export function summarize(run) {
  const routes = Object.values(run.routes);
  const playable = routes.filter((r) => r.state === 'READY' && r.probed === true).length;
  const dead = routes.filter((r) => r.state === 'UNAVAILABLE' || r.state === 'FAILED' || r.probed === false).length;
  const sources = Object.fromEntries(Object.entries(run.sources).map(([id, s]) => [id, { ...s }]));
  return {
    key: run.key,
    title: run.title,
    kind: run.kind,
    at: run.at,
    fast: run.fast,
    ttfs: run.ttfs,
    ttfm: run.ttfm,
    ttfr: run.ttfr,
    ttfp: run.ttfp ?? null,
    sourcesOk: Object.values(run.sources).filter((s) => s.playable > 0).length,
    sourcesAsked: Object.values(run.sources).filter((s) => !s.skipped).length,
    servers: routes.length,
    playable,
    failRate: routes.length ? dead / routes.length : null,
    sources,
  };
}
