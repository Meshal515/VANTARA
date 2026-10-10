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
