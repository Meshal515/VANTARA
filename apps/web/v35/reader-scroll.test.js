import { expect, it } from 'vitest';
import { readingPosition, readingTop } from './reader-scroll.js';
const frame = (top, height) => ({getBoundingClientRect:()=>({top,height,bottom:top+height})});
it('maps the same point inside a tall page across desktop and phone sizes', () => {
  expect(readingPosition([frame(-1000,2000),frame(1000,1000)],0)).toBe(.5);
  expect(readingPosition([frame(-500,1000),frame(500,500)],0)).toBe(.5);
  expect(readingTop([frame(20,2000)],.5,20,0)).toBe(1000);
  expect(readingTop([frame(20,1000)],.5,20,0)).toBe(500);
});
it('tracks upward and downward movement within a page and stays finite while loading', () => {
  expect(readingPosition([frame(-200,1000)],0)).toBe(.2);
  expect(readingPosition([frame(-800,1000)],0)).toBe(.8);
  expect(readingPosition([frame(0,0)],0)).toBe(0);
  expect(readingTop([frame(-100,2000)],.5,0,100)).toBe(1000);
});

it('reads only logarithmically many image bounds on a 2048-page continuous chapter',()=>{
  let layouts = 0;
  const frames = Array.from({length:2048},(_,index)=>({
    getBoundingClientRect:()=>{layouts++;return {top:index*1600-2070000,height:1600,bottom:(index+1)*1600-2070000};},
  }));
  const visible = readingPosition(frames,0);
  expect(Math.floor(visible)).toBe(1293);
  expect(layouts).toBeLessThanOrEqual(14);
});
it('binary visible-frame lookup keeps exact behavior at page boundaries and after last page',()=>{
  expect(readingPosition([frame(-100,101),frame(1,800)],0)).toBeCloseTo(100/101);
  expect(readingPosition([frame(-200,200),frame(0,800)],0)).toBe(1);
  expect(readingPosition([frame(-1200,600),frame(-600,600)],0)).toBeCloseTo(1.999999, 6);
});

it('coalesces follow updates, avoids layout work during animation, stops idle and catches up on resume',async()=>{
  const {createReadingFollower}=await import('./reader-scroll.js');
  expect(typeof createReadingFollower).toBe('function');
  let pos=0,target=1000,reads=0,visible=true,id=0; const frames=new Map();
  const follow=createReadingFollower({getPosition:()=>pos,setPosition:p=>pos=p,readTarget:()=>{reads++;return target;},active:()=>visible,
    requestFrame:fn=>{frames.set(++id,fn);return id;},cancelFrame:i=>frames.delete(i)});
  const step=t=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(t));};
  follow.update();follow.update();follow.update(); expect(frames.size).toBe(1);step(0);expect(reads).toBe(1);
  for(let t=16;t<=500;t+=16) step(t);expect(pos).toBeCloseTo(1000,0);expect(reads).toBe(1);expect(frames.size).toBe(0);
  target=100;follow.update();step(520);expect(pos).toBeLessThan(1000); // reverse scroll
  visible=false;follow.suspend();expect(frames.size).toBe(0);target=2000;follow.update();expect(frames.size).toBe(0);
  visible=true;follow.update(true);step(5000);expect(pos).toBe(2000);expect(frames.size).toBe(0);
  follow.destroy();follow.update();expect(frames.size).toBe(0);
});
it('maps invalid or out-of-chapter positions to finite chapter bounds',()=>{
  expect(readingTop([frame(20,1000),frame(1020,500)],-1.5,20,0)).toBe(0);
  expect(readingTop([frame(20,1000),frame(1020,500)],200.5,20,0)).toBe(1500);
  expect(readingTop([frame(20,1000)],NaN,20,0)).toBeNull();
});

it('reports reception-to-first-frame delay and layout count without reporting a device frame rate',async()=>{
  const {createReadingFollower}=await import('./reader-scroll.js');let pos=0,now=100,draw;
  const follow=createReadingFollower({getPosition:()=>pos,setPosition:p=>pos=p,readTarget:()=>100,now:()=>now,requestFrame:fn=>{draw=fn;return 1;},cancelFrame:()=>{draw=null;}});
  follow.update();now=125;draw(now);
  expect(follow.stats()).toMatchObject({updates:1,frames:1,geometryReads:1,firstFrameDelayMs:25});
  follow.destroy();
});
