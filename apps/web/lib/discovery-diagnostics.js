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
