/** Local Debug evidence only: bounded, never persisted or sent to analytics. */
let enabled = false;
let sequence = 0;
const traces = new Map();
export const isDiscoveryDebug = () => enabled;
export function setDiscoveryDebug(value) {
  enabled = value === true;
  if (!enabled) traces.clear();
}
const cleanText = value => String(value).replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
  .replace(/\b(?:authorization|cookie|set-cookie)\s*[:=][^\r\n]+/gi, '[redacted header]')
  .replace(/(?:bearer\s+|(?:token|cookie|password|credential|authorization)\s*[:=]\s*)[^\s,;]+/gi, '[redacted]').slice(0, 1600);
function clean(value, depth = 0) {
  if (depth > 5 || value == null) return null;
  if (value instanceof Error) {
    const seen = new Set(); let root = value;
    while (root?.cause && !seen.has(root.cause) && seen.size < 32) { seen.add(root); root = root.cause; }
    return clean({ type: value.name, message: value.message, code: value.code,
      rootCause: { type: root?.name, message: root?.message, code: root?.code },
      data: value.data, cause: value.cause, stack: value.stack }, depth + 1);
  }
  if (typeof value === 'string') return cleanText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 64).map(v => clean(v, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 24)
    .filter(([key]) => !/token|cookie|authorization|credential|password/i.test(key)).map(([key, v]) => [key, clean(v, depth + 1)]));
  return cleanText(value);
}
export function beginDiscovery(meta = {}) {
  const row = { id: `discovery-${++sequence}`, ...clean(meta), startedAt: Date.now(), droppedEvents: 0, events: [] };
  return { id: row.id, record(stage, data = {}) {
    if (!enabled) return;
    if (!traces.has(row.id)) {
      traces.set(row.id, row);
      while (traces.size > 24) traces.delete(traces.keys().next().value);
    }
    row.events.push({ ...clean(data), stage: cleanText(stage), at: Date.now() });
    if (row.events.length > 200) { row.droppedEvents += row.events.length - 200; row.events.splice(0, row.events.length - 200); }
  } };
}
export function discoveryDiagnostics(workId) {
  return enabled ? structuredClone([...traces.values()].filter(t => workId == null || String(t.workId) === String(workId))) : [];
}

const errText = (e) => (e == null ? '' : typeof e === 'string' ? e
  : [e.code, e.message ?? e.type, e.rootCause?.message && e.rootCause.message !== e.message ? `← ${e.rootCause.message}` : null].filter(Boolean).join(' ')).slice(0, 160);
const tally = (values) => Object.entries(values.reduce((m, v) => ({ ...m, [v]: (m[v] ?? 0) + 1 }), {}))
  .sort((a, b) => b[1] - a[1]).map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join('، ');

/**
 * ملخص قصير يُنسخ ويُلصق: سطر لكل مصدر (هل سُئل، ماذا ردّ، ماذا قُبل ولماذا رُفض)، ثم ورقة السيرفرات (لكل مصدر
 * الجاهز وأسباب غير المتاح). الكامل يبقى في JSON للحالات النادرة.
 */
export function summarizeDiscovery(trace, { sheet = null, nameOf = (id) => id } = {}) {
  if (!trace && !sheet) return 'لا سجل لهذا العمل: فعّل «إظهار التشخيصات» ثم افتح العمل من جديد.';
  const ev = trace?.events ?? [];
  const has = (stage) => ev.some((e) => e.stage === stage);
  const lines = [];
  if (trace) {
    const took = ev.length ? Math.round((ev.at(-1).at - trace.startedAt) / 1000) : 0;
    lines.push(`VANTARA · تشخيص · ${trace.title ?? trace.workId} · ${trace.format ?? '?'} · ${trace.entry ?? '?'} · ${took}ث`);
    const cache = [has('disk_cache_reused') && 'ذاكرة الجهاز', has('memory_cache_reused') && 'ذاكرة الجلسة'].filter(Boolean);
    if (cache.length) lines.push(`نسخ محفوظة: ${cache.join(' + ')} (والبحث يتجدد في الخلفية)`);
    const aliases = ev.find((e) => e.stage === 'season_aliases');
    if (aliases) lines.push(`أسماء الموسم: ${(aliases.titles ?? []).join(' | ')} · بحث: ${(aliases.queries ?? []).join(' | ')}`);
    const queries = [...new Set(ev.filter((e) => e.stage === 'query_started').map((e) => e.query))];
    if (queries.length) lines.push(`استعلامات (${queries.length}): ${queries.join(' | ')}`);
    const sources = new Map();
    const of = (id) => sources.get(id) ?? sources.set(id, { received: 0, pages: 0, skipped: false, errors: [], ok: [], rejected: [] }).get(id);
    for (const e of ev) {
      if (!e.sourceId) continue;
      const s = of(e.sourceId);
      if (e.stage === 'source_page') {
        s.pages += 1; s.received += e.received ?? 0;
        if (e.skipped) s.skipped = true;
        if (e.error) s.errors.push(errText(e.error));
      } else if (e.stage === 'candidate_accepted') s.ok.push(e.title);
      else if (e.stage === 'candidate_rejected') s.rejected.push(e.reason ?? '?');
    }
    if (sources.size) lines.push('المصادر:');
    for (const [id, s] of sources) {
      const parts = [s.skipped ? 'متخطّى' : `ردّ ${s.received} نتيجة في ${s.pages} صفحة`];
      if (s.ok.length) parts.push(`قُبل ${s.ok.length} («${[...new Set(s.ok)].slice(0, 2).join('»، «')}»)`);
      if (s.rejected.length) parts.push(`رُفض ${s.rejected.length} (${tally(s.rejected)})`);
      if (s.errors.length) parts.push(`خطأ: ${tally(s.errors)}`);
      lines.push(`- ${nameOf(id)}: ${parts.join(' · ')}`);
    }
    const addons = ev.find((e) => e.stage === 'addon_copies');
    if (addons) lines.push(`إضافات بالمعرّف: ${(addons.sources ?? []).map(nameOf).join('، ') || 'لا شيء'}`);
    for (const e of ev.filter((x) => /failed$/.test(x.stage))) lines.push(`فشل ${e.stage}: ${errText(e.error)}`);
    const done = ev.findLast?.((e) => e.stage === 'discovery_complete');
    if (done) lines.push(`النتيجة: ${(done.sources ?? []).map(nameOf).join('، ') || 'لا نسخ'}${done.uncertain ? ' · غير مؤكدة (مصدر تخطّى أو أخطأ)' : ''}`);
    if (trace.droppedEvents) lines.push(`(سقط ${trace.droppedEvents} حدث قديم من السجل)`);
  }
  if (sheet) {
    const routes = sheet.routes ?? [];
    lines.push(`ورقة السيرفرات (${sheet.done ? 'اكتملت' : 'ما زالت تتجهز'}): ${routes.filter((r) => r.state === 'READY').length}/${routes.length} جاهز`);
    const bySource = new Map();
    for (const r of routes) (bySource.get(r.sourceId) ?? bySource.set(r.sourceId, []).get(r.sourceId)).push(r);
    for (const [id, list] of bySource) {
      const ready = list.filter((r) => r.state === 'READY').length;
      const other = list.filter((r) => r.state !== 'READY').map((r) => `${r.state}${r.reason ? ` ${String(r.reason).slice(0, 70)}` : ''}`);
      lines.push(`- ${nameOf(id)}${list[0]?.type === 'torrent' ? ' (تورنت)' : ''}: جاهز ${ready}/${list.length}${other.length ? ` · ${tally(other)}` : ''}`);
    }
    const copies = (sheet.copies ?? []).map((c) => c.sourceId).filter((id) => !bySource.has(id));
    if (copies.length) lines.push(`نسخ بلا أي سيرفر في الورقة: ${[...new Set(copies)].map(nameOf).join('، ')}`);
  }
  return lines.join('\n');
}
