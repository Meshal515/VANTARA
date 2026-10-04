/**
 * جسر الأنمي والسينما للـPWA: نفس واجهة إضافة `AnimeEngine` الأصلية
 * (`lib/anime-engine.js` يناديها كما هي) — بحث متدفق، جلسات تجهيز بأحداث
 * `route`/`prepared`، أفضل سيرفر، ومشغّل ويب بدل المشغّل الأصلي.
 *
 * الطرق (routes) نفس شكل `Route` في الـAPK:
 *   { id, sourceId, server, code, quality, variant, state, candidates, reason }
 * والمرشّح (candidate) رابط فيديو جاهز من سيرفر: { id, url, type, referer, quality, … }.
 */

import { runProgressive } from '../../addons/scheduler.js';
import { candidatePaths } from '../../addons/media.js';
import { discoverHlsVariants } from '../sources/hls-variants.js';
import { getRuntime } from '../runtime.js';
import { supports } from '../../lib/capabilities.js';

/** القسم مفعّل في الويب؟ (مفاتيح الميزات في lib/release.js) */
const sectionOn = (content) => (content === 'cinema' ? supports('pwaCinema') : supports('animeWebSources'));
const sourcesOf = r => r.addons?.sources ?? r.registry;
const videoDefs = (r, content = null) => sourcesOf(r).list(content).filter((d) => d.content !== 'manga' && sectionOn(d.content));

const listeners = new Map();
function emit(event, data) {
  for (const fn of listeners.get(event) ?? []) {
    try {
      fn(data);
    } catch {
      // مستمع معطوب لا يوقف الباقين
    }
  }
}

const rid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** رموز ثابتة للسيرفرات (نفس `ServerCodes` في الـAPK): الواجهة تعرض الرمز لا اسم الاستضافة. */
const KNOWN = {
  hgcloud: 'HGC', streamhg: 'HGC', streamwish: 'SWH', mp4upload: 'MPU', google: 'GDR', drive: 'GDR', ok: 'OKR', 'ok.ru': 'OKR', okru: 'OKR',
  videa: 'VDA', '4shared': 'FSH', yonaplay: 'YNP', vk: 'VKV', megamax: 'MMX', streamruby: 'RBY', rubyvid: 'RBY', uqload: 'UQL', earnvids: 'EVD',
  lulustream: 'LLS', mixdrop: 'MXD', krakenfiles: 'KRK', voe: 'VOE', dood: 'DDS', doodstream: 'DDS', filemoon: 'FMN', mega: 'MEG', sendvid: 'SVD', myseed: 'MSD',
};
export function codeOf(name) {
  const n = String(name ?? '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();
  for (const word of [n.replace(/\s+/g, ''), ...n.split(' ')]) if (KNOWN[word]) return KNOWN[word];
  for (const [k, v] of Object.entries(KNOWN)) if (n.includes(k)) return v;
  const letters = n.replace(/[^a-z]/g, '').toUpperCase();
  return (letters.slice(0, 3) || 'SRV').padEnd(3, 'X');
}

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

async function rt() {
  const r = getRuntime();
  await r.ready;
  await r.addons?.ready;
  return r;
}

// ───────────────────────── البحث ─────────────────────────

async function searchSource(r, def, query) {
  const { value } = await r.store.cached('source', `${def.id}${def.manifest ? `@${def.manifest.version}@${def.manifest.cacheEpoch ?? "legacy-v2"}` : ""}|vsearch|${fold(query)}`, () => sourcesOf(r).call(def.id, (src) => src.search(query)), { ttlMs: 30 * 60 * 1000 });
  return (value ?? []).map((it) => ({ ...it, sourceId: def.id }));
}

const searches = new Map();

// ───────────────────────── الجلسات ─────────────────────────

const sessions = new Map();

function snapshot(s) {
  return { copies: [...s.effectiveCopies], routes: [...s.routes.values()].map((r) => ({ ...r })), done: s.done, retryAt: 0 };
}

function upsert(s, route) {
  s.routes.set(route.id, route);
  if (!s.closed) emit('route', { session: s.id, retryAt: 0, route: { ...route } });
  for (const w of s.waiters.splice(0)) w();
}

async function episodesOf(r, copy, signal) {
  const cacheKey=copy.sourceId.startsWith("addon|") ? JSON.stringify([copy.sourceId,sourcesOf(r).def(copy.sourceId)?.manifest?.version,sourcesOf(r).def(copy.sourceId)?.manifest?.cacheEpoch ?? "legacy-v2",copy.url,copy.type,copy.requestedSeason,copy.episode,copy.memo]) : `${copy.sourceId}|episodes|${copy.url}`;
  const { value } = await r.store.cached('meta', cacheKey, () => sourcesOf(r).call(copy.sourceId, (src) => src.episodes(copy, { signal })), { ttlMs: 30 * 60 * 1000 });
  return value ?? [];
}

/** مرشحون مرتّبون: الجودة الأقرب للمطلوبة (والأعلى عند التعادل). */
function rank(s, list) {
  const want = s.quality ?? 1080;
  return [...list].sort((a, b) => Math.abs((a.quality ?? want) - want) - Math.abs((b.quality ?? want) - want) || (b.quality ?? 0) - (a.quality ?? 0));
}

async function runCopy(r, s, copy, episode) {
  const source = sourcesOf(r).source(copy.sourceId);
  const def = sourcesOf(r).def(copy.sourceId);
  if (!source || !def) return;
  let eps;
  try {
    eps = await episodesOf(r, copy, s.controller.signal);
  } catch {
    return;
  }
  // فيلم: السينما تطلب الحلقة -1 (نفس عقد الـAPK) ⇒ الصفحة نفسها
  const ep = Number(episode) < 0
    ? eps[0] ?? null
    : (() => {
      const numbered = eps.filter(e => Number(e.number) === Number(episode));
      const matches = copy.requestedSeason == null ? numbered : numbered.filter(e => e.season == null || Number(e.season) === Number(copy.requestedSeason));
      return matches.length === 1 ? matches[0] : null;
    })();
  if (!ep || s.closed) return;
  let servers;
  try {
    servers = await sourcesOf(r).call(copy.sourceId, (src) => src.servers(ep));
  } catch {
    return;
  }
  const routes = servers.map((sv) => ({
    id: `${copy.sourceId}|${sv.key}`,
    sourceId: copy.sourceId,
    server: sv.name,
    code: codeOf(sv.name),
    quality: sv.quality ?? null,
    variant: sv.variant ?? 'SUB',
    state: sv.unsupported ? 'UNAVAILABLE' : 'RESOLVING',
    candidates: [],
    reason: sv.unsupported ? 'غير مدعوم في نسخة الويب' : null,
  }));
  routes.forEach((route) => upsert(s, route));
  const work = servers
    .map((sv, i) => ({ sv, route: routes[i] }))
    .filter((x) => !x.sv.unsupported)
    .sort((a, b) => Number(b.sv.name === s.preferredServer && copy.sourceId === s.preferredSourceId) - Number(a.sv.name === s.preferredServer && copy.sourceId === s.preferredSourceId));
  // ثلاثة سيرفرات معًا لكل مصدر: سريع، ولا يُغرق الموقع
  let next = 0;
  const worker = async () => {
    while (next < work.length && !s.closed) {
      const { sv, route } = work[next++];
      const qualities = new Map();
      const seen = new Map();
      const masters = new Set();
      let nextCandidate = 0;
      let rejectedReason = null;
      const publications = [];
      let accepting = true;
      const publish = async (streams) => {
        const fresh = [];
        for (const st of streams ?? []) {
          if ((st?.addonKey || copy.sourceId.startsWith("addon|")) && ((st?.status && st.status !== "RESOLVED") || st?.type === "dash" || (st?.expiresAt && st.expiresAt <= Date.now()))) {
            rejectedReason = st.reason ?? (st.type === "dash" ? "DASH غير مدعوم في مشغل PWA الحالي" : st.status ?? "EXPIRED");
            continue;
          }
          if (!st?.url || !/^https?:\/\//i.test(st.url)) continue;
          const quality = st.quality ?? sv.quality ?? null;
          if (!qualities.has(quality)) {
            const qr = { ...route, id: qualities.size ? `${route.id}|q${quality ?? 'auto'}` : route.id, quality };
            qualities.set(quality, qr);
            upsert(s, qr);
          }
          const qr = qualities.get(quality);
          const key = `${quality}|${st.url}`;
          if (seen.has(key)) continue;
          const id = `${route.id}|c${nextCandidate++}`;
          seen.set(key, id);
          s.cands.set(id, { id, sourceId: copy.sourceId, sourceName: def.label, server: sv.name, code: qr.code, route: qr.id, url: st.url, referer: st.referer ?? null, type: st.type, quality, variant: qr.variant, subtitles: st.subtitles ?? [], audio: st.audio ?? [], identity: st.identity ?? { ...copy.identity, externalIds: copy.externalIds, kind: copy.type ?? (def.content === "anime" ? "anime" : undefined), season: ep.season ?? copy.requestedSeason, episode: ep.number }, addonKey: st.addonKey ?? null, filename: st.filename ?? null, videoHash: st.videoHash ?? null, videoSize: st.videoSize ?? null, duration: st.duration ?? null, fps: st.fps ?? null, expiresAt: st.expiresAt ?? null });
          fresh.push({ id, qr });
          if (st.type === 'hls' && st.qualitySource !== 'hls-master' && r.fetcher.ensureGrant && !masters.has(st.url)) {
            masters.add(st.url);
            publications.push(discoverHlsVariants(st, r.fetcher, { signal: s.controller.signal }).then((variants) => {
              if (!s.closed) return publish(variants);
            }).catch(() => {}));
          }
        }
        // Publish each verified quality separately; slower qualities keep resolving.
        await Promise.all(fresh.map(async ({ id, qr }) => {
          const t0 = Date.now();
          const verdict = await probeCandidate(r, s.cands.get(id));
          if (s.closed) return;
          const old = s.routes.get(qr.id) ?? qr;
          const candidates = verdict.ok === false ? old.candidates : [...new Set([...old.candidates, id])];
          const good = candidates.length > 0;
          upsert(s, { ...old, state: good ? 'READY' : 'UNAVAILABLE', candidates,
            probed: old.probed === true || verdict.ok === true ? true : good ? null : false,
            probeMs: Date.now() - t0, reason: good ? null : verdict.reason });
        }));
      };
      const accept = (streams) => { if (accepting && !s.closed) publications.push(publish(streams)); };
      let timer;
      try {
        const streams = await Promise.race([
          source.streams(sv, accept, { signal: s.controller.signal }),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('لم يرد خلال 45 ثانية')), 45_000); }),
        ]);
        accept(streams);
        accepting = false;
        await Promise.all(publications);
        if (!qualities.size) upsert(s, { ...route, state: 'UNAVAILABLE', reason: rejectedReason ?? 'RESOLVER_EMPTY: لم يُستخرج رابط فيديو' });
      } catch (error) {
        accepting = false;
        await Promise.all(publications);
        if (!qualities.size) upsert(s, { ...route, state: 'UNAVAILABLE', reason: String(error?.message ?? error) });
        for (const qr of qualities.values()) {
          const old = s.routes.get(qr.id);
          if (old?.state === 'RESOLVING') upsert(s, { ...old, state: 'UNAVAILABLE', reason: String(error?.message ?? error) });
        }
      } finally { clearTimeout(timer); }

    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

/** أصغر من هذا لا يكون حلقة أو فيلمًا: مقطع «غير متاح» من المضيف (Sendvid ~ مئات الكيلوبايت). */
export const MIN_REAL_BYTES = 3 * 1024 * 1024;

/**
 * حكم رابط واحد من أول بايتين عبر الجالب:
 *   true  وسائط حقيقية (أو قائمة HLS)
 *   false صفحة أو خطأ أو ملف أصغر من حلقة (مقطع بديل)، مع السبب
 *   null  لا حكم (بطء أو انقطاع الفحص): لا يُحجب الرابط
 */
export async function probeCandidate(r, c, { timeoutMs = 8000, fetchImpl = fetch } = {}) {
  try {
    const paths = await candidatePaths(c,r,{requireGrant:true});
    const res = await fetchImpl(paths.at(-1)[1], { credentials:"omit", referrerPolicy:"no-referrer", headers: { range: 'bytes=0-1' }, signal: AbortSignal.timeout(timeoutMs) });
    const type = res.headers.get('content-type') ?? '';
    void res.body?.cancel?.().catch?.(() => {});
    const hls = /mpegurl/i.test(type) || /\.m3u8/.test(c.url);
    if (!res.ok) return { ok: false, reason: `المضيف ردّ ${res.status}` };
    if (/text\/html|application\/json/i.test(type)) return { ok: false, reason: 'المضيف ردّ بصفحة لا فيديو' };
    if (!hls && !/video|octet-stream|mp2t/i.test(type)) return { ok: false, reason: 'المضيف ردّ بصفحة لا فيديو' };
    const total = Number(/\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')?.[1] ?? NaN);
    if (!hls && Number.isFinite(total) && total < MIN_REAL_BYTES) return { ok: false, reason: 'مقطع بديل من المضيف (الفيديو غير متاح عنده)' };
    return { ok: true, reason: null };
  } catch {
    return { ok: null, reason: null };
  }
}

async function startCopies(r, s, copies) {
  const fresh = copies.filter((c) => c?.sourceId && !s.copies.has(`${c.sourceId}|${c.url}`));
  for (const c of fresh) { s.copies.add(`${c.sourceId}|${c.url}`); s.effectiveCopies.push(c); }
  s.running += 1;
  await Promise.all([
    ...fresh.filter(c => !c.sourceId.startsWith('addon|')).map(c => runCopy(r, s, c, s.episode)),
    runProgressive(fresh.filter(c => c.sourceId.startsWith('addon|')).map(c => ({ origin: sourcesOf(r).def(c.sourceId)?.domain, run: () => runCopy(r, s, c, s.episode) })), { signal: s.controller.signal }),
  ]);
  s.running -= 1;
  if (s.running === 0 && !s.closed) {
    s.done = true;
    emit('prepared', { session: s.id, retryAt: 0 });
    for (const w of s.waiters.splice(0)) w();
  }
  return fresh.length;
}

function readyCandidates(s, prefer = null) {
  const ready = [...s.routes.values()].filter((r) => r.state === 'READY');
  const ordered = ready.sort((a, b) => Number(b.code === prefer) - Number(a.code === prefer));
  const out = [];
  for (const route of ordered) out.push(...rank(s, route.candidates.map((id) => s.cands.get(id)).filter(Boolean)));
  return prefer ? out : rank(s, out);
}

// ───────────────────────── الإضافة ─────────────────────────

export const AnimeEngine = {
  async configure() {
    return { ok: true, errors: [] };
  },

  async sources() {
    const r = await rt();
    return {
      sources: videoDefs(r).map((d) => ({
        id: d.id, name: d.label, content: d.content, enabled: true, disabledReason: null, loadError: null, domain: d.domain, catalog: null, web: true,
      })),
    };
  },

  async health() {
    const r = await rt();
    const status = r.registry.status();
    return {
      records: Object.entries(status)
        .filter(([id]) => sourcesOf(r).def(id)?.content !== 'manga')
        .map(([id, rec]) => ({ key: `source:${id}`, ok: rec.health?.ok ?? 0, fail: rec.health?.fail ?? 0, lastOk: rec.health?.lastOk ?? 0, lastError: rec.health?.lastError ?? null, blockedUntil: rec.health?.coolUntil ?? 0, domain: rec.stable?.def?.domain ?? null })),
    };
  },

  async unblock() {},

  async verify() {
    return { ok: false, error: 'التحقق اليدوي غير متاح في نسخة الويب' };
  },

  async diagnose({ sourceId, query = 'naruto' }) {
    const r = await rt();
    const steps = [];
    const step = async (label, fn) => {
      const t0 = Date.now();
      try {
        const detail = await fn();
        steps.push({ label, state: 'ok', detail: `${detail} · ${Date.now() - t0}ms` });
        return true;
      } catch (e) {
        steps.push({ label, state: 'fail', detail: e?.message ?? String(e) });
        return false;
      }
    };
    const src = sourcesOf(r).source(sourceId);
    if (!src) return { steps: [{ label: 'المصدر', state: 'fail', detail: 'غير متاح في نسخة الويب' }] };
    let items = [];
    let eps = [];
    let servers = [];
    if (await step(`بحث «${query}»`, async () => `${(items = await src.search(query)).length} نتيجة`)) {
      if (items[0] && await step(`حلقات «${items[0].title}»`, async () => `${(eps = await src.episodes(items[0])).length} حلقة`)) {
        if (eps[0] && await step('السيرفرات', async () => `${(servers = await src.servers(eps[0])).length} سيرفر`)) {
          let firstReadyMs = null;
          const started = Date.now();
          await Promise.all(servers.map((sv) => step(`تشغيل ${sv.name}`, async () => {
            const host = (() => { try { return new URL(sv.data?.url ?? sv.data?.link ?? sv.data?.watch).hostname; } catch { return 'غير معروف'; } })();
            const list = await src.streams(sv);
            if (!list?.length) throw new Error(`RESOLVER_EMPTY · 0 رابط · host=${host} · ${Date.now() - started}ms`);
            const verdicts = await Promise.all(list.map((st) => probeCandidate(r, st)));
            const usable = list.filter((_st, i) => verdicts[i].ok === true);
            if (!usable.length) throw new Error(`${verdicts.some((v) => v.ok === null) ? 'VERIFICATION_LIMITED' : 'STREAM_INVALID'} · host=${host} · ${verdicts.map((v) => v.reason).filter(Boolean).join(' | ')}`);
            firstReadyMs ??= Date.now() - started;
            return `${usable.length} رابط صالح · host=${host} · resolver=${sourcesOf(r).def(sourceId)?.engine ?? 'host'} · quality=${usable.map((st) => st.quality ?? sv.quality ?? 'auto').join('/')} · actual=${usable.map((st) => { try { return new URL(st.url).hostname; } catch { return 'invalid'; } }).join(',')} · IP family=unknown (edge) `;
          })));
          steps.push({ label: 'أول سيرفر Ready', state: firstReadyMs == null ? 'fail' : 'ok', detail: firstReadyMs == null ? 'لم يثبت رابط صالح' : `${firstReadyMs}ms` });
          steps.push({ label: 'اكتمال فحص السيرفرات', state: 'ok', detail: `${Date.now() - started}ms · NO autoplay · اختيار السيرفر والجودة بيد المستخدم` });
        }
      }
    }
    return { steps };
  },

  async search({ query, content = 'anime' }) {
    const r = await rt();
    const defs = videoDefs(r, content).filter(d => d.engine !== "remote-addon");
    const lists = await Promise.all(defs.map((d) => searchSource(r, d, query).catch(() => [])));
    const works = new Map();
    for (const it of lists.flat()) {
      const key = fold(it.title);
      const w = works.get(key) ?? { key, title: it.title, thumbnail: it.thumbnail ?? null, copies: [] };
      if (!w.copies.some((c) => c.sourceId === it.sourceId)) w.copies.push(it);
      w.thumbnail ??= it.thumbnail ?? null;
      works.set(key, w);
    }
    return { works: [...works.values()] };
  },

  async searchStream({ query, content = 'anime', searchId = rid('q'), timeoutMs = 25_000 }) {
    const r = await rt();
    const job = { cancelled: false };
    searches.set(searchId, job);
    void (async () => {
      await Promise.all(
        videoDefs(r, content).filter(d => d.engine !== 'remote-addon').map(async (def) => {
          const t0 = Date.now();
          if (r.registry.cooling(def.id)) {
            if (!job.cancelled) emit('searchHit', { searchId, sourceId: def.id, ms: 0, items: [], error: 'يرتاح بعد أعطال', skipped: true, needsHuman: false });
            return;
          }
          let items = [];
          let error = null;
          let needsHuman = false;
          try {
            items = await Promise.race([searchSource(r, def, query), new Promise((_, rej) => setTimeout(() => rej(new Error('لم يرد في الوقت')), timeoutMs))]);
          } catch (e) {
            error = e?.message ?? String(e);
            needsHuman = e?.code === 'challenge' && e?.challenge === 'interactive';
          }
          if (!job.cancelled) emit('searchHit', { searchId, sourceId: def.id, ms: Date.now() - t0, items, error, skipped: false, needsHuman });
        }),
      );
      searches.delete(searchId);
      emit('searchDone', { searchId });
    })();
    return { searchId };
  },

  async cancelSearch({ searchId }) {
    const job = searches.get(searchId);
    if (job) job.cancelled = true;
  },

  async details({ anime }) {
    return { anime };
  },

  async episodes({ anime }) {
    const r = await rt();
    return { episodes: await episodesOf(r, anime) };
  },

  async prepare({ copies, episode, quality = 1080, variant = 'SUB', preferredSourceId = null, preferredServer = null, session = null, probe = false }) {
    const r = await rt();
    const id = session ?? rid('s');
    const s = { id, episode: Number(episode), quality, variant, probe: Boolean(probe), preferredSourceId, preferredServer, routes: new Map(), cands: new Map(), copies: new Set(), effectiveCopies: [], done: false, closed: false, running: 0, waiters: [], controller: new AbortController(), addonSnapshot: r.addons?.registry.snapshot() };
    sessions.set(id, s);
    const ordered = preferredSourceId ? [...copies].sort((a, b) => Number(b.sourceId === preferredSourceId) - Number(a.sourceId === preferredSourceId)) : copies;
    void startCopies(r, s, ordered ?? []);
    return { session: id, ...snapshot(s) };
  },

  async extend({ session, copies }) {
    const s = sessions.get(session);
    if (!s || s.closed) return { added: 0 };
    const r = await rt();
    s.done = false;
    return { added: await startCopies(r, s, copies ?? []) };
  },

  async routes({ session }) {
    const s = sessions.get(session);
    return s ? snapshot(s) : { routes: [], done: true, retryAt: 0 };
  },

  async best({ session, prefer = null, waitMs = 45_000 }) {
    const s = sessions.get(session);
    if (!s) throw new Error('الجلسة انتهت');
    const until = Date.now() + waitMs;
    while (!readyCandidates(s, prefer).length && !s.done && Date.now() < until) {
      await new Promise((resolve) => {
        s.waiters.push(resolve);
        setTimeout(resolve, 1000);
      });
    }
    const c = readyCandidates(s, prefer)[0] ?? null;
    return { candidate: c?.id ?? null, route: c?.route ?? null, code: c?.code ?? null };
  },

  async pick({ session, route }) {
    const s = sessions.get(session);
    if (!s) throw new Error('الجلسة انتهت');
    const r = s.routes.get(route);
    return { candidate: rank(s, (r?.candidates ?? []).map((id) => s.cands.get(id)).filter(Boolean))[0]?.id ?? null };
  },

  async play(args) {
    const s = sessions.get(args.session);
    if (!s) throw new Error('الجلسة انتهت، افتحها من جديد');
    const r = await rt();
    const { openPlayer } = await import('../player/player.js');
    openPlayer({ ...args, runtime: r, engine: AnimeEngine, sessionOf: (id) => sessions.get(id), readyCandidates, emit });
  },

  async closeSession({ session }) {
    const s = sessions.get(session);
    if (s) {
      s.closed = true;
      s.controller.abort();
      s.addonSnapshot?.release();
      sessions.delete(session);
    }
  },

  async outbox() {
    return { items: [] };
  },

  async crawl() {},
  async stopCrawl() {},

  addListener(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return { remove: async () => listeners.get(event)?.delete(fn) };
  },
};
