import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserBackend} from './browser-fetch-service.mjs';
const secret='test-backend-secret-more-than-32-characters';
function browser(){const contexts=[];return {contexts,async newContext(){const c={closed:false,route:async(_pattern,fn)=>{c.guard=fn;},newPage:async()=>({goto:async()=>({status:()=>200}),url:()=> 'https://witanime.site/',waitForFunction:async()=>{},content:async()=>'<main>works</main>',close:async()=>{}}),close:async()=>{c.closed=true;}};contexts.push(c);return c;}};}
test('backend denies unauthenticated callers before creating a browser session',async()=>{
 const b=browser(),backend=await createBrowserBackend({browser:b,secret});await new Promise(r=>backend.server.listen(0,'127.0.0.1',r));
 try{const res=await fetch(`http://127.0.0.1:${backend.server.address().port}/fetch`,{method:'POST',body:'{}'});assert.equal(res.status,401);assert.equal(b.contexts.length,0);}finally{await backend.close();}
});
test('backend isolates concurrent users, bounds contexts, and blocks foreign subrequests',async()=>{
 const b=browser(),backend=await createBrowserBackend({browser:b,secret,maxSessions:2});
 const input={url:'https://witanime.site/',session:'a'.repeat(64)};
 try{
  await Promise.all([backend.fetchPage(input),backend.fetchPage(input)]);assert.equal(b.contexts.length,1);
  await backend.fetchPage({...input,session:'b'.repeat(64)});assert.equal(b.contexts.length,2);
  await assert.rejects(backend.fetchPage({...input,session:'c'.repeat(64)}),/capacity/);
  for(const url of ['https://evil.test/','https://witanime.site.evil.test/','http://127.0.0.1/']){
   await assert.rejects(backend.fetchPage({...input,url}),/host_not_allowed/);
   let blocked=false;await b.contexts[0].guard({request:()=>({url:()=>url}),abort:()=>{blocked=true;},continue:()=>{}});assert.equal(blocked,true);
  }
 }finally{await backend.close();assert.ok(b.contexts.every(c=>c.closed));}
});
