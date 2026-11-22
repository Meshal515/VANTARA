import {expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({r:null}));vi.mock('../runtime.js',()=>({getRuntime:()=>state.r}));
const {MangaEngine}=await import('./manga.js');
it('remote manga pages and covers stay on their public URL without requesting core image grants',async()=>{state.r={ready:Promise.resolve(),registry:{source:()=>({}),def:()=>({domain:'addon.test'})},ensureMedia:async()=>{throw new Error('auth');},fetcher:{mediaUrl:()=>{throw new Error('proxy');}}};expect((await MangaEngine.image({sourceId:'addon|demo',page:{imageUrl:'https://cdn.test/page.jpg'}})).path).toBe('https://cdn.test/page.jpg');expect((await MangaEngine.cover({sourceId:'addon|demo',url:'https://cdn.test/cover.jpg'})).path).toBe('https://cdn.test/cover.jpg');await expect(MangaEngine.image({sourceId:'addon|demo',page:{imageUrl:'javascript:evil()'}})).rejects.toThrow();});
// WB1: فتح العمل صراحة يطلب قائمة الفصول طازجة (كانت 30 دقيقة بلا طريق تحديث، فلا يظهر الفصل الجديد)
it('an explicit open asks the chapter list fresh; background reads keep the cache',async()=>{
  const calls=[];
  state.r={ready:Promise.resolve(),registry:{def:()=>null,call:async(_id,fn)=>fn({series:async()=>({manga:{title:'x',url:'/m'},chapters:[{name:'1',url:'/1'}]})})},store:{cached:async(_ns,_key,load,opts)=>{calls.push(Boolean(opts?.fresh));return {value:await load()};}}};
  await MangaEngine.series({sourceId:'s',manga:{url:'/m'}});
  await MangaEngine.series({sourceId:'s',manga:{url:'/m'},fresh:true});
  await MangaEngine.chapters({sourceId:'s',manga:{url:'/m'},fresh:true});
  expect(calls).toEqual([false,true,true]);
});
