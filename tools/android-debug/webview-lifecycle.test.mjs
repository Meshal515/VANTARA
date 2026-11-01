import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePassiveSessions } from './webview-lifecycle.mjs';

const entry = (pid, action, id, time) => `11-01 13:51:07.001  ${pid}  ${pid} I VantaraPassiveWebView: ${action} id=${id} at=${time}`;
test('an in-flight Cloudflare image fetch is not a leaked verification screen', () => {
  const log = entry(12, 'START', 8, 1000);
  assert.deepEqual(analyzePassiveSessions(log, 12, 3500), {started:1,ended:0,active:1,oldestActiveMs:2500});
});
test('a finished passive session counts as closed even while Android retains its Java object', () => {
  const log = [entry(12,'START',8,1000),entry(12,'END',8,1200)].join('\n');
  assert.equal(analyzePassiveSessions(log,12,40000).active,0);
});
test('an old active session fails closed', () => {
  assert.throws(() => analyzePassiveSessions(entry(12,'START',8,1000),12,32000), /exceeded/);
});
test('unmatched cleanup and duplicate creation are errors', () => {
  assert.throws(() => analyzePassiveSessions(entry(12,'END',8,1200),12,3000), /without a matching/);
  assert.throws(() => analyzePassiveSessions([entry(12,'START',8,1000),entry(12,'START',8,2000)].join('\n'),12,3000), /twice/);
});
test('records from other processes do not masquerade as app WebViews', () => {
  assert.equal(analyzePassiveSessions(entry(50,'START',9,1000),12,40000).active,0);
});
