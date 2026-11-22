import { outcomeOf, reportSource } from '../lib/source-report.js';

/** لقطة Latest مشتركة: الجهاز الذي أخذ lease فقط يسأل إضافة المصدر. */
async function snapshotRequest(request) {
  let timer;
  try {
    return await Promise.race([request(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('snapshot_timeout')), 5000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

export function createSourceLatest(sync, { now = () => Date.now(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const snapshots = new Map();
  let initial = null;
  const refresh = async () => {
    const data = await snapshotRequest(() => sync.latestSnapshots());
    for (const row of data?.sources ?? []) snapshots.set(row.sourceId, row);
  };
  const prime = () => (initial ??= refresh().then(() => true, () => { initial = null; return false; }));

  return async function sourceLatest(sourceId, fetchSource) {
    if (!await prime()) return fetchSource();
    const cached = snapshots.get(sourceId);
    if (cached && now() - cached.fetchedAt < 60_000) return cached.value;
    let claim;
    try { claim = await snapshotRequest(() => sync.claimLatest(sourceId)); }
    catch (error) {
      reportSource({ section: 'manga', sourceId, stage: 'snapshot_claim', outcome: outcomeOf(error), reason: error?.translationError === 'source' ? 'source_id_rejected' : 'claim_failed' });
      return fetchSource();
    }
    if (claim?.claimed) {
      const value = await fetchSource();
      snapshots.set(sourceId, { sourceId, value, fetchedAt: now() });
      void sync.publishLatest(sourceId, value, claim.leaseUntil, claim.leaseToken).catch(() => {});
      return value;
    }
    // ربما جدّده جهاز آخر للتو: خذ اللقطة الجديدة من الخادم. إن ظل يجلبها
    // تبقى القديمة ظاهرة حتى دورة التحديث التالية.
    if (cached) {
      try { await refresh(); } catch { /* اللقطة المحلية تبقى نافعة */ }
      const refreshed = snapshots.get(sourceId);
      if (refreshed && now() - refreshed.fetchedAt < 60_000) return refreshed.value;
      return fetchSource();
    }
    const until = now() + 20_000;
    for (let i = 0; i < 10 && now() < until; i += 1) {
      await wait(2000);
      try { await refresh(); } catch { break; }
      if (snapshots.has(sourceId) && now() - snapshots.get(sourceId).fetchedAt < 60_000) return snapshots.get(sourceId).value;
    }
    return fetchSource(); // lease انتهى أو الخادم لم يرد: الجهاز لا يبقى عالقًا.
  };
}
