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

test('live original shell passes even when the unrelated heap count is zero or unavailable', async () => {
  const {assertLiveShellWebView}=await import('./webview-lifecycle.mjs');
  for(const javaWebViewObjects of [0,null]) assert.doesNotThrow(()=>assertLiveShellWebView({
    pages:[shell],expectedTargetId:shell.id,probe:{url:shell.url,readyState:'complete',home:true,utility:false,fixture:true},javaWebViewObjects,
  }));
});
test('another local target cannot replace the original shell', async () => {
  const {assertLiveShellWebView}=await import('./webview-lifecycle.mjs');
  const probe={url:shell.url,readyState:'complete',home:true,utility:false,fixture:true};
  assert.throws(()=>assertLiveShellWebView({pages:[{...shell,id:'replacement'}],expectedTargetId:shell.id,probe}),/original/i);
  assert.throws(()=>assertLiveShellWebView({pages:[],expectedTargetId:shell.id,probe}),/original/i);
});
test('fresh shell evaluation must prove every live Home predicate', async () => {
  const {assertLiveShellWebView}=await import('./webview-lifecycle.mjs');
  const good={url:shell.url,readyState:'complete',home:true,utility:false,fixture:true};
  for(const change of [{url:'https://localhost.evil/index.html'},{readyState:'loading'},{home:false},{utility:true},{fixture:false}])
    assert.throws(()=>assertLiveShellWebView({pages:[shell],expectedTargetId:shell.id,probe:{...good,...change}}),/shell|Home|ready|local|fixture/i);
  assert.throws(()=>assertLiveShellWebView({pages:[shell],expectedTargetId:shell.id,probe:null}),/shell|Home|ready|local|fixture/i);
});
test('only the exact local origin is recognized as an app shell', async () => {
  const {isAppShellTarget}=await import('./webview-lifecycle.mjs');
  assert.equal(isAppShellTarget(shell),true);
  for(const url of ['https://localhost.evil/','https://localhost@evil.test/','https://localhost:8443/','http://localhost/','not a url'])assert.equal(isAppShellTarget({...shell,url}),false);
});
test('additional local WebViews must also close within the deadline', () => {
  const extra={...shell,id:'extra'};
  const before=observeWebViewTargets([shell,extra],new Map(),1000,45000,shell.id);
  assert.equal(before.sample.shellTargets,1);assert.equal(before.sample.temporaryTargets,1);
  assert.throws(()=>observeWebViewTargets([shell,extra],before.seen,48000,45000,shell.id),/outlived/);
  assert.equal(observeWebViewTargets([shell],before.seen,48000,45000,shell.id).seen.size,0);
});
