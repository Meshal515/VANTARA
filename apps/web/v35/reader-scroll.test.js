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
  expect(readingPosition([frame(-1200,600),frame(-600,600)],0)).toBe(1.999999);
});
