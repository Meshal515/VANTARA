# S23 Ultra runtime capacity envelope

Baseline: `stable-123` / `7b4263e2dcf66e493616dcefd8ab73db3baabc4d`

This document defines the runtime-capacity contract for sustained chapter translation. It does **not** change RT-DETR, CTD, BubbleSeg, OCR, Luna packing, whitening, LaMa, or render algorithms. It only changes admission/backpressure.

## Goal

Hold the highest sustainable pipeline throughput for a full chapter without thermal collapse, GC churn, or unbounded prepared/render-ready/network queues. Peak concurrency is not a target.

## Controller inputs

- Android thermal status.
- Java heap used / max heap.
- Android `MemoryInfo.lowMemory`, available RAM, and total RAM.
- ART GC cumulative counters and blocking-GC deltas.
- Luna latency EWMA and network in-flight count.
- Native analyze wait EWMA.
- Native render wait EWMA.
- Render-ready backlog.
- Reader visible-page urgency.
- Queue running/preparing/ready backlog.

Every controller transition is emitted in per-page performance telemetry under `capacity`, including the pressure grade, reason, current limits, memory/thermal observations, queue/network pressure and recent decision sequence.

## Initial S23 Ultra safe operating envelope

These are software admission limits, not claims about the device's physical maximum.

| Pressure | Typical trigger | Reader run cap | Prepare cap | Prepared cap | Network cap | Background job |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Green (0) | thermal 0-1, memory healthy, no native/render backlog | 12 | 2; 3 only when Luna is slow | adaptive 6-14 | 6 | 1 |
| Warm (1) | thermal >=2, heap soft mark, analyze wait >=5s, render wait >=2s, render-ready >=3, low RAM/GC churn | 9 | 2 | 8 | 5 | 1 |
| Hot (2) | thermal >=3, render-ready >=6, render wait >=5s, near hard heap, very low RAM | 6 | 1 | 5 (4 with render pressure) | 3 | paused |
| Critical (3) | thermal >=4, Android lowMemory, hard heap mark | 3 | 1 | 3 | 2 | paused |
| Emergency | thermal >=5 | 2 | 1 | 2 | 1 | paused |

Visible reader work is never reduced to zero. A visible Luna request may borrow one network slot so background saturation cannot starve the current page.

### Heap marks

When Android exposes max heap:

- soft mark = 55% of max heap, clamped to 144-192 MB.
- hard mark = 72% of max heap, clamped to 184-256 MB.

Fallbacks when max heap is unavailable are 160 MB soft and 220 MB hard.

Heap is not interpreted alone. The controller also reacts to `lowMemory`, RAM headroom, heap slope and blocking-GC churn. There is intentionally no forced `System.gc()`.

### Slow Luna policy

Slow Luna is **not** by itself a reason to stop native analysis.

When thermal/memory/backlogs remain green, Luna latency >=15s raises reader prepare concurrency from 2 to 3 and scales prepared depth using:

`ceil(lunaEWMA / 2500) + 2`, clamped to 6-14 pages.

Network work remains independently bounded.

### Native/render backlog policy

- Analyze wait >=5s raises pressure instead of adding more preparation.
- Render-ready >=3 or render wait >=2s begins backoff.
- Render-ready >=6 or render wait >=5s forces stronger backoff and caps prepared depth at 4 while the render bottleneck persists.

This prevents a slow render tail from turning into an analyze/RAM queue.

### Recovery

Pressure increases immediately. Capacity recovers only after three healthy observations and at least 1.5s since the last grade change, one pressure grade at a time. This hysteresis prevents concurrency oscillation around thermal/heap thresholds.

## Integration contracts

### Queue owner

`createQueue` accepts optional `capacity` and `lane` fields. When omitted, its existing behavior is unchanged. The capacity controller only returns ceilings; queue priority/focus/burst semantics remain owned by the queue implementation.

### Native owner

Native inference serialization and priority gates remain owned by the native pipeline. Runtime Capacity consumes native telemetry; it does not add another native execution lock.

### Luna owner

Existing adaptive Luna batch assembly remains untouched. Runtime Capacity wraps network admission around it, limiting concurrent requests without changing page/region packing.

## Required validation before calling the envelope proven

The synthetic 100-page pressure simulation proves only the controller invariants. A physical S23 Ultra chapter run must still verify:

- 100 new pages in 100-120s target or measured closest sustainable rate.
- thermal status remains stable rather than climbing continuously after warm-up.
- no Android `lowMemory` events.
- heap peak and heap slope remain bounded.
- blocking GC count/time do not accelerate late in the run.
- no growth of analyze wait or render-ready backlog across successive 20-page windows.
- no regression in partial/failure/residual quality metrics.

Until that device run exists, the envelope is **SAFE-INITIAL / DEVICE-UNVERIFIED**, not a claimed hardware maximum.
