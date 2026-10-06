/** Bounded metadata/thumbnail queue; decoded page images stay in the native pipeline. */
export const DEFAULT_TEXT_BATCH_LIMITS = Object.freeze({
  maxPages: 6,
  maxRegions: 48,
  maxSourceChars: 7_000,
  maxSourceTokens: 2_600,
  maxPayloadBytes: 5_900_000,
});

const finite = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

export function estimateSourceTokens(page) {
  let ascii = 0;
  let nonAscii = 0;
  for (const region of page?.regions ?? []) {
    const source = typeof region?.source === 'string' ? region.source : '';
    for (const char of source) {
      if ((char.codePointAt(0) ?? 0) <= 0x7f) ascii += 1;
      else nonAscii += 1;
    }
  }
  // Conservative enough for admission: English averages ~4 chars/token while
  // CJK can approach one token per visible character.
  return Math.max(0, Math.ceil(ascii / 4 + nonAscii * 1.25));
}

function pageBudget(page) {
  const regions = Array.isArray(page?.regions) ? page.regions.length : 0;
  const sourceChars = (page?.regions ?? []).reduce((sum, region) => sum + (typeof region?.source === 'string' ? region.source.length : 0), 0);
  return {
    pages: 1,
    regions,
    sourceChars,
    sourceTokens: estimateSourceTokens(page),
    payloadBytes: JSON.stringify(page).length,
  };
}

const addBudget = (a, b) => ({
  pages: a.pages + b.pages,
  regions: a.regions + b.regions,
  sourceChars: a.sourceChars + b.sourceChars,
  sourceTokens: a.sourceTokens + b.sourceTokens,
  payloadBytes: a.payloadBytes + b.payloadBytes,
});

const exceeds = (budget, limits) =>
  budget.pages > limits.maxPages ||
  budget.regions > limits.maxRegions ||
  budget.sourceChars > limits.maxSourceChars ||
  budget.sourceTokens > limits.maxSourceTokens ||
  budget.payloadBytes > limits.maxPayloadBytes;

const reaches = (budget, limits) =>
  budget.pages >= limits.maxPages ||
  budget.regions >= limits.maxRegions ||
  budget.sourceChars >= limits.maxSourceChars ||
  budget.sourceTokens >= limits.maxSourceTokens ||
  budget.payloadBytes >= limits.maxPayloadBytes;

/**
 * Luna scheduler rules:
 * - visible page: direct, zero assembly window;
 * - ahead pages: short bounded assembly window;
 * - a batch dispatches as soon as any page/region/source-char/token/payload limit
 *   is reached (or adding the next compatible page would cross one);
 * - arrival of newer work never restarts the oldest page's deadline.
 */
export function createTextBatcher(request, {
  waitMs = 40,
  maxInFlight = 2,
  adaptive = false,
  limits: configuredLimits = {},
} = {}) {
  const limits = {
    maxPages: finite(configuredLimits.maxPages, DEFAULT_TEXT_BATCH_LIMITS.maxPages),
    maxRegions: finite(configuredLimits.maxRegions, DEFAULT_TEXT_BATCH_LIMITS.maxRegions),
    maxSourceChars: finite(configuredLimits.maxSourceChars, DEFAULT_TEXT_BATCH_LIMITS.maxSourceChars),
    maxSourceTokens: finite(configuredLimits.maxSourceTokens, DEFAULT_TEXT_BATCH_LIMITS.maxSourceTokens),
    maxPayloadBytes: finite(configuredLimits.maxPayloadBytes, DEFAULT_TEXT_BATCH_LIMITS.maxPayloadBytes),
  };
  const assemblyMs = Math.max(0, Number(waitMs) || 0);
  const pending = [];
  let active = 0;
  let timer = null;
  let window = adaptive ? Math.min(3, maxInFlight) : maxInFlight;
  let cooldownUntil = 0, good = 0, throttles = 0;

  const abortError = () => Object.assign(new Error('Translation cancelled'), { name: 'AbortError' });
  const identity = page => JSON.stringify([page.seriesRef, page.chapterKey, page.sourceLang ?? 'en', page.speed ?? 'quality']);
  const finish = (entry, result, error = null) => {
    entry.signal?.removeEventListener('abort', entry.abort);
    if (entry.cancelled) return;
    if (error) entry.reject(error); else entry.resolve(result);
  };
  const serverPerfOf = result => result?.body?.perf && typeof result.body.perf === 'object' ? result.body.perf : {};
  const withLunaPerf = (entry, result, {
    dispatchedAt,
    requestRoundTripMs,
    budget,
    inFlight,
    pagesPerBatch = budget.pages,
  }) => {
    const server = serverPerfOf(result);
    const serverBatchWaitMs = Math.max(0, Number(server.batchWaitMs) || 0);
    const providerNetworkMs = Math.max(0, Number(server.providerNetworkMs) || 0);
    const clientBatchWaitMs = Math.max(0, dispatchedAt - entry.queuedAt);
    const batchWaitMs = clientBatchWaitMs + serverBatchWaitMs;
    // Additive decomposition: batchWait + request + provider/network equals the
    // observed language wall. request here is client<->worker + worker overhead.
    const requestMs = Math.max(0, requestRoundTripMs - serverBatchWaitMs - providerNetworkMs);
    return {
      ...result,
      lunaPerf: {
        batchWaitMs: Math.round(batchWaitMs),
        clientBatchWaitMs: Math.round(clientBatchWaitMs),
        serverBatchWaitMs: Math.round(serverBatchWaitMs),
        requestMs: Math.round(requestMs),
        roundTripMs: Math.round(Math.max(0, requestRoundTripMs)),
        providerNetworkMs: Math.round(providerNetworkMs),
        pagesPerBatch,
        regionsPerBatch: budget.regions,
        charsPerBatch: budget.sourceChars,
        tokensPerBatch: budget.sourceTokens,
        payloadBytesPerBatch: budget.payloadBytes,
        inFlight,
      },
    };
  };

  async function direct(entry, budget, inFlight, dispatchedAt = Date.now()) {
    const began = Date.now();
    try {
      const result = await request('/v1/translate/text', entry.page);
      finish(entry, withLunaPerf(entry, result, {
        dispatchedAt,
        requestRoundTripMs: Date.now() - began,
        budget,
        inFlight,
        pagesPerBatch: 1,
      }));
    } catch (error) {
      finish(entry, null, error);
    }
  }

  async function send(group, budget) {
    active++;
    const inFlight = active;
    const dispatchedAt = Date.now();
    const began = dispatchedAt;
    try {
      if (group.length === 1) {
        await direct(group[0], budget, inFlight, dispatchedAt);
        return;
      }

      const result = await request('/v1/translate/text-batch', { pages: group.map(e => e.page) });
      const roundTripMs = Date.now() - began;
      if (adaptive && (result.status === 429 || result.body?.pages?.some(p => p.status === 429))) {
        window = Math.max(1, Math.floor(window / 2));
        good = 0;
        throttles++;
        cooldownUntil = Date.now() + Math.min(30000, Math.max(1000, Number(result.body?.retryAfterMs) || 1000 * 2 ** Math.min(4, throttles - 1)));
      } else if (adaptive && result.status === 200 && roundTripMs < 15000 && ++good >= 3) {
        window = Math.min(maxInFlight, window + 1);
        good = 0;
        throttles = 0;
      }

      // Only an unavailable endpoint can safely fall back without risking
      // duplicate paid work. Fallback requests run concurrently rather than
      // serialising a whole chapter.
      if (result.status === 404 || result.status === 405) {
        await Promise.all(group.map(async entry => {
          const oneBudget = pageBudget(entry.page);
          const oneBegan = Date.now();
          try {
            const one = await request('/v1/translate/text', entry.page);
            finish(entry, withLunaPerf(entry, one, {
              dispatchedAt,
              requestRoundTripMs: Date.now() - oneBegan,
              budget: oneBudget,
              inFlight,
              pagesPerBatch: 1,
            }));
          } catch (error) {
            finish(entry, null, error);
          }
        }));
      } else if (result.status !== 200) {
        group.forEach(entry => finish(entry, withLunaPerf(entry, result, {
          dispatchedAt,
          requestRoundTripMs: roundTripMs,
          budget,
          inFlight,
        })));
      } else {
        for (const entry of group) {
          const matches = (result.body?.pages ?? []).filter(p => p.pageHash === entry.page.pageHash && (p.pageIndex === undefined || p.pageIndex === entry.page.pageIndex));
          const pageResult = matches.length === 1
            ? { status: matches[0].status, body: matches[0].body }
            : { status: 502, body: { error: 'bad_output' } };
          finish(entry, withLunaPerf(entry, pageResult, {
            dispatchedAt,
            requestRoundTripMs: roundTripMs,
            budget,
            inFlight,
          }));
        }
      }
    } catch (error) {
      group.forEach(entry => finish(entry, null, error));
    } finally {
      active--;
      pump();
    }
  }

  function planAt(start) {
    const first = pending[start];
    if (!first) return null;
    const key = identity(first.page);
    const indexes = [start];
    let budget = pageBudget(first.page);
    if (exceeds(budget, limits)) return { indexes, budget, ready: true };

    let ready = reaches(budget, limits);
    for (let i = start + 1; i < pending.length && !ready; i++) {
      const next = pending[i];
      if (identity(next.page) !== key) continue;
      const combined = addBudget(budget, pageBudget(next.page));
      if (exceeds(combined, limits)) {
        // The next compatible page proves this batch cannot grow further, so
        // dispatch now instead of burning the remainder of the assembly window.
        ready = true;
        break;
      }
      indexes.push(i);
      budget = combined;
      ready = reaches(budget, limits);
    }
    if (!ready) ready = Date.now() - first.queuedAt >= assemblyMs;
    return { indexes, budget, ready };
  }

  function nextReadyPlan() {
    const seen = new Set();
    for (let i = 0; i < pending.length; i++) {
      const key = identity(pending[i].page);
      if (seen.has(key)) continue;
      seen.add(key);
      const plan = planAt(i);
      if (plan?.ready) return plan;
    }
    return null;
  }

  function scheduleNext() {
    if (!pending.length || active >= window || timer) return;
    const due = Math.min(...pending.map(entry => entry.queuedAt + assemblyMs));
    timer = setTimeout(() => {
      timer = null;
      pump();
    }, Math.max(0, due - Date.now()));
  }

  function pump() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (Date.now() < cooldownUntil) {
      if (pending.length) timer = setTimeout(() => {
        timer = null;
        pump();
      }, Math.max(0, cooldownUntil - Date.now()));
      return;
    }
    while (active < window && pending.length) {
      const plan = nextReadyPlan();
      if (!plan) break;
      const group = plan.indexes.map(index => pending[index]);
      for (const index of [...plan.indexes].sort((a, b) => b - a)) pending.splice(index, 1);
      void send(group, plan.budget);
    }
    scheduleNext();
  }

  return {
    enqueueTextPage(page, { interactive = false, signal } = {}) {
      if (signal?.aborted) return Promise.reject(abortError());

      if (interactive) {
        const entry = { page, queuedAt: Date.now(), signal, resolve: null, reject: null, cancelled: false, abort: null };
        return new Promise((resolve, reject) => {
          entry.resolve = resolve;
          entry.reject = reject;
          entry.abort = () => {
            entry.cancelled = true;
            signal?.removeEventListener('abort', entry.abort);
            reject(abortError());
          };
          signal?.addEventListener('abort', entry.abort, { once: true });
          void direct(entry, pageBudget(page), Math.max(1, active + 1), entry.queuedAt);
        });
      }

      if (pending.length >= 24) return Promise.resolve({ status: 503, body: { error: 'busy' } });
      return new Promise((resolve, reject) => {
        const entry = { page, signal, resolve, reject, queuedAt: Date.now(), cancelled: false, abort: null };
        entry.abort = () => {
          entry.cancelled = true;
          const index = pending.indexOf(entry);
          if (index >= 0) pending.splice(index, 1);
          signal?.removeEventListener('abort', entry.abort);
          reject(abortError());
          pump();
        };
        signal?.addEventListener('abort', entry.abort, { once: true });
        pending.push(entry);
        pump();
      });
    },
  };
}
