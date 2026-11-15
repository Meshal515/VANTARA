import {test} from 'node:test';import assert from 'node:assert/strict';
import {createNetworkPolicy} from './network-policy.mjs';
const context=(sourceId='one',sessionId='private-a')=>({sourceId,sessionId,allowedOrigins:['https://source.example'],allowBackground:false});
const reply=(status=200,headers={})=>({status,headers:new Headers(headers)});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const code=(name)=>e=>e.code===name;
test('one domain budget covers different source plugins',async()=>{
 const p=createNetworkPolicy(),d=deferred();const a=p.run(context(),{url:'https://source.example/a'},()=>d.promise);
 await assert.rejects(p.run(context('two'),{url:'https://source.example/b'},()=>reply()),code('HOST_BUSY'));d.resolve(reply());await a;
});
test('a blocked host does not stall another host',async()=>{
 const p=createNetworkPolicy();await assert.rejects(p.run(context(),{url:'https://source.example/a'},()=>reply(429,{'retry-after':'60'})),code('RATE_LIMITED'));
 await p.run({...context(),allowedOrigins:['https://other.example']},{url:'https://other.example/'},()=>reply());
});
test('Retry-After applies across plugins and no automatic retry occurs',async()=>{
 let now=1000,calls=0;const p=createNetworkPolicy({now:()=>now});
 await assert.rejects(p.run(context(),{url:'https://source.example/'},()=>{calls++;return reply(429,{'retry-after':'120'});}),code('RATE_LIMITED'));
 now=120999;await assert.rejects(p.run(context('two'),{url:'https://source.example/'},()=>{calls++;return reply();}),code('HOST_COOLDOWN'));assert.equal(calls,1);
 now=121000;await p.run(context('two'),{url:'https://source.example/'},()=>{calls++;return reply();});assert.equal(calls,2);
});
test('HTTP-date Retry-After accounts for a server Date header',async()=>{
 let now=1000;const p=createNetworkPolicy({now:()=>now});
 await assert.rejects(p.run(context(),{url:'https://source.example/'},()=>reply(429,{'date':'Wed, 01 Jan 2025 00:00:00 GMT','retry-after':'Wed, 01 Jan 2025 00:02:00 GMT'})),e=>e.code==='RATE_LIMITED'&&e.retryAt===121000);
});
test('confirmed challenge is scoped to cookie session and requires an opaque host ticket',async()=>{
 const notices=[];const p=createNetworkPolicy({onVerificationRequired:x=>notices.push(x)});
 await assert.rejects(p.run(context(),{url:'https://source.example/'},()=>reply(200,{'cf-mitigated':'challenge'})),e=>e.code==='VERIFICATION_REQUIRED'&&!('ticket'in e));
 assert.equal(notices.length,1);assert.equal(p.completeVerification('forged'),false);
 await assert.rejects(p.run(context('two'),{url:'https://source.example/'},()=>reply()),code('VERIFICATION_REQUIRED'));
 await p.run(context('two','private-b'),{url:'https://source.example/'},()=>reply());
 assert.equal(p.completeVerification(notices[0].ticket),true);
 await p.run(context(),{url:'https://source.example/'},()=>reply());
});
test('bare 403 is an access denial, never proof of Cloudflare or an IP ban',async()=>{
 const notices=[];const p=createNetworkPolicy({onVerificationRequired:x=>notices.push(x)});
 await assert.rejects(p.run(context(),{url:'https://source.example/'},()=>reply(403)),code('ACCESS_DENIED'));assert.equal(notices.length,0);
});
test('background calls require explicit source policy permission',async()=>{
 let calls=0;const p=createNetworkPolicy();await assert.rejects(p.run(context(),{url:'https://source.example/',background:true},()=>{calls++;return reply();}),code('BACKGROUND_DISABLED'));assert.equal(calls,0);
});
test('unsupported origins and control characters never reach transport',async()=>{
 const p=createNetworkPolicy();let calls=0;
 for(const url of ['http://source.example/','https://source.example.evil/','https://source.example/\r\nX:bad','https://u:p@source.example/'])await assert.rejects(p.run(context(),{url},()=>{calls++;return reply();}));assert.equal(calls,0);
});
test('caller abort returns promptly, but a transport ignoring abort retains its physical lease',async()=>{
 const p=createNetworkPolicy(),d=deferred(),c=new AbortController();const run=p.run(context(),{url:'https://source.example/',signal:c.signal},()=>d.promise);
 await Promise.resolve();c.abort();await assert.rejects(run,e=>e.name==='AbortError');
 await assert.rejects(p.run(context('two'),{url:'https://source.example/'},()=>reply()),code('HOST_BUSY'));
 d.resolve(reply());await new Promise(r=>setImmediate(r));await p.run(context(),{url:'https://source.example/'},()=>reply());
});
test('transport timeout does not free a still-running lease or retry the request',async()=>{
 const p=createNetworkPolicy({timeoutMs:10}),d=deferred();let calls=0;
 await assert.rejects(p.run(context(),{url:'https://source.example/'},()=>{calls++;return d.promise;}),code('TRANSPORT_TIMEOUT'));
 await assert.rejects(p.run(context('two'),{url:'https://source.example/'},()=>reply()),code('HOST_BUSY'));assert.equal(calls,1);d.resolve(reply());
});
test('transport exception stays separate from a provider or verification verdict',async()=>{
 const p=createNetworkPolicy(),notices=[];await assert.rejects(p.run(context(),{url:'https://source.example/'},()=>{throw Error('secret-url-value');}),e=>e.code==='TRANSPORT_FAILED'&&!e.message.includes('secret'));assert.equal(notices.length,0);
});
test('invalid identity never reaches a backend',async()=>{
 const p=createNetworkPolicy();await assert.rejects(p.run({...context(),sessionId:''},{url:'https://source.example/'},()=>reply()),code('INVALID_CONTEXT'));
});
test('simultaneous challenges cannot overfill a verification bound',async()=>{
 const notices=[],p=createNetworkPolicy({maxChallenges:1,onVerificationRequired:x=>notices.push(x)}),a=deferred(),b=deferred();
 const first=p.run(context(),{url:'https://source.example/'},()=>a.promise);
 const second=p.run({...context('two'),allowedOrigins:['https://other.example']},{url:'https://other.example/'},()=>b.promise);
 a.resolve(reply(403,{'cf-mitigated':'challenge'}));await assert.rejects(first,code('VERIFICATION_REQUIRED'));
 b.resolve(reply(403,{'cf-mitigated':'challenge'}));await assert.rejects(second,code('POLICY_CAPACITY'));assert.equal(notices.length,1);
});
test('an in-flight request retains the originating session identity',async()=>{
 const notices=[],p=createNetworkPolicy({onVerificationRequired:x=>notices.push(x)}),d=deferred(),c=context();
 const run=p.run(c,{url:'https://source.example/'},()=>d.promise);c.sessionId='other-private-session';
 d.resolve(reply(403,{'cf-mitigated':'challenge'}));await assert.rejects(run,code('VERIFICATION_REQUIRED'));assert.equal(notices[0].sessionId,'private-a');
});
test('transport receives trusted immutable identity separately from untrusted request fields',async()=>{
 const p=createNetworkPolicy();let received,scope;
 await p.run(context(),{url:'https://source.example/',sessionId:'forged',sourceId:'forged',headers:{accept:'text/html'}},(req,ctx)=>{received=req;scope=ctx;return reply();});
 assert.equal(received.sessionId,undefined);assert.equal(received.sourceId,undefined);assert.equal(scope.sessionId,'private-a');assert.equal(scope.sourceId,'one');assert.equal(Object.isFrozen(scope),true);
});
