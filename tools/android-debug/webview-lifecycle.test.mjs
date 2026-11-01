import assert from 'node:assert/strict';
import test from 'node:test';
import { observeWebViewTargets } from './webview-lifecycle.mjs';
const shell = { id:'shell',type:'page',url:'https://localhost/index.html' };
const cover = { id:'cover',type:'page',url:'https://io.mangalik.net/wp-content/x.webp' };
test('the application shell is required', () => {
  assert.throws(()=>observeWebViewTargets([],new Map(),0),/shell/);
});
test('a temporary cover-fetch WebView is allowed without treating it as human verification', () => {
  const result = observeWebViewTargets([shell,cover],new Map(),2000);
  assert.deepEqual(result.sample,{shellTargets:1,temporaryTargets:1,temporaryHosts:['io.mangalik.net']});
  assert.equal(result.seen.get('cover'),2000);
});
test('normal teardown removes a secondary target from the tracking set', () => {
  const before=observeWebViewTargets([shell,cover],new Map(),1000);
  const after=observeWebViewTargets([shell],before.seen,52000);
  assert.equal(after.seen.size,0);
});
test('a stuck secondary WebView is a real failure, not exempted by the count change', () => {
  const before=observeWebViewTargets([shell,cover],new Map(),1000);
  assert.throws(()=>observeWebViewTargets([shell,cover],before.seen,48000),/outlived/);
});
test('new navigation target restarts its own lifetime and only hostnames are reported', () => {
  const before=observeWebViewTargets([shell,cover],new Map(),1000);
  const next=observeWebViewTargets([shell,{...cover,id:'new'}],before.seen,52000);
  assert.equal(next.seen.get('new'),52000);
  assert.ok(!JSON.stringify(next.sample).includes('/wp-content/'));
});
