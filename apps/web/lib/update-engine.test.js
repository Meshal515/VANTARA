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
