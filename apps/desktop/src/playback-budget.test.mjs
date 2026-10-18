import test from 'node:test';
import assert from 'node:assert/strict';
import * as budgets from './playback-budget.mjs';

test('startup deadline includes metadata and cannot be extended by download progress', t => {
  assert.equal(typeof budgets.createPlaybackBudget, 'function');
  t.mock.timers.enable({apis:['setTimeout']});
  const failures=[];
  const budget=budgets.createPlaybackBudget({torrent:true,onTimeout:reason=>failures.push(reason)});
  t.mock.timers.tick(89999);assert.deepEqual(failures,[]);
  budget.update({position:123,paused:false});
  t.mock.timers.tick(1);assert.deepEqual(failures,['startup']);budget.dispose();
});
test('direct startup expires at 15 seconds and decoded readiness cancels startup', t => {
  assert.equal(typeof budgets.createPlaybackBudget, 'function');
  t.mock.timers.enable({apis:['setTimeout']});
  const failures=[];
  const direct=budgets.createPlaybackBudget({onTimeout:reason=>failures.push(reason)});
  t.mock.timers.tick(15000);assert.deepEqual(failures,['startup']);direct.dispose();
  const ready=budgets.createPlaybackBudget({onTimeout:reason=>failures.push(reason)});
  ready.ready({paused:true});t.mock.timers.tick(90000);assert.deepEqual(failures,['startup']);ready.dispose();
});
test('stalled playback recovers at APK budget while pause and position progress reset the deadline', t => {
  assert.equal(typeof budgets.createPlaybackBudget, 'function');
  t.mock.timers.enable({apis:['setTimeout']});const failures=[];
  const budget=budgets.createPlaybackBudget({torrent:true,onTimeout:reason=>failures.push(reason)});
  budget.ready({position:0,paused:false});t.mock.timers.tick(34000);budget.update({position:1000});
  t.mock.timers.tick(34000);assert.deepEqual(failures,[]);budget.update({paused:true});
  t.mock.timers.tick(90000);assert.deepEqual(failures,[]);budget.update({paused:false});
  t.mock.timers.tick(35000);assert.deepEqual(failures,['stalled']);budget.dispose();
});

import { createDesktopServices } from './services.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('service deadline aborts preparation and emits recovery for the selected session before any player process',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'vantara-budget-'));
  const events=[];let entered;
  const preparing=new Promise(resolve=>entered=resolve);
  const services=createDesktopServices({userData:dir,binaries:{rqbit:'unused',mpv:'unused'},onEvent:event=>events.push(event),videoHost:{acquire:async(session,signal)=>{
    entered();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
  }}});
  t.after(async()=>{await services.close();await rm(dir,{recursive:true,force:true});});
  t.mock.timers.enable({apis:['setTimeout']});
  const pending=services.startPlayback({session:'budget-session',candidate:{url:'https://video.example.com/test.mp4'}});
  const rejection=assert.rejects(pending,/مهلة/);
  await preparing;t.mock.timers.tick(15000);await rejection;
  assert.deepEqual(events.filter(event=>event.type==='playback/recovery-needed'),[{type:'playback/recovery-needed',reason:'startup',session:'budget-session'}]);
  assert.equal(events.filter(event=>event.type==='playback/error').length,1);
  assert.equal(events.some(event=>event.type==='playback/ready'),false);
});

test('direct playback without position movement expires in 20 seconds; duplicate notifications do not conceal a stall',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const failures=[];
  const budget=budgets.createPlaybackBudget({onTimeout:reason=>failures.push(reason)});
  budget.ready({position:1000,paused:false});t.mock.timers.tick(19000);
  budget.update({position:1000,paused:false});t.mock.timers.tick(1000);
  assert.deepEqual(failures,['stalled']);budget.dispose();
});
test('disposed session never emits a later deadline',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const failures=[];
  const budget=budgets.createPlaybackBudget({torrent:true,onTimeout:reason=>failures.push(reason)});
  budget.dispose();t.mock.timers.tick(200000);assert.deepEqual(failures,[]);
});

test('a user torrent seek gets a bounded refill window instead of the normal playback stall deadline',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const failures=[];const b=budgets.createPlaybackBudget({torrent:true,onTimeout:r=>failures.push(r)});
 b.ready({position:3600000,paused:false});b.seek(1800000);t.mock.timers.tick(40000);b.update({position:3600000});expectNone();t.mock.timers.tick(40000);expectNone();
 b.update({position:1800000});t.mock.timers.tick(10000);expectNone();b.seekReady({position:1800000});t.mock.timers.tick(34999);expectNone();t.mock.timers.tick(1);assert.deepEqual(failures,['stalled']);b.dispose();
 function expectNone(){assert.deepEqual(failures,[]);}
});
test('torrent seek refill still has a deadline and cannot be renewed by stale progress',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const failures=[];const b=budgets.createPlaybackBudget({torrent:true,onTimeout:r=>failures.push(r)});
 b.ready({position:3600000,paused:false});b.seek(1800000);t.mock.timers.tick(119999);b.update({position:3600000});assert.deepEqual(failures,[]);t.mock.timers.tick(1);assert.deepEqual(failures,['seek']);b.dispose();
});
