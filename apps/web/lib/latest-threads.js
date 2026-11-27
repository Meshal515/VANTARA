/**
 * الخيطان الرفيعان لآخر التحديثات المحلي (خطة 27 نوفمبر، المرحلة 7). الخادم لا يكشف ولا يقرر:
 *
 * 1. **نسخة الحساب:** ما كشفه هذا الجهاز بنفسه (لا يوجد عند الخادم) يُرفع ملخصًا صغيرًا بلا روابط بعد كل دورة،
 *    ويُستعاد مرة في تثبيت جديد. ما سبق الهجرة محفوظ في الخادم أصلًا وتعيده الهجرة نفسها.
 * 2. **إشارات الأصحاب:** ما يكشفه جهاز يصل لبقية الحسابات **ولو لم يُثبَّت مصدره هنا** (قرار المالك، 27 نوفمبر): الإشارة
 *    خبر لا مصدر، فالتطبيق يبقى فارغًا من المصادر. تمر على سياسة هذا الجهاز، وتُكتب حدثًا وترفع خطوط الأساس، وإن كان
 *    المصدر مثبتًا هنا يتخطى الكاشف فحص هذا العمل منه لفترة، فلا يُطرق الموقع مرتين.
 */
import { raiseMarks } from './latest-migrate.js';

const BACKUP_KEY = 'backup.events';
const MAX_BACKUP_EVENTS = 1500;
const MAX_BACKUP_BYTES = 240 * 1024;
export const FRIEND_FRESH_MS = 2 * 3_600_000;

/** حدث بلا روابط ولا ما لا يلزم: الهوية والوحدة والوقت ومعرّفات المصادر فقط. */
const compact = (e) => ({ id: e.id, work: e.work, section: e.section, kind: e.kind, season: e.season ?? null, number: e.number ?? null, title: e.title, at: e.at, publishedAt: e.publishedAt ?? null, firstSeenAt: e.firstSeenAt ?? e.at, sources: (e.sources ?? []).map((s) => ({ s: s.s })) });

/** يُنادى بالأحداث التي أنشأها الكاشف المحلي: تُحفظ للنسخة وتُنشر إشارةً. */
export async function recordLocalEvents(store, events) {
  if (!events?.length) return;
  const have = (await store.getMeta(BACKUP_KEY)) ?? [];
  const byId = new Map(have.map((e) => [e.id, e]));
  for (const e of events) byId.set(e.id, compact(e));
  await store.setMeta(BACKUP_KEY, [...byId.values()].sort((a, b) => b.at - a.at).slice(0, MAX_BACKUP_EVENTS));
  const queue = (await store.getMeta('signals.outbox')) ?? [];
  await store.setMeta('signals.outbox', [...queue, ...events.map((e) => ({ eventId: e.id, work: e.work, section: e.section, kind: e.kind, season: e.season ?? null, number: e.number, title: e.title, sourceId: e.sources?.[0]?.s, at: e.at }))].filter((s) => s.sourceId).slice(-500));
}

/** يرفع النسخة (ضمن الحد، الأحدث أولًا) وينشر الإشارات المنتظرة. يرجع ما تم. */
export async function pushThreads(store, send) {
  const out = { backup: false, signals: 0 };
  let events = (await store.getMeta(BACKUP_KEY)) ?? [];
  if (events.length) {
    while (events.length && JSON.stringify(events).length > MAX_BACKUP_BYTES) events = events.slice(0, Math.floor(events.length * 0.9));
    const res = await send('/v1/latest/backup', { method: 'POST', body: { payload: { v: 1, events } } });
    out.backup = res?.status === 200;
  }
  const outbox = (await store.getMeta('signals.outbox')) ?? [];
  for (let i = 0; i < outbox.length; i += 100) {
    const res = await send('/v1/latest/signals', { method: 'POST', body: { signals: outbox.slice(i, i + 100) } });
    if (res?.status !== 200) break;
    out.signals += Math.min(100, outbox.length - i);
    await store.setMeta('signals.outbox', outbox.slice(i + 100));
  }
  return out;
}

/** يستعيد نسخة الحساب مرة واحدة لكل تثبيت (بعد الهجرة): مثبّتة ولا تغيّر وقت حدث موجود. */
export async function restoreBackup(store, send) {
  if (await store.getMeta('backup.restored')) return { restored: 0, skipped: true };
  const res = await send('/v1/latest/backup');
  if (res?.status !== 200) return { restored: 0, ok: false };
  const events = Array.isArray(res.body?.payload?.events) ? res.body.payload.events : [];
  if (events.length) { await store.putEvents(events, { pinned: true, origin: 'backup' }); await raiseMarks(store, events); }
  await store.setMeta('backup.restored', { at: Date.now(), count: events.length });
  // ما استُعيد يبقى في النسخة التالية أيضًا
  if (events.length) await store.setMeta(BACKUP_KEY, events.slice(0, MAX_BACKUP_EVENTS));
  return { restored: events.length, ok: true };
}

/**
 * يسحب إشارات الأصحاب الجديدة. تُقبل كلها ما دامت تمر على `allow(section, sourceId, title)` (سياسة هذا الجهاز)، مثبتًا
 * كان مصدرها أو لا. ما يُقبل يصير حدثًا ويُعلَّم «طازجًا» فيتخطاه الكاشف إن كان المصدر مثبتًا هنا.
 */
export async function pullSignals(store, send, { allow = () => true, now = Date.now() } = {}) {
  let after = (await store.getMeta('signals.after')) ?? 0, accepted = 0, rejected = 0;
  for (let round = 0; round < 10; round++) {
    const res = await send(`/v1/latest/signals?after=${after}`);
    if (res?.status !== 200 || !Array.isArray(res.body?.signals)) break;
    const list = res.body.signals;
    const ok = list.filter((s) => allow(s.section, s.sourceId, s.title));
    rejected += list.length - ok.length;
    if (ok.length) {
      const events = ok.map((s) => ({ id: s.eventId, work: s.work, section: s.section, kind: s.kind, season: s.season, number: s.number, title: s.title, at: Math.min(s.at, now), firstSeenAt: Math.min(s.at, now), sources: [{ s: s.sourceId }] }));
      await store.putEvents(events, { pinned: true, origin: 'friend' });
      await raiseMarks(store, events);
      const fresh = (await store.getMeta('friend.fresh')) ?? {};
      for (const s of ok) fresh[`${s.sourceId}\u0000${s.work}`] = now;
      for (const k of Object.keys(fresh)) if (now - fresh[k] > FRIEND_FRESH_MS) delete fresh[k];
      await store.setMeta('friend.fresh', fresh);
      accepted += ok.length;
    }
    after = res.body.next ?? after;
    await store.setMeta('signals.after', after);
    if (list.length < 200) break;
  }
  return { accepted, rejected };
}

/** للكاشف: هل وصلت إشارة صديق حديثة لهذا العمل من هذا المصدر؟ (فلا يُطلب فصله) */
export async function friendFresh(store, sourceId, work, now = Date.now()) {
  const fresh = (await store.getMeta('friend.fresh')) ?? {};
  const at = fresh[`${sourceId}\u0000${work}`];
  return Number.isFinite(at) && now - at <= FRIEND_FRESH_MS;
}
