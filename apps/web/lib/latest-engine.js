/**
 * محرك «آخر التحديثات» المحلي (خطة 27 نوفمبر، المرحلة 5): الجدولة والكاشف. قرار المالك: **لا جلب أعمى**.
 *
 * الدورة:
 * 1. لكل مصدر مثبت ومفعّل: **طلب واحد** لصفحة «الأحدث» الأولى. 12 بالتوازي، ومضيفان كحد لكل موقع.
 * 2. مقارنة بلقطته السابقة: يستحق الفحص فقط ما ظهر جديدًا، أو صعد في الترتيب، أو كان من أعلى K (عمل يبقى أولًا
 *    وينزل له فصل). صفحة مطابقة حرفيًا لسابقتها: أعلى K فقط.
 * 3. أول دورة لمصدر (لا لقطة سابقة): خط أساس فقط، بلا أي طلب فصول وبلا أي حدث.
 * 4. الفحص بميزانية ثابتة للدورة بالأولوية (جديد ← صاعد ← أعلى القائمة). ما لا تسعه الميزانية يُرحَّل للدورة التالية ولا يضيع.
 * 5. **الكشف مرة ثم الانتشار:** وحدة جديدة فعلًا تُنشئ الحدث، ثم تُجلب فصول **هذا العمل وحده** من المصادر الأخرى
 *    المثبتة التي يظهر فيها، مرة واحدة، لتُضاف خيارات قراءة. لا شيء آخر يُطلب.
 *
 * القرار: وحدة فوق خط أساس العمل وفوق خط أساس المصدر نفسه وضمن حد القفزة (`JUMP`). مصدر يرى العمل أول مرة خط أساس
 * له بلا أحداث (لحاق مصدر أكمل ليس فصولًا جديدة). هوية الحدث `eventId` المشتركة، فتندمج بالمهاجَر بلا تكرار.
 * ما لا تُعرف هويته لا ينشئ حدثًا (التكرار أسوأ من التأخير).
 */
import { JUMP, decide, eventId, isAbove } from './update-decision.js';

const RECENT_MS = 7 * 86_400_000;
const unitKey = (u) => `${u.season ?? 0}:${u.number}`;

/** تجمّع بحد عام وحد لكل مضيف: كلما انتهى عمل دخل التالي الذي يسمح به مضيفه. */
export async function runPool(jobs, { concurrency = 12, perHost = 2 } = {}) {
  const queue = [...jobs], hosts = new Map(); let active = 0;
  return new Promise((resolve) => {
    const pump = () => {
      if (!queue.length && !active) { resolve(); return; }
      for (let i = 0; i < queue.length && active < concurrency; ) {
        const job = queue[i], h = job.host ?? `\u0000${i}${job.key ?? ''}`;
        if ((hosts.get(h) ?? 0) >= perHost) { i++; continue; }
        queue.splice(i, 1); active++; hosts.set(h, (hosts.get(h) ?? 0) + 1);
        Promise.resolve().then(job.run).catch(() => {}).finally(() => { active--; hosts.set(h, hosts.get(h) - 1); pump(); });
      }
    };
    pump();
  });
}

const withTimeout = (p, ms) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(Object.assign(new Error('انتهت مهلة المصدر'), { code: 'SOURCE_TIMEOUT' })), ms); Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); }); });

export function createLatestEngine({
  store, providers, identify, allow = () => true, now = () => Date.now(),
  concurrency = 12, perHost = 2, topK = 3, unitBudget = 60, fanOut = 4, timeoutMs = 20_000,
}) {
  let running = null;

  async function snapshotOf(key) { return (await store.getSnapshot(`latest:${key}`))?.payload ?? null; }

  /** يقرر وحدات عمل من مصدر واحد ويكتب الحدث وخطوط الأساس. يرجع الأحداث الجديدة. */
  async function decideUnits(p, item, work, units, stats) {
    if (!units.length) return [];
    const kind = p.section === 'manga' ? 'chapter' : 'episode', limit = JUMP[kind];
    const sorted = [...units].sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || a.number - b.number);
    const top = sorted[sorted.length - 1], t = now();
    const [mark] = await store.getMarks([work]);
    const srcMark = (await store.getSourceMarks(work)).find((m) => m.sourceId === p.key);
    const raise = async (unit, { work: w = true, source = true } = {}) => {
      const m = { season: unit.season ?? null, number: unit.number };
      if (w && (!mark || isAbove(m, mark))) await store.putMarks([{ work, section: p.section, ...m, baselineAt: mark?.baselineAt ?? t, updatedAt: t }]);
      if (source && (!srcMark || isAbove(m, srcMark))) await store.putSourceMarks([{ work, sourceId: p.key, ...m, updatedAt: t }]);
    };
    // أول مرة يرى هذا المصدر هذا العمل: خط أساس بلا أحداث. الخط من decide المشترك فيرفض الرقم الشاذ (UP1)
    if (!srcMark || !mark) {
      const first = decide({ kind, units: sorted.map((u) => ({ season: u.season ?? null, number: u.number, publishedAt: null })) }, null).mark;
      await raise(first, { work: !mark }); stats.baselined++; return [];
    }
    const base = isAbove(srcMark, mark) ? srcMark : mark;
    const fresh = sorted.filter((u) => isAbove(u, base) && (((u.season ?? 0) > (base.season ?? 0)) ? (u.season ?? 0) === (base.season ?? 0) + 1 && u.number <= limit : u.number - base.number <= limit));
    if (!fresh.length) {
      // لحاق مصدر متأخر حتى خط العمل يرفع خطه هو؛ رقم فوق الحد شاذ لا يرفع شيئًا
      if (!isAbove(top, mark)) await raise(top, { work: false });
      return [];
    }
    const events = fresh.map((u) => {
      const trusted = Number.isFinite(u.publishedAt) && u.publishedAt <= t && t - u.publishedAt <= RECENT_MS;
      const at = trusted ? u.publishedAt : t;
      return { id: eventId(work, kind, u.season ?? null, u.number), work, section: p.section, kind, season: u.season ?? null, number: u.number, title: item.title, cover: item.cover ?? null, at, publishedAt: trusted ? u.publishedAt : null, firstSeenAt: t, observedAdvance: true, sources: [{ s: p.key, ...(item.url ? { u: item.url } : {}), t: item.title }] };
    });
    await store.putEvents(events, { origin: 'local' });
    await raise(fresh[fresh.length - 1]);
    stats.events += events.length;
    return events;
  }

  async function check(p, item, all, stats, seen) {
    if (!allow(p, item)) { stats.skipped++; return; }
    const work = await identify(p, item);
    if (!work) { stats.unidentified++; return; }
    // العمل الواحد يُفحص مرة في الدورة: مصادره الأخرى يغطيها الانتشار (فحصان متوازيان كانا يطرقان الموقعين ويكرران القرار)
    if (seen.has(work)) { stats.deduped++; return; }
    seen.add(work);
    stats.unitCalls++;
    const units = await withTimeout(p.units(item.ref), timeoutMs);
    const created = await decideUnits(p, item, work, units, stats);
    if (!created.length) return;
    // الكشف مرة ثم الانتشار: فصول هذا العمل وحده من مصادره الأخرى المثبتة، مرة واحدة
    const peers = all.filter((q) => q !== p && q.section === p.section && q.snapshot?.items?.some((x) => x.title && x.ref && identityKey(x.title) === identityKey(item.title))).slice(0, fanOut);
    for (const q of peers) {
      const hit = q.snapshot.items.find((x) => identityKey(x.title) === identityKey(item.title));
      if (!allow(q, hit)) continue;
      try {
        stats.unitCalls++; stats.fanOut++;
        const units = await withTimeout(q.units(hit.ref), timeoutMs);
        const have = new Set(units.map(unitKey));
        // خط أساس هذا المصدر يرتفع لما رآه، فلا يعيد فحصه نفس الوحدات كأنها جديدة
        const peerTop = created.filter((e) => have.has(`${e.season ?? 0}:${e.number}`)).at(-1);
        if (peerTop) { const old = (await store.getSourceMarks(peerTop.work)).find((m) => m.sourceId === q.key); const m = { season: peerTop.season, number: peerTop.number }; if (!old || isAbove(m, old)) await store.putSourceMarks([{ work: peerTop.work, sourceId: q.key, ...m, updatedAt: now() }]); }
        const add = created.filter((e) => have.has(`${e.season ?? 0}:${e.number}`)).map((e) => ({ ...e, sources: [{ s: q.key, ...(hit.url ? { u: hit.url } : {}), t: hit.title }] }));
        if (add.length) await store.putEvents(add, { origin: 'local' });
      } catch { stats.errors++; }
    }
  }

  const identityKey = (title) => String(title ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

  /** دورة واحدة كاملة. ترجع إحصاءها (عدد الطلبات بالضبط لإثبات الحد). */
  async function runCycle() {
    const seen = new Set();
    const stats = { deduped: 0, providers: 0, latestCalls: 0, unitCalls: 0, fanOut: 0, events: 0, baselined: 0, firstSeen: 0, skipped: 0, unidentified: 0, errors: 0, carried: 0 };
    const list = await providers();
    stats.providers = list.length;
    const candidates = [];
    await runPool(list.map((p) => ({
      key: p.key, host: p.host,
      run: async () => {
        stats.latestCalls++;
        let page;
        try { page = await withTimeout(p.latest(1), timeoutMs); } catch { stats.errors++; return; }
        const items = (page?.items ?? []).filter((x) => x?.url && x?.title);
        const prev = await snapshotOf(p.key);
        p.snapshot = { items: items.map(({ ref, title, url, cover }) => ({ ref, title, url, cover })) };
        await store.putSnapshots([{ sourceId: `latest:${p.key}`, payload: p.snapshot, fetchedAt: now() }]);
        if (!prev) { stats.firstSeen++; return; } // أول دورة للمصدر: خط أساس فقط
        const before = new Map((prev.items ?? []).map((x, i) => [x.url, i]));
        const same = before.size === items.length && items.every((x, i) => before.get(x.url) === i);
        items.forEach((item, i) => {
          const was = before.get(item.url);
          const priority = !same && was == null ? 0 : !same && was > i ? 1 : i < topK ? 2 : null;
          if (priority != null) candidates.push({ p, item, priority, rank: i });
        });
      },
    })), { concurrency, perHost });
    // ما رُحّل من الدورة السابقة يتقدم على مثله
    const carried = (await store.getMeta('engine.carry')) ?? [];
    for (const c of carried) { const p = list.find((x) => x.key === c.key); const item = p?.snapshot?.items.find((x) => x.url === c.url); if (p && item && !candidates.some((x) => x.p === p && x.item.url === item.url)) candidates.push({ p, item, priority: c.priority, rank: -1 }); }
    candidates.sort((a, b) => a.priority - b.priority || a.rank - b.rank);
    const now_ = candidates.slice(0, unitBudget), later = candidates.slice(unitBudget);
    await store.setMeta('engine.carry', later.map((c) => ({ key: c.p.key, url: c.item.url, priority: c.priority })));
    stats.carried = later.length;
    await runPool(now_.map((c) => ({ key: `${c.p.key}|${c.item.url}`, host: c.p.host, run: () => check(c.p, c.item, list, stats, seen).catch(() => { stats.errors++; }) })), { concurrency, perHost });
    await store.setMeta('engine.lastCycle', { at: now(), ...stats });
    return stats;
  }

  return {
    runCycle: () => (running ??= runCycle().finally(() => { running = null; })),
    get running() { return Boolean(running); },
  };
}
