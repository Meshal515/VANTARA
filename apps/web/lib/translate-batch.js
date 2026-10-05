/** Bounded metadata/thumbnail queue; decoded page images stay in the native pipeline. */
export function createTextBatcher(request, { waitMs = 200, maxInFlight = 2, adaptive = false } = {}) {
  const pending = [];
  let active = 0, timer = null;
  let window = adaptive ? Math.min(3,maxInFlight) : maxInFlight;
  let cooldownUntil = 0, good = 0, throttles = 0;
  const abortError = () => Object.assign(new Error('Translation cancelled'), { name: 'AbortError' });
  const identity = page => JSON.stringify([page.seriesRef, page.chapterKey, page.sourceLang ?? 'en', page.speed ?? 'quality']);
  const finish = (entry, result, error = null) => {
    entry.signal?.removeEventListener('abort', entry.abort);
    if (entry.cancelled) return;
    if (error) entry.reject(error); else entry.resolve(result);
  };
  async function send(group) {
    active++;
    const began=Date.now();
    try {
      const result = await request('/v1/translate/text-batch', { pages: group.map(e => e.page) });
      if(adaptive && (result.status===429 || result.body?.pages?.some(p=>p.status===429))) {
        window=Math.max(1,Math.floor(window/2));good=0;throttles++;
        cooldownUntil=Date.now()+Math.min(30000,Math.max(1000,Number(result.body?.retryAfterMs)||1000*2**Math.min(4,throttles-1)));
      } else if(adaptive && result.status===200 && Date.now()-began<15000 && ++good>=3) {
        window=Math.min(maxInFlight,window+1);good=0;throttles=0;
      }
      // Only an unavailable endpoint can safely fall back without risking duplicate paid work.
      if (result.status === 404 || result.status === 405) {
        for (const entry of group) if (!entry.cancelled) finish(entry, await request('/v1/translate/text', entry.page));
      } else if (result.status !== 200) {
        group.forEach(entry => finish(entry, result));
      } else {
        for (const entry of group) {
          const matches = (result.body?.pages ?? []).filter(p => p.pageHash === entry.page.pageHash && (p.pageIndex === undefined || p.pageIndex === entry.page.pageIndex));
          finish(entry, matches.length === 1 ? { status: matches[0].status, body: matches[0].body } : { status: 502, body: { error: 'bad_output' } });
        }
      }
    } catch (error) { group.forEach(entry => finish(entry, null, error)); }
    finally { active--; pump(true); }
  }
  function pump(flush = false) {
    if (timer) clearTimeout(timer); timer = null;
    if(Date.now()<cooldownUntil) { if(pending.length) timer=setTimeout(()=>pump(true),cooldownUntil-Date.now()); return; }
    while (active < window && pending.length && (flush || pending.length >= 4)) {
      const first = pending.shift(); const group = [first];
      let regions = first.page.regions?.length ?? 0;
      let bytes = JSON.stringify(first.page).length;
      for (let i = 0; i < pending.length && group.length < 4;) {
        const next = pending[i], n = next.page.regions?.length ?? 0, size = JSON.stringify(next.page).length;
        if (identity(first.page) === identity(next.page) && regions + n <= 64 && bytes + size <= 5_900_000) { group.push(...pending.splice(i, 1)); regions += n; bytes += size; } else i++;
      }
      void send(group);
    }
    if (pending.length && active < window) timer = setTimeout(() => pump(true), Math.min(1000, Math.max(0, waitMs)));
  }
  return {
    enqueueTextPage(page, { interactive = false, signal } = {}) {
      if (signal?.aborted) return Promise.reject(abortError());
      if (interactive) return request('/v1/translate/text', page).then(result => { if (signal?.aborted) throw abortError(); return result; });
      if (pending.length >= 16) return Promise.resolve({ status: 503, body: { error: 'busy' } });
      return new Promise((resolve, reject) => {
        const entry = { page, signal, resolve, reject, cancelled: false, abort: null };
        entry.abort = () => {
          entry.cancelled = true;
          const index = pending.indexOf(entry); if (index >= 0) pending.splice(index, 1);
          signal?.removeEventListener('abort', entry.abort); reject(abortError());
        };
        signal?.addEventListener('abort', entry.abort, { once: true });
        pending.push(entry); pump();
      });
    },
  };
}
