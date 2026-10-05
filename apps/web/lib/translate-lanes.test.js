import {expect,it} from 'vitest';
import {createQueue} from './translate.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
it('detects and completes textless pages while all dialogue slots await network',async()=> {
 let release;const blocked=new Promise(r=>{release=r});const events=[];
 const q=createQueue({concurrency:1,prepareConcurrency:1,maxPrepared:4});
 const first=q.add({key:'a',chapterKey:'c',index:0,prepare:async()=>({bypass:false}),run:async()=>{events.push('dialogue');await blocked;return 'translated'}});
 await tick();
 const next=q.add({key:'b',chapterKey:'c',index:1,prepare:async()=>({bypass:true}),run:async({prepared})=>{expect(prepared.bypass).toBe(true);events.push('textless');return 'saved-original'}});
 await tick();await tick();expect(events).toEqual(['dialogue','textless']);expect(await next).toBe('saved-original');release();await first;
});
it('preparation stays bounded and dropping pending work settles its promise',async()=> {
 let release;const blocked=new Promise(r=>{release=r});let preparing=0,max=0;
 const q=createQueue({concurrency:1,prepareConcurrency:1,maxPrepared:2});
 const work=Array.from({length:5},(_,index)=>q.add({key:String(index),chapterKey:'c',index,prepare:async()=>{preparing++;max=Math.max(max,preparing);await tick();preparing--;return {};},run:async()=>blocked}));
 await tick();await tick();await tick();q.drop('c');release();
 const settled=await Promise.all(work);expect(settled.filter(v=>v===null).length).toBeGreaterThan(0);expect(max).toBe(1);
});
it('a dropped preparation failure cannot delete its replacement',async()=> {
 let rejectOld;const old=new Promise((_,reject)=>{rejectOld=reject});
 const q=createQueue({concurrency:1,prepareConcurrency:1});
 const abandoned=q.add({key:'same',chapterKey:'c',index:0,prepare:()=>old,run:async()=>null});
 await tick();q.drop('c');expect(await abandoned).toBeNull();
 const replacement=q.add({key:'same',chapterKey:'c',index:0,prepare:async()=>({bypass:true}),run:async()=>42});
 rejectOld(new Error('old request failed'));await tick();await tick();
 expect(q.pending()).toBe(0);
 expect(await Promise.race([replacement,Promise.resolve('hung')])).toBe(42);
});
it('textless bypass also has a finite active budget',async()=> {
 let release;const blocked=new Promise(r=>{release=r});let active=0,max=0;
 const q=createQueue({concurrency:1,prepareConcurrency:1,bypassConcurrency:2});
 const tasks=Array.from({length:10},(_,index)=>q.add({key:String(index),chapterKey:'c',index,prepare:async()=>({bypass:true}),run:async()=>{active++;max=Math.max(max,active);await blocked;active--;}}));
 for(let i=0;i<12;i++) await tick();expect(max).toBeLessThanOrEqual(2);release();await Promise.all(tasks);
});
