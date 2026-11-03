import { afterEach, expect, it } from 'vitest';
import { beginDiscovery, discoveryDiagnostics, setDiscoveryDebug } from './discovery-diagnostics.js';

afterEach(() => setDiscoveryDebug(false));
it('records the rejected edition and the nested original failure without URL credentials', () => {
  setDiscoveryDebug(true);
  const trace = beginDiscovery({ workId: 12, title: 'Example Season 2' });
  trace.record('candidate_rejected', { sourceId: 'example', reason: 'sequel', title: 'Example Season 3' });
  trace.record('search_failed', { error: new Error('search wrapper', { cause: Object.assign(new Error('GET https://site.example/private?token=secret HTTP 522\nCookie: clearance=firstSecret; session=secondSecret'), { code: 'HTTP_522' }) }), authorization: 'Bearer private' });
  const rows = discoveryDiagnostics(12);
  expect(rows[0].events[0]).toMatchObject({ stage: 'candidate_rejected', reason: 'sequel', title: 'Example Season 3' });
  expect(JSON.stringify(rows)).toContain('HTTP_522');
  expect(JSON.stringify(rows)).not.toMatch(/token=secret|Bearer private|private\?token|firstSecret|secondSecret/);
});
it('retains a bounded recent history and disables data collection outside Debug', () => {
  setDiscoveryDebug(true);
  const trace = beginDiscovery({ workId: 13 });
  for (let index = 0; index < 600; index++) trace.record('search_page', { page: index });
  expect(discoveryDiagnostics(13)[0].events.length).toBeLessThanOrEqual(200);
  expect(discoveryDiagnostics(13)[0].events.at(-1).page).toBe(599);
  setDiscoveryDebug(false);
  trace.record('search_failed', { error: new Error('must not collect') });
  expect(discoveryDiagnostics(13)).toEqual([]);
});
it('keeps the deepest cause when a failure crossed many bridge wrappers', () => {
  setDiscoveryDebug(true);
  let error = Object.assign(new Error('original DNS failure'), { code: 'ENOTFOUND' });
  for (let n = 0; n < 8; n++) error = new Error(`wrapper ${n}`, { cause: error });
  const trace = beginDiscovery({ workId: 14 }); trace.record('search_failed', { error });
  expect(discoveryDiagnostics(14)[0].events[0].error.rootCause).toMatchObject({ code: 'ENOTFOUND', message: 'original DNS failure' });
});
