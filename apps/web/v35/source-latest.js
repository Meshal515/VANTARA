/** لقطة Latest مشتركة: الجهاز الذي أخذ lease فقط يسأل إضافة المصدر. */
export function createSourceLatest(sync, { now = () => Date.now(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const snapshots = new Map();
  let initial = null;
  const refresh = async () => {
    const data = await sync.latestSnapshots();
    for (const row of data?.sources ?? []) snapshots.set(row.sourceId, row);
  };
  const prime = () => (initial ??= refresh().then(() => true, () => false));

  return async function sourceLatest(sourceId, fetchSource) {
    if (!await prime()) return fetchSource();
    const cached = snapshots.get(sourceId);
    if (cached && now() - cached.fetchedAt < 60_000) return cached.value;
    let claim;
    try { claim = await sync.claimLatest(sourceId); }
    catch { return cached?.value ?? fetchSource(); }
    if (claim?.claimed) {
      const value = await fetchSource();
      snapshots.set(sourceId, { sourceId, value, fetchedAt: now() });
      void sync.publishLatest(sourceId, value, claim.leaseUntil).catch(() => {});
      return value;
    }
    // ربما جدّده جهاز آخر للتو: خذ اللقطة الجديدة من الخادم. إن ظل يجلبها
    // تبقى القديمة ظاهرة حتى دورة التحديث التالية.
    if (cached) {
      try { await refresh(); } catch { /* اللقطة المحلية تبقى نافعة */ }
      return snapshots.get(sourceId)?.value ?? cached.value;
    }
    for (let i = 0; i < 10; i += 1) {
      await wait(2000);
      try { await refresh(); } catch { break; }
      if (snapshots.has(sourceId)) return snapshots.get(sourceId).value;
    }
    return fetchSource(); // lease انتهى أو الخادم لم يرد: الجهاز لا يبقى عالقًا.
  };
}
