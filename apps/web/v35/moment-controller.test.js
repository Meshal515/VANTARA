import {it,expect,vi} from 'vitest';
import {createMomentController} from './moment-controller.js';
const row={id:'r',series_ref:'anime:42',series_title:'work',chapter_number:3,moment_json:JSON.stringify({version:1,startMs:10000,endMs:30000,episode:3})};
it('opens the mini viewer rather than navigating to server selection and hands native playback its range',async()=>{
 let opts;const engine={open:vi.fn(async()=>true),findWork:vi.fn()};const viewer=vi.fn(o=>{opts=o;return{destroy:vi.fn(),handleBack:()=>true};});
 const c=createMomentController({engine,viewer,native:()=>true});c.open(row);expect(viewer).toHaveBeenCalledOnce();await opts.playNative({row,source:{session:'local',candidate:'ready'}});expect(engine.open.mock.calls[0][0]).toMatchObject({session:'local',candidate:'ready',clipStart:10000,clipEnd:30000,position:10000,momentMini:true});expect(c.handleBack()).toBe(true);
});
it('saves through the device registered candidate without sending URLs to the export bridge',async()=>{
 let opts;const engine={exportMoment:vi.fn(async()=>({saved:true}))};const c=createMomentController({engine,native:()=>true,viewer:o=>{opts=o;return{destroy(){}};}});c.open(row);
 await opts.saveVideo({row,source:{session:'s',candidate:'c',url:'https://sensitive.example/?token=x'},startMs:10000,endMs:30000,filename:'clip.mp4'});
 expect(engine.exportMoment).toHaveBeenCalledWith({session:'s',candidate:'c',startMs:10000,endMs:30000,filename:'clip.mp4',action:'save'});
});
