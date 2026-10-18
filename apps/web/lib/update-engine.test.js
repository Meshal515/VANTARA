import { expect, it, vi } from 'vitest';

it('splits a large chapter catch-up into bounded batches without losing remaining work', async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const { connectUpdates, report, flush } = await import('./update-engine.js');
  const batches = [];
  connectUpdates(async (_path, { body }) => { batches.push(body.works); return { status: 200 }; });
  for (let i = 0; i < 6; i++) report({ work: `ext:work${i}`, title: `Work${i}`, section: 'manga', kind: 'chapter', source: { s: 'qa' },
    units: Array.from({ length: 40 }, (_, number) => ({ number })) });
  await flush();
  expect(batches[0]).toHaveLength(5);
  expect(batches[0].reduce((n, w) => n + w.units.length, 0)).toBe(200);
  await flush();
  expect(batches[1].map(w => w.work)).toEqual(['ext:work5']);
  expect(batches.flat().reduce((n, w) => n + w.units.length, 0)).toBe(240);
  vi.useRealTimers();
});

it('retries a failed HTTP observation instead of permanently losing new chapters', async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const { connectUpdates, report, flush } = await import('./update-engine.js');
  const received = [];
  connectUpdates(async (_path, { body }) => {
    received.push(body.works);
    return { status: received.length === 1 ? 503 : 200 };
  });
  report({ work: 'ext:retry', title: 'Retry', section: 'manga', kind: 'chapter', source: { s: 'qa' }, units: [{ number: 12 }] });
  await flush();
  await flush();
  expect(received).toHaveLength(2);
  expect(received[1][0].units).toEqual([{ number: 12 }]);
  vi.useRealTimers();
});

it('preserves chapters reported while a failed update request is still in flight', async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const { connectUpdates, report, flush } = await import('./update-engine.js');
  let finish;
  connectUpdates(async () => new Promise((resolve) => { finish = resolve; }));
  const event = (number) => ({ work: 'ext:series', title: 'Series', section: 'manga', kind: 'chapter', source: { s: 'qa' }, units: [{ number }] });
  report(event(17));
  const inflight = flush();
  report(event(18));
  finish({ status: 500 });
  await inflight;
  let resent;
  connectUpdates(async (_path, { body }) => { resent = body.works; return { status: 200 }; });
  await flush();
  expect(resent).toHaveLength(1);
  expect(resent[0].units.map((unit) => unit.number)).toEqual([18, 17]);
  vi.useRealTimers();
});

it('sends every dated chapter beyond the old forty-unit cutoff', async () => {
  vi.useFakeTimers(); vi.resetModules();
  const { connectUpdates, report, flush } = await import('./update-engine.js');
  const received = [];
  connectUpdates(async (_path, { body }) => { received.push(...body.works.flatMap(w => w.units)); return { status: 200 }; });
  report({ work: 'ext:history', title: 'History', section: 'manga', kind: 'chapter', source: { s: 'qa' }, units: Array.from({ length: 125 }, (_, number) => ({ number, publishedAt: 1_700_000_000_000 + number })) });
  for (let i = 0; i < 5; i++) await flush();
  expect(received.map(u => u.number).sort((a,b) => a-b)).toEqual(Array.from({ length: 125 }, (_, i) => i));
  vi.useRealTimers();
});

it('restores failed reports after reload, including a request interrupted in flight', async () => {
  vi.useFakeTimers(); vi.resetModules();
  const data = new Map();
  vi.stubGlobal('localStorage', { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) });
  let engine = await import('./update-engine.js');
  engine.connectUpdates(async () => ({ status: 503 }));
  engine.report({ work: 'ext:offline', title: 'Offline', section: 'manga', kind: 'chapter', source: { s: 'qa' }, units: [{ number: 8 }] });
  await engine.flush();
  vi.resetModules(); engine = await import('./update-engine.js');
  let resent = [];
  engine.connectUpdates(async (_path, { body }) => { resent = body.works; return { status: 200 }; });
  await engine.flush();
  expect(resent[0]?.units).toEqual([{ number: 8 }]);
  vi.unstubAllGlobals(); vi.useRealTimers();
});

it('keeps unacknowledged reports durable while the request is in flight', async () => {
  vi.useFakeTimers(); vi.resetModules();
  const data = new Map();
  vi.stubGlobal('localStorage', { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) });
  const before = await import('./update-engine.js');
  before.connectUpdates(async () => new Promise(() => {}));
  before.report({ work: 'ext:interrupted', title: 'Interrupted', section: 'manga', kind: 'chapter', source: { s: 'qa' }, units: [{ number: 44 }] });
  void before.flush();
  vi.clearAllTimers(); vi.resetModules();
  const after = await import('./update-engine.js');
  let received = [];
  after.connectUpdates(async (_path, { body }) => { received = body.works; return { status: 200 }; });
  await after.flush();
  expect(received[0].units).toEqual([{ number: 44 }]);
  vi.unstubAllGlobals(); vi.useRealTimers();
});

it('diagnoses capacity rejection and preserves the existing pending work', async () => {
  vi.resetModules();
  const { report, updateReportStatus } = await import('./update-engine.js');
  report({ work: 'ext:kept', title: 'Kept', section: 'manga', kind: 'chapter', units: [{ number: 1 }] });
  expect(report({ work: 'ext:too big', title: 'Too big', section: 'manga', kind: 'chapter', units: Array.from({ length: 50_001 }, (_, number) => ({ number })) })).toBe(false);
  expect(updateReportStatus()).toMatchObject({ pendingWorks: 1, pendingUnits: 1, dropped: 50_001 });
});
