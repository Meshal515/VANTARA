/**
 * صحة المصادر كما يراها هذا الجهاز، تُرسل للخادم عدّاداتٍ مجمّعة
 * (`/v1/diag/sources`): أي مصدر، أي خطوة، النتيجة، سبب قصير، والزمن. لا عمل ولا
 * رابط ولا مستخدم. بها يُقاس الـAPK على الهواتف فعلًا (لا من مركز بيانات)،
 * ويُعرف لماذا «لم يرد» مصدر سليم عند الفحص.
 *
 * لا يؤخّر شيئًا: يُجمع في الذاكرة ويُرسل دفعة كل نصف دقيقة.
 */

import { currentPlatform } from './capabilities.js';
import { appVersion } from './config.js';

const FLUSH_MS = 30_000;
const MAX_KEYS = 200;

let transport = null;
let timer = null;
const pending = new Map();

/** `send(path, {method, body})` (نفس `sync.translation`). */
export function connectSourceReports(send) {
  transport = send;
  if (pending.size) schedule();
}

function schedule() {
  if (!timer && transport) timer = setTimeout(() => void flushSourceReports(), FLUSH_MS);
}

/** نتيجة خطأ → outcome للعقد: مهلة، حماية، أو خطأ. */
export function outcomeOf(error) {
  const m = String(error?.message ?? error ?? '');
  if (/timeout|timed out|لم يرد|مهلة/i.test(m)) return 'timeout';
  if (/challenge|cloudflare|captcha|just a moment/i.test(m)) return 'challenge';
  return 'error';
}

/**
 * حدث واحد: {section: manga|anime|cinema, sourceId, stage, outcome, reason?, ms?}.
 * المتشابهة تُجمع (عدد + مجموع الزمن + أقصاه) قبل الإرسال.
 */
export function reportSource(e) {
  if (!e?.section || !e.sourceId || !e.stage || !e.outcome) return;
  const reason = e.outcome === 'ok' ? '' : String(e.reason ?? '').slice(0, 120);
  const key = `${e.section}|${e.sourceId}|${e.stage}|${e.outcome}|${reason}`;
  const ms = Math.max(0, Math.round(Number(e.ms) || 0));
  const prev = pending.get(key);
  if (prev) {
    prev.n += 1;
    prev.msSum += ms;
    prev.msMax = Math.max(prev.msMax, ms);
  } else if (pending.size < MAX_KEYS) {
    pending.set(key, { section: e.section, sourceId: String(e.sourceId), stage: e.stage, outcome: e.outcome, reason, n: 1, msSum: ms, msMax: ms });
  }
  schedule();
}

export async function flushSourceReports() {
  clearTimeout(timer);
  timer = null;
  if (!transport || !pending.size) return;
  const events = [...pending.values()].map((p) => ({ section: p.section, sourceId: p.sourceId, stage: p.stage, outcome: p.outcome, reason: p.reason, n: p.n, ms: Math.round(p.msSum / p.n), msMax: p.msMax }));
  pending.clear();
  try {
    await transport('/v1/diag/sources', { method: 'POST', body: { platform: currentPlatform(), appVersion: appVersion() ?? 'web', events } });
  } catch {
    // قياس لا يُفشل شيئًا
  }
}

/** للاختبار. */
export function _pending() {
  return [...pending.values()];
}
