import {it,expect,vi} from 'vitest';
import {createMomentSourceResolver} from './moment-sources.js';
it('uses attached public source then recipient own prepared candidates, preserving the bounded range',async()=>{
 const engine={findWork:vi.fn(async()=>({copies:[{sourceId:'own',url:'/show'}]})),prepare:vi.fn(async()=>({session:'own-session'})),best:vi.fn(async()=>({candidate:'own-c'})),momentCandidates:vi.fn(async()=>[{id:'own-c',url:'https://own.example/video.m3u8',container:'HLS',sourceId:'own'}]),closeSession:vi.fn()};
 const resolve=createMomentSourceResolver({engine});
 const row={series_ref:'anime:42',series_title:'عمل',chapter_number:3,moment_json:JSON.stringify({version:1,startMs:12000,endMs:32000,episode:3,sources:[{url:'https://sender.example/stream.mp4'},{url:'http://127.0.0.1:5544/secret'}]})};
 const sources=await resolve(row);expect(sources.map(s=>s.url)).toEqual(['https://sender.example/stream.mp4','https://own.example/video.m3u8']);expect(sources[1]).toMatchObject({session:'own-session',candidate:'own-c'});expect(engine.prepare.mock.calls[0][0].identity).toMatchObject({canonicalId:'anime:42',externalIds:{anilist:42},episode:3});await sources[1].release();expect(engine.closeSession).toHaveBeenCalledWith('own-session');
});
it('uses recipient desktop proxy for torrent without sending the original device localhost url',async()=>{
 const engine={findWork:async()=>null,prepare:async()=>({session:'s'}),best:async()=>({candidate:'torrent'}),momentCandidates:async()=>[{id:'torrent',url:'magnet:?xt=abc',infoHash:'a'.repeat(40)}],closeSession:vi.fn()};
 const desktop={prepareMoment:vi.fn(async()=>({url:'http://127.0.0.1:4000/own-token',exportHandle:'handle'})),releaseMoment:vi.fn()};
 const r=await createMomentSourceResolver({engine,desktop})({series_ref:'cinema:tt123456:1',series_title:'show',chapter_number:2,chapter_label:'الحلقة 2 · 0:10–0:30'});
 expect(desktop.prepareMoment).not.toHaveBeenCalled();expect(await r[0].prepare()).toMatchObject({url:'http://127.0.0.1:4000/own-token',exportHandle:'handle',candidate:'torrent'});await r[0].release();expect(desktop.releaseMoment).toHaveBeenCalledWith({session:'s',exportHandle:'handle'});
});
