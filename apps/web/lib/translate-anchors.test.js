import { expect, it } from 'vitest';
import { createQueue } from './translate.js';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
// Reader focus may borrow at most two burst slots; chapter edges are never anchors.

it('admits only the current page behind full running and prepared prefetch slots', async () => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const events = [];
  const q = createQueue({ concurrency: 1, prepareConcurrency: 1, maxPrepared: 1 });
  const old = q.add({ key: 'old', chapterKey: 'old', index: 0, run: () => hold });
  await tick();
  const ready = q.add({ key: 'ready', chapterKey: 'old', index: 1, prepare: async () => ({}), run: () => hold });
  await tick(); await tick();
  q.focus('c', 50, { c: 0 }, { pageCount: 100 });
  const tasks = [0, 99, 50, 51].map(index => q.add({
    key: `c${index}`, chapterKey: 'c', index,
    prepare: async () => ({}), run: async () => { events.push(index); await hold; },
  }));
  for (let i = 0; i < 12; i++) await tick();
  const beforeRelease = [...events];
  release(); await Promise.all([old, ready, ...tasks]);
  expect(beforeRelease).toEqual([50]);
});

it('deduplicates first and focused and updates live focus for already dispatched work', async () => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const q = createQueue({ concurrency: 1 });
  q.focus('c', 0, { c: 0 }, { pageCount: 1 });
  let context;
  const one = q.add({ key: 'same', chapterKey: 'c', index: 0, run: async c => { context = c; await hold; } });
  await tick();
  const duplicate = q.add({ key: 'same', chapterKey: 'c', index: 0, run: () => { throw Error('duplicate'); } });
  expect(duplicate).toBe(one);
  await tick();
  const wasFocused = context.isInteractive?.();
  q.focus('c', 4, { c: 0 }, { pageCount: 5 });
  const stillFocused = context.isInteractive?.();
  release(); await one;
  expect(wasFocused).toBe(true);
  expect(stillFocused).toBe(false);
});

it('promotes a new focus while the former current still awaits Luna without admitting chapter edges', async () => {
 let release; const hold=new Promise(r=>release=r), seen=[];
 const q=createQueue({concurrency:1,maxPrepared:1});
 const tasks=[q.add({key:'old',chapterKey:'old',index:0,run:()=>hold})]; await tick();
 q.focus('c',50,{c:0},{pageCount:100});
 for(const index of [50,0,99]) tasks.push(q.add({key:`c${index}`,chapterKey:'c',index,run:async()=>{seen.push(index);await hold;}}));
 await tick();q.focus('c',51,{c:0},{pageCount:100});
 tasks.push(q.add({key:'c51',chapterKey:'c',index:51,run:async()=>{seen.push(51);await hold;}}));
 await tick();const before=[...seen];release();await Promise.all(tasks);
 expect(before).toEqual([50,51]);
});
it('admits current preparation despite a blocked former focus preparation', async () => {
 let release;const hold=new Promise(r=>release=r),seen=[];
 const q=createQueue({concurrency:1,prepareConcurrency:1,maxPrepared:1});
 const add=(key,chapterKey,index)=>q.add({key,chapterKey,index,prepare:async()=>{seen.push(key);await hold;return{};},run:async()=>null});
 const tasks=[add('old','old',0)];await tick();
 q.focus('c',50,{c:0},{pageCount:100});tasks.push(add('prior','c',50));await tick();
 q.focus('c',51,{c:0},{pageCount:100});tasks.push(add('current','c',51));await tick();
 const before=[...seen];release();await Promise.all(tasks);
 expect(before).toEqual(['old','prior','current']);
});
it('caps outstanding work even across many focus changes', async () => {
 let release;const hold=new Promise(r=>release=r);let started=0;
 const q=createQueue({concurrency:1,maxPrepared:1});const tasks=[];
 for(let index=1;index<=20;index++){
  q.focus('c',index,{c:0},{pageCount:100});
  tasks.push(q.add({key:`c${index}`,chapterKey:'c',index,run:async()=>{started++;await hold;}}));await tick();
 }
 const before=started;release();await Promise.all(tasks);expect(before).toBe(3);
});
