const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0));
const ewma = (prev, next, alpha = 0.22) => next > 0 ? (prev > 0 ? prev * (1 - alpha) + next * alpha : next) : prev;

export const S23_SAFE_OPERATING_ENVELOPE = Object.freeze({
  thermal: Object.freeze({ coolMax: 1, warm: 2, severe: 3, critical: 4 }),
  heap: Object.freeze({ softFallbackMb: 160, hardFallbackMb: 220, softRatio: 0.55, hardRatio: 0.72 }),
  reader: Object.freeze({ concurrencyMax: 12, prepareMax: 3, preparedMax: 14, bypassMax: 6 }),
  networkMax: 6,
  renderReadySoft: 3,
  renderReadyHard: 6,
});

export function createRuntimeCapacityController({ now = () => Date.now(), envelope = S23_SAFE_OPERATING_ENVELOPE } = {}) {
  const listeners = new Set();
  const networkWaiters = [];
  const queueState = new Map();
  const heapSamples = [];
  const decisions = [];
  const state = {
    thermal: 0, heapMb: 0, heapLimitMb: 0, availMemMb: 0, lowMemory: false,
    lunaMs: 12_700, analyzeMs: 4_000, renderMs: 5_100, analyzeWaitMs: 0, renderWaitMs: 0,
    renderReady: 0, networkActive: 0, networkPending: 0,
    grade: 0, healthySamples: 0, lastGradeChange: now(), sequence: 0,
    reason: 'startup', limits: null,
  };

  const heapThresholds = () => {
    const limit = Number(state.heapLimitMb) || 0;
    const soft = limit > 0 ? clamp(limit * envelope.heap.softRatio, 144, 192) : envelope.heap.softFallbackMb;
    const hard = limit > 0 ? clamp(limit * envelope.heap.hardRatio, 184, 256) : envelope.heap.hardFallbackMb;
    return { soft, hard };
  };

  const heapSlope = () => heapSamples.length < 3 ? 0 : (heapSamples.at(-1) - heapSamples[0]) / Math.max(1, heapSamples.length - 1);

  function rawGrade() {
    const { soft, hard } = heapThresholds();
    let grade = 0;
    if (state.thermal >= envelope.thermal.warm || state.heapMb >= soft || state.renderReady >= envelope.renderReadySoft || state.renderWaitMs >= 2_000 || state.analyzeWaitMs >= 5_000) grade = 1;
    if (state.thermal >= envelope.thermal.severe || state.heapMb >= hard * 0.9 || state.renderReady >= envelope.renderReadyHard || state.renderWaitMs >= 5_000) grade = 2;
    if (state.thermal >= envelope.thermal.critical || state.lowMemory || state.heapMb >= hard) grade = 3;
    if (heapSlope() >= 6 && state.heapMb >= soft * 0.8) grade = Math.max(grade, 1);
    return grade;
  }

  function reasonFor(grade) {
    const { soft, hard } = heapThresholds();
    const reasons = [];
    if (state.thermal >= 2) reasons.push(`thermal:${state.thermal}`);
    if (state.lowMemory) reasons.push('lowMemory');
    if (state.heapMb >= hard) reasons.push(`heap-hard:${Math.round(state.heapMb)}MB`);
    else if (state.heapMb >= soft) reasons.push(`heap-soft:${Math.round(state.heapMb)}MB`);
    if (heapSlope() >= 6) reasons.push(`heap-rise:${heapSlope().toFixed(1)}MB/sample`);
    if (state.renderReady >= envelope.renderReadySoft) reasons.push(`render-ready:${state.renderReady}`);
    if (state.renderWaitMs >= 2_000) reasons.push(`render-wait:${Math.round(state.renderWaitMs)}ms`);
    if (state.analyzeWaitMs >= 5_000) reasons.push(`analyze-wait:${Math.round(state.analyzeWaitMs)}ms`);
    if (!reasons.length && state.lunaMs >= 15_000) reasons.push(`luna-slow:${Math.round(state.lunaMs)}ms`);
    return reasons.length ? reasons.join(',') : (grade ? `pressure:${grade}` : 'green');
  }

  function policyFor(grade = state.grade) {
    const slowLunaPrepared = clamp(Math.ceil(state.lunaMs / 2_500) + 2, 6, envelope.reader.preparedMax);
    const base = grade === 0
      ? { concurrency: 12, prepareConcurrency: state.lunaMs >= 15_000 ? 3 : 2, maxPrepared: slowLunaPrepared, bypassConcurrency: 6, network: 6 }
      : grade === 1
        ? { concurrency: 9, prepareConcurrency: 2, maxPrepared: 8, bypassConcurrency: 4, network: 5 }
        : grade === 2
          ? { concurrency: 6, prepareConcurrency: 1, maxPrepared: 5, bypassConcurrency: 3, network: 3 }
          : { concurrency: 3, prepareConcurrency: 1, maxPrepared: 3, bypassConcurrency: 2, network: 2 };
    if (state.thermal >= 5) return { ...base, concurrency: 2, prepareConcurrency: 1, maxPrepared: 2, bypassConcurrency: 1, network: 1 };
    if (state.renderReady >= envelope.renderReadyHard || state.renderWaitMs >= 5_000) {
      return { ...base, prepareConcurrency: Math.min(base.prepareConcurrency, 1), maxPrepared: Math.min(base.maxPrepared, 4), network: Math.min(base.network, 3) };
    }
    return base;
  }

  function emitDecision(force = false) {
    const limits = policyFor();
    const reason = reasonFor(state.grade);
    const key = JSON.stringify([state.grade, limits, reason]);
    const prev = decisions.at(-1)?.key;
    state.limits = limits;
    state.reason = reason;
    if (force || key !== prev) {
      state.sequence += 1;
      decisions.push({ key, at: now(), sequence: state.sequence, grade: state.grade, reason, limits: { ...limits } });
      if (decisions.length > 64) decisions.shift();
      for (const fn of listeners) { try { fn(); } catch {} }
      pumpNetwork();
    }
  }

  function updateGrade({ healthyObservation = false } = {}) {
    const wanted = rawGrade();
    if (wanted > state.grade) {
      state.grade = wanted; state.healthySamples = 0; state.lastGradeChange = now(); emitDecision(true); return;
    }
    if (wanted < state.grade && healthyObservation) {
      state.healthySamples += 1;
      if (state.healthySamples >= 3 && now() - state.lastGradeChange >= 1_500) {
        state.grade -= 1; state.healthySamples = 0; state.lastGradeChange = now(); emitDecision(true); return;
      }
    } else if (wanted >= state.grade) state.healthySamples = 0;
    emitDecision();
  }

  function observePerf(perf, stage = 'native') {
    if (!perf || typeof perf !== 'object') return;
    if (Number.isFinite(Number(perf.thermal))) state.thermal = Number(perf.thermal);
    if (Number.isFinite(Number(perf.heapMb))) state.heapMb = Number(perf.heapMb);
    if (Number.isFinite(Number(perf.heapLimitMb))) state.heapLimitMb = Number(perf.heapLimitMb);
    if (Number.isFinite(Number(perf.availMemMb))) state.availMemMb = Number(perf.availMemMb);
    state.lowMemory = Boolean(perf.lowMemory);
    if (state.heapMb > 0) { heapSamples.push(state.heapMb); if (heapSamples.length > 8) heapSamples.shift(); }
    const stages = perf.stages ?? {};
    const total = Object.values(stages).reduce((a, b) => a + (Number(b) || 0), 0);
    if (stage === 'analyze' && total > 0) state.analyzeMs = ewma(state.analyzeMs, total);
    if (stage === 'render' && total > 0) state.renderMs = ewma(state.renderMs, total);
    updateGrade({ healthyObservation: true });
  }

  function observeStages(stages = {}) {
    const a = Number(stages['nativeWait.analyze'] ?? 0);
    const r = Number(stages['nativeWait.render'] ?? 0);
    if (a >= 0) state.analyzeWaitMs = ewma(state.analyzeWaitMs, a, 0.28);
    if (r >= 0) state.renderWaitMs = ewma(state.renderWaitMs, r, 0.28);
    updateGrade({ healthyObservation: true });
  }

  function observeLuna({ latencyMs = 0, status = 200 } = {}) {
    if (latencyMs > 0 && status !== 409) state.lunaMs = ewma(state.lunaMs, latencyMs, 0.25);
    if (status === 429 || status === 503) {
      state.grade = Math.max(state.grade, 1);
      state.healthySamples = 0;
      state.lastGradeChange = now();
    }
    updateGrade({ healthyObservation: status >= 200 && status < 400 });
  }

  function renderReady(delta) {
    state.renderReady = Math.max(0, state.renderReady + Number(delta || 0));
    updateGrade({ healthyObservation: delta < 0 });
  }

  function observeQueue(snapshot = {}) {
    const lane = snapshot.lane ?? 'generic';
    queueState.set(lane, { ...snapshot, at: now() });
  }

  function queueLimits(snapshot = {}) {
    observeQueue(snapshot);
    const p = policyFor();
    if (snapshot.lane === 'job') {
      const pauseBackground = state.grade >= 2 || state.thermal >= 3 || state.lowMemory;
      return pauseBackground
        ? { concurrency: 0, prepareConcurrency: 0, maxPrepared: 0, bypassConcurrency: 0 }
        : { concurrency: 1, prepareConcurrency: 1, maxPrepared: state.grade ? 1 : 2, bypassConcurrency: 0 };
    }
    return { concurrency: p.concurrency, prepareConcurrency: p.prepareConcurrency, maxPrepared: p.maxPrepared, bypassConcurrency: p.bypassConcurrency };
  }

  function networkLimit() { return policyFor().network; }

  function pumpNetwork() {
    if (!networkWaiters.length) return;
    networkWaiters.sort((a, b) => Number(b.interactive) - Number(a.interactive) || a.seq - b.seq);
    for (let i = 0; i < networkWaiters.length;) {
      const item = networkWaiters[i];
      const cap = networkLimit() + (item.interactive ? 1 : 0);
      if (state.networkActive >= cap) { i++; continue; }
      networkWaiters.splice(i, 1);
      state.networkPending = networkWaiters.length;
      state.networkActive += 1;
      item.resolve();
    }
  }

  let networkSeq = 0;
  async function withNetworkAdmission(fn, { interactive = false, kind = 'luna' } = {}) {
    await new Promise(resolve => {
      networkWaiters.push({ resolve, interactive: Boolean(interactive), seq: networkSeq++ });
      state.networkPending = networkWaiters.length;
      pumpNetwork();
    });
    const began = now();
    let status = 0;
    try {
      const result = await fn();
      status = Number(result?.status ?? 0);
      return result;
    } finally {
      const latencyMs = Math.max(0, now() - began);
      state.networkActive = Math.max(0, state.networkActive - 1);
      state.networkPending = networkWaiters.length;
      if (kind === 'luna') observeLuna({ latencyMs, status }); else emitDecision();
      pumpNetwork();
    }
  }

  function telemetry() {
    const { soft, hard } = heapThresholds();
    return {
      sequence: state.sequence,
      grade: state.grade,
      reason: state.reason,
      thermal: state.thermal,
      heapMb: Math.round(state.heapMb * 10) / 10,
      heapLimitMb: Math.round(state.heapLimitMb * 10) / 10,
      heapSoftMb: Math.round(soft),
      heapHardMb: Math.round(hard),
      heapSlopeMb: Math.round(heapSlope() * 10) / 10,
      lowMemory: state.lowMemory,
      availMemMb: Math.round(state.availMemMb),
      lunaMs: Math.round(state.lunaMs),
      analyzeMs: Math.round(state.analyzeMs),
      renderMs: Math.round(state.renderMs),
      analyzeWaitMs: Math.round(state.analyzeWaitMs),
      renderWaitMs: Math.round(state.renderWaitMs),
      renderReady: state.renderReady,
      networkActive: state.networkActive,
      networkPending: state.networkPending,
      limits: { ...policyFor() },
      queues: Object.fromEntries([...queueState.entries()].map(([k, v]) => [k, { ...v }])),
      recentDecisions: decisions.slice(-8).map(({ key, ...d }) => d),
    };
  }

  function compactTelemetry() {
    const t = telemetry();
    return {
      sequence: t.sequence, grade: t.grade, reason: t.reason,
      thermal: t.thermal, heapMb: t.heapMb, heapLimitMb: t.heapLimitMb,
      heapSoftMb: t.heapSoftMb, heapHardMb: t.heapHardMb, heapSlopeMb: t.heapSlopeMb,
      lowMemory: t.lowMemory, availMemMb: t.availMemMb,
      lunaMs: t.lunaMs, analyzeMs: t.analyzeMs, renderMs: t.renderMs,
      analyzeWaitMs: t.analyzeWaitMs, renderWaitMs: t.renderWaitMs,
      renderReady: t.renderReady, networkActive: t.networkActive, networkPending: t.networkPending,
      limits: t.limits,
    };
  }

  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  emitDecision(true);
  return { queueLimits, observeQueue, observePerf, observeStages, observeLuna, renderReady, withNetworkAdmission, networkLimit, telemetry, compactTelemetry, subscribe };
}

export const runtimeCapacity = createRuntimeCapacityController();
