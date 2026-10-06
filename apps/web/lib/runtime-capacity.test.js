import { describe, expect, it } from 'vitest';
import { createRuntimeCapacityController } from './runtime-capacity.js';

describe('runtime capacity controller', () => {
  it('keeps analyze/network supplied when Luna is slow and memory/thermal are green', () => {
    let now = 0;
    const c = createRuntimeCapacityController({ now: () => now });
    for (let i = 0; i < 4; i++) {
      now += 500;
      c.observePerf({ thermal: 1, heapMb: 90 + i * 3, heapLimitMb: 512, availMemMb: 3000, lowMemory: false, stages: { work: 3500 } }, 'analyze');
    }
    now += 500;
    c.observeLuna({ latencyMs: 24_000, status: 200 });
    const t = c.telemetry();
    expect(t.grade).toBe(0);
    expect(t.limits.network).toBe(6);
    expect(t.limits.prepareConcurrency).toBe(3);
    expect(t.limits.maxPrepared).toBeGreaterThanOrEqual(9);
  });

  it('backs off progressively for render pressure, heat, and memory pressure', () => {
    let now = 0;
    const c = createRuntimeCapacityController({ now: () => now });
    c.renderReady(3);
    expect(c.telemetry().grade).toBe(1);
    c.renderReady(3);
    expect(c.telemetry().grade).toBe(2);
    now += 500;
    c.observePerf({ thermal: 4, heapMb: 190, heapLimitMb: 256, lowMemory: false, stages: { work: 5000 } }, 'render');
    expect(c.telemetry().grade).toBe(3);
    expect(c.queueLimits({ lane: 'job' }).concurrency).toBe(0);
    expect(c.queueLimits({ lane: 'reader' }).concurrency).toBeGreaterThan(0);
  });

  it('uses hysteresis before restoring capacity', () => {
    let now = 0;
    const c = createRuntimeCapacityController({ now: () => now });
    c.observePerf({ thermal: 3, heapMb: 190, heapLimitMb: 256, lowMemory: false, stages: { work: 5000 } }, 'analyze');
    expect(c.telemetry().grade).toBeGreaterThanOrEqual(2);
    const before = c.telemetry().grade;
    for (let i = 0; i < 2; i++) {
      now += 2000;
      c.observePerf({ thermal: 1, heapMb: 90, heapLimitMb: 512, lowMemory: false, stages: { work: 3000 } }, 'analyze');
    }
    expect(c.telemetry().grade).toBe(before);
    now += 2000;
    c.observePerf({ thermal: 1, heapMb: 90, heapLimitMb: 512, lowMemory: false, stages: { work: 3000 } }, 'analyze');
    expect(c.telemetry().grade).toBe(before - 1);
  });


  it('caps network in-flight work without starving a visible request', async () => {
    let now = 0;
    const c = createRuntimeCapacityController({ now: () => now });
    c.observePerf({ thermal: 3, heapMb: 100, heapLimitMb: 512, availMemMb: 3000, totalMemMb: 12000, lowMemory: false, stages: { work: 3000 } }, 'analyze');
    expect(c.networkLimit()).toBe(3);
    let active = 0, maxActive = 0;
    let releaseAll;
    const hold = new Promise(resolve => { releaseAll = resolve; });
    const task = (interactive = false) => c.withNetworkAdmission(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await hold;
      active -= 1;
      return { status: 200 };
    }, { interactive, kind: 'luna' });
    const work = [task(), task(), task(), task(), task(), task(true)];
    await Promise.resolve();
    await Promise.resolve();
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(active).toBe(4);
    releaseAll();
    await Promise.all(work);
  });

  it('treats sustained native analyze wait as backlog pressure, not Luna latency alone', () => {
    let now = 0;
    const c = createRuntimeCapacityController({ now: () => now });
    c.observeLuna({ latencyMs: 24_000, status: 200 });
    expect(c.telemetry().grade).toBe(0);
    c.observeStages({ 'nativeWait.analyze': 6_000 });
    expect(c.telemetry().grade).toBe(1);
    expect(c.telemetry().reason).toContain('analyze-wait');
  });

  it('uses Android low-memory threshold before lowMemory flips true', () => {
    let now = 0;
    const c = createRuntimeCapacityController({ now: () => now });
    c.observePerf({
      thermal:1, heapMb:90, heapLimitMb:512, nativeHeapMb:140,
      availMemMb:1000, totalMemMb:12000, lowMemoryThresholdMb:800, lowMemory:false,
      stages:{work:3000},
    }, 'analyze');
    expect(c.telemetry().grade).toBe(1);
    expect(c.telemetry().reason).toContain('ram-threshold:1.25x');
    expect(c.telemetry().nativeHeapMb).toBe(140);
    now += 100;
    c.observePerf({
      thermal:1, heapMb:90, heapLimitMb:512,
      availMemMb:850, totalMemMb:12000, lowMemoryThresholdMb:800, lowMemory:false,
      stages:{work:3000},
    }, 'analyze');
    expect(c.telemetry().grade).toBe(2);
  });

  it('decays native wait pressure after the backlog clears', () => {
    let now = 0;
    const c = createRuntimeCapacityController({ now: () => now });
    c.observeStages({ 'nativeWait.analyze': 6_000 });
    expect(c.telemetry().grade).toBe(1);
    for (let i = 0; i < 3; i++) {
      now += 2_000;
      c.observeStages({ 'nativeWait.analyze': 0, 'nativeWait.render': 0 });
    }
    expect(c.telemetry().analyzeWaitMs).toBeLessThan(5_000);
    expect(c.telemetry().grade).toBe(0);
  });

  it('bounds a deterministic 100-page pressure simulation', () => {
    let now = 0;
    const c = createRuntimeCapacityController({ now: () => now });
    let maxReader = 0, maxPrepared = 0, maxNetwork = 0, sawThrottle = false, sawRecovery = false;
    for (let page = 0; page < 100; page++) {
      now += 700;
      const hot = page >= 55 && page < 70;
      const thermal = hot ? 3 : 1;
      const heap = hot ? 180 + (page % 4) * 4 : 82 + (page % 7) * 5;
      c.observePerf({ thermal, heapMb: heap, heapLimitMb: 512, availMemMb: 2500, lowMemory: false, stages: { work: hot ? 6000 : 3200 } }, 'analyze');
      c.observeLuna({ latencyMs: page % 9 === 0 ? 18_000 : 10_000, status: 200 });
      if (page % 5 === 0) c.renderReady(1);
      if (page % 5 === 2) c.renderReady(-1);
      const t = c.telemetry();
      maxReader = Math.max(maxReader, t.limits.concurrency);
      maxPrepared = Math.max(maxPrepared, t.limits.maxPrepared);
      maxNetwork = Math.max(maxNetwork, t.limits.network);
      if (hot && t.grade >= 2) sawThrottle = true;
      if (page > 80 && t.grade === 0) sawRecovery = true;
    }
    expect(maxReader).toBeLessThanOrEqual(12);
    expect(maxPrepared).toBeLessThanOrEqual(14);
    expect(maxNetwork).toBeLessThanOrEqual(6);
    expect(sawThrottle).toBe(true);
    expect(sawRecovery).toBe(true);
    expect(c.telemetry().recentDecisions.length).toBeGreaterThan(0);
  });
});
