const SOURCE_BATCH = 3;
const WORK_BATCH = 3;
const CHECK_INTERVAL = 6 * 3_600_000;
const MAX_BACKOFF = 6 * 3_600_000;

/** دفعة محدودة على الجهاز. كل مصدر مستقل، وأولوية العمل الذي لم يُفحص أو مضى على فحصه وقت. */
export async function scanDiscovery(sources, {
  catalogue, latest, chapters, knownEditions, readState, writeState,
  shouldContinue = () => true, now = Date.now(),
}) {
  if (!sources.length || !shouldContinue()) return;
  const start = (await readState('cursor')) ?? 0;
  const count = Math.min(sources.length, SOURCE_BATCH);
  const ordered = Array.from({ length: count }, (_, index) => sources[(start + index) % sources.length]);
  await Promise.allSettled(ordered.map(async (source) => {
    const key = 'source:' + source.id;
    const state = (await readState(key)) ?? {};
    if (state.retryAt > now || !shouldContinue()) return;
    const page = state.cataloguePage ?? 1;
    const candidates = new Map();
    let failure = false;
    let cataloguePage = page;
    const add = (mangas, limit = WORK_BATCH) => {
      for (const manga of mangas ?? []) {
        if (candidates.size >= limit) break;
        if (manga?.url && !candidates.has(manga.url)) candidates.set(manga.url, manga);
      }
    };
    const saved = await knownEditions(source.id, { limit: 30 });
    for (const entry of saved) {
      if (entry.source.u && (!entry.source.c || entry.source.m) && now - entry.lastChapterCheckAt >= CHECK_INTERVAL) {
        candidates.set(entry.source.u, { url: entry.source.u, title: entry.title, memo: entry.source.m });
        if (candidates.size >= WORK_BATCH - 1) break;
      }
    }
    if (!shouldContinue()) return;
    let catalogued;
    try {
      catalogued = await catalogue(source, page);
      cataloguePage = catalogued?.hasNextPage ? page + 1 : 1;
    } catch { failure = true; }
    // بعد صفحات العمل المحفوظة، نترك مكانًا لـLatest ثم نملأ الباقي من الكتالوج.
    add(catalogued?.mangas, WORK_BATCH - 1);
    if (candidates.size < WORK_BATCH && shouldContinue()) {
      try {
        const list = await latest(source);
        add(list?.mangas);
      } catch { /* Latest is optional when catalogue or cached work is available. */ }
    }
    add(catalogued?.mangas);
    for (const manga of candidates.values()) {
      if (!shouldContinue()) break;
      try { await chapters(source, manga); } catch { failure = true; }
    }
    const failures = failure ? Math.min(8, (state.failures ?? 0) + 1) : 0;
    await writeState(key, {
      cataloguePage, failures,
      retryAt: failures ? now + Math.min(MAX_BACKOFF, 60_000 * 2 ** failures) : 0,
    });
  }));
  await writeState('cursor', (start + count) % sources.length);
}
