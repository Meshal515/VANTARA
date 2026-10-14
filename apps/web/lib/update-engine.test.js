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
