import { afterEach, expect, it } from 'vitest';
import { beginDiscovery, discoveryDiagnostics, setDiscoveryDebug, summarizeDiscovery } from './discovery-diagnostics.js';

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

it('summarizes one line per source and the server sheet, short enough to copy from a phone', () => {
  setDiscoveryDebug(true);
  const t = beginDiscovery({ workId: 7, title: 'Black Lagoon', format: 'TV', entry: 'general_card' });
  t.record('query_started', { query: 'Black Lagoon' });
  t.record('source_page', { sourceId: 'arabanime', received: 4, page: 1 });
  t.record('candidate_accepted', { sourceId: 'arabanime', title: 'Black Lagoon' });
  t.record('candidate_rejected', { sourceId: 'arabanime', title: 'Black Lagoon OVA', reason: 'sequel' });
  t.record('source_page', { sourceId: 'witanime', received: 0, page: 1, error: 'HTTP 403' });
  t.record('source_page', { sourceId: 'animerift', received: 0, skipped: true });
  t.record('discovery_complete', { sources: ['arabanime'], uncertain: true });
  const sheet = { done: true, copies: [{ sourceId: 'arabanime' }, { sourceId: 'animerift' }],
    routes: [{ sourceId: 'arabanime', state: 'READY' }, { sourceId: 'arabanime', state: 'UNAVAILABLE', reason: 'لم يرد خلال 25 ثانية' },
      { sourceId: 'arabanime', state: 'UNAVAILABLE', reason: 'لم يرد خلال 25 ثانية' }] };
  const text = summarizeDiscovery(discoveryDiagnostics(7)[0], { sheet, nameOf: (id) => id.toUpperCase() });
  expect(text).toContain('- ARABANIME: ردّ 4 نتيجة في 1 صفحة · قُبل 1 («Black Lagoon») · رُفض 1 (sequel)');
  expect(text).toContain('- WITANIME: ردّ 0 نتيجة في 1 صفحة · خطأ: HTTP 403');
  expect(text).toContain('- ANIMERIFT: متخطّى');
  expect(text).toContain('النتيجة: ARABANIME · غير مؤكدة');
  expect(text).toContain('ورقة السيرفرات (اكتملت): 1/3 جاهز');
  expect(text).toContain('- ARABANIME: جاهز 1/3 · UNAVAILABLE لم يرد خلال 25 ثانية×2');
  expect(text).toContain('نسخ بلا أي سيرفر في الورقة: ANIMERIFT');
  expect(text.split('\n').length).toBeLessThan(20);
});

it('explains an empty record instead of returning nothing', () => {
  expect(summarizeDiscovery(undefined)).toContain('فعّل «إظهار التشخيصات»');
});
