/**
 * الخيطان الرفيعان لآخر التحديثات المحلي (خطة 27 نوفمبر، المرحلة 7). الخادم لا يكشف ولا يقرر:
 *
 * 1. **نسخة الحساب:** ما كشفه هذا الجهاز بنفسه يُرفع حدثًا حدثًا بلا روابط حين يُكشف (الجديد فقط)، والخادم يدمج
 *    أجهزة الحساب بالمعرّف ولا يستبدل، ويُستعاد مرة في تثبيت جديد. ما سبق الهجرة محفوظ في الخادم أصلًا وتعيده الهجرة نفسها.
 * 2. **إشارات الأصحاب:** ما يكشفه جهاز يصل لبقية الحسابات **ولو لم يُثبَّت مصدره هنا** (قرار المالك، 27 نوفمبر): الإشارة
 *    خبر لا مصدر، فالتطبيق يبقى فارغًا من المصادر. تمر على سياسة هذا الجهاز، وتُكتب حدثًا وترفع خطوط الأساس، وإن كان
 *    المصدر مثبتًا هنا يتخطى الكاشف فحص هذا العمل منه لفترة، فلا يُطرق الموقع مرتين.
 */
import { raiseMarks } from './latest-migrate.js';

const BACKUP_KEY = 'backup.events';
/** معرّفات ما كشفه هذا الجهاز ولم يُرفع بعد (رفع تفاضلي: الجديد فقط، لا النسخة كلها بعد كل دورة). */
const PENDING_KEY = 'backup.pending';
const UPLOAD_BATCH = 100;
export const FRIEND_FRESH_MS = 2 * 3_600_000;

/** حدث بلا روابط ولا ما لا يلزم: الهوية والوحدة والوقت ومعرّفات المصادر فقط. */
const compact = (e) => ({ id: e.id, work: e.work, section: e.section, kind: e.kind, season: e.season ?? null, number: e.number ?? null, title: e.title, at: e.at, publishedAt: e.publishedAt ?? null, firstSeenAt: e.firstSeenAt ?? e.at, sources: (e.sources ?? []).map((s) => ({ s: s.s })) });
const signalKey = (s) => `${s.eventId}\u0000${s.sourceId}`;

/**
 * يُنادى بالأحداث التي أنشأها الكاشف المحلي: تُحفظ للنسخة وتُعلَّم للرفع وتُنشر إشارةً. لا تقليم صامت: كان سقف 1500
 * حدث يمحو الأقدم، و`slice(-500)` يسقط إشارات تراكمت والجهاز بلا شبكة.
 */
export async function recordLocalEvents(store, events) {
  if (!events?.length) return;
  const have = (await store.getMeta(BACKUP_KEY)) ?? [];
  const byId = new Map(have.map((e) => [e.id, e]));
  for (const e of events) byId.set(e.id, compact(e));
  await store.setMeta(BACKUP_KEY, [...byId.values()].sort((a, b) => b.at - a.at));
  const pending = new Set((await store.getMeta(PENDING_KEY)) ?? []);
  for (const e of events) pending.add(e.id);
  await store.setMeta(PENDING_KEY, [...pending]);
  const queue = (await store.getMeta('signals.outbox')) ?? [];
  const fresh = events.map((e) => ({ eventId: e.id, work: e.work, section: e.section, kind: e.kind, season: e.season ?? null, number: e.number, title: e.title, sourceId: e.sources?.[0]?.s, at: e.at })).filter((s) => s.sourceId);
  const outbox = new Map([...queue, ...fresh].map((s) => [signalKey(s), s]));
  await store.setMeta('signals.outbox', [...outbox.values()]);
}

/**
 * يرفع الجديد وحده (100 حدث في الطلب) وينشر الإشارات المنتظرة. يرجع ما تم. ما لم يُرفع يبقى للمرة التالية، ورد
 * «quota» من الخادم يُرجَع صريحًا ولا يُقلَّم شيء.
 */
export async function pushThreads(store, send) {
  const out = { backup: false, events: 0, signals: 0, quota: false };
  const events = (await store.getMeta(BACKUP_KEY)) ?? [];
  let pending = (await store.getMeta(PENDING_KEY)) ?? null;
  // جهاز رفع النسخة كاملة بإصدار سابق: ما عنده كله يُعلَّم مرة، والخادم يدمج بالمعرّف (التكرار لا يضر)
  if (pending == null) { pending = events.map((e) => e.id); await store.setMeta(PENDING_KEY, pending); }
  const byId = new Map(events.map((e) => [e.id, e]));
  const todo = pending.filter((id) => byId.has(id));
  let sent = 0;
  for (let i = 0; i < todo.length; i += UPLOAD_BATCH) {
    const ids = todo.slice(i, i + UPLOAD_BATCH);
    const res = await send('/v1/latest/backup/events', { method: 'POST', body: { events: ids.map((id) => byId.get(id)) } });
    if (res?.status === 409) { out.quota = true; break; }
    if (res?.status !== 200) break;
    sent += ids.length;
    const left = new Set((await store.getMeta(PENDING_KEY)) ?? []);
    for (const id of ids) left.delete(id);
    await store.setMeta(PENDING_KEY, [...left]);
  }
  out.events = sent;
  out.backup = sent === todo.length;
  const outbox = (await store.getMeta('signals.outbox')) ?? [];
  for (let i = 0; i < outbox.length; i += 100) {
    const batch = outbox.slice(i, i + 100);
    const res = await send('/v1/latest/signals', { method: 'POST', body: { signals: batch } });
    if (res?.status !== 200) break;
    out.signals += batch.length;
    // ما وصل يُحذف بمفتاحه: إشارة أُضيفت أثناء الرفع لا تضيع
    const done = new Set(batch.map(signalKey));
    await store.setMeta('signals.outbox', ((await store.getMeta('signals.outbox')) ?? []).filter((s) => !done.has(signalKey(s))));
  }
  return out;
}

/**
 * يستعيد نسخة الحساب مرة لكل تثبيت (بعد الهجرة)، صفحة صفحة حتى آخرها: ما رفعته كل أجهزة الحساب مدموجًا بالمعرّف،
 * والصف القديم معه. مثبّتة ولا تغيّر وقت حدث موجود.
 */
export async function restoreBackup(store, send) {
  if (await store.getMeta('backup.restored')) return { restored: 0, skipped: true };
  const all = new Map();
  let after = '';
  for (let page = 0; page < 200; page++) {
    const res = await send(`/v1/latest/backup${after ? `?after=${encodeURIComponent(after)}` : ''}`);
    if (res?.status !== 200) return { restored: 0, ok: false };
    for (const e of Array.isArray(res.body?.payload?.events) ? res.body.payload.events : []) if (e?.id) all.set(e.id, e);
    if (!res.body?.next) break;
    after = res.body.next;
  }
  const events = [...all.values()];
  if (events.length) { await store.putEvents(events, { pinned: true, origin: 'backup' }); await raiseMarks(store, events); }
  // ما استُعيد يبقى في النسخة، ولا يُرفع من جديد (موجود عند الخادم)
  if (events.length) {
    const mine = (await store.getMeta(BACKUP_KEY)) ?? [];
    const merged = new Map([...events.map((e) => [e.id, e]), ...mine.map((e) => [e.id, e])]);
    await store.setMeta(BACKUP_KEY, [...merged.values()].sort((a, b) => b.at - a.at));
  }
  if ((await store.getMeta(PENDING_KEY)) == null) await store.setMeta(PENDING_KEY, []);
  await store.setMeta('backup.restored', { at: Date.now(), count: events.length });
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
