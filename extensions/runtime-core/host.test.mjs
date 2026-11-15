import {test} from 'node:test';import assert from 'node:assert/strict';import {createCompatibilityHost} from './host.mjs';
const descriptor=(sourceId='one',family='cloudstream')=>({family,packageId:'fixture.package',sourceId,version:'1',sessionId:'private-session',allowedOrigins:['https://fixture.example']});
const ownFixtureBackend=(operations)=>({profile:'authored-fixture-only',operations});
test('an unregistered family/runtime never advertises operational support',async()=>{
 const h=createCompatibilityHost();assert.deepEqual(h.list(),[]);await assert.rejects(h.invoke(descriptor(),'catalogue',{}),e=>e.code==='SOURCE_NOT_REGISTERED');
});
test('runtime capabilities come from real backend methods, not declared names',async()=>{
 const h=createCompatibilityHost();h.register(descriptor(),ownFixtureBackend({catalogue:async()=>({items:[]})}));
 await assert.rejects(h.invoke(descriptor(),'videoLinks',{}),e=>e.code==='CAPABILITY_UNSUPPORTED');assert.equal(h.list()[0].state,'registered_unchecked');
 const out=await h.invoke(descriptor(),'catalogue',{});assert.equal(out.items.length,0);assert.equal(h.list()[0].lastResult,'empty');
});
test('repository-family identity is separate from domains and labels',async()=>{
 const h=createCompatibilityHost();const d=descriptor();h.register(d,ownFixtureBackend({search:async()=>({items:[{id:'native-identity',title:'A'}]})}));
 const out=await h.invoke({...d,allowedOrigins:['https://moved.example'],label:'Renamed'},'search',{});assert.equal(out.items[0].id,'native-identity');
 h.register(descriptor('one','aniyomi'),ownFixtureBackend({search:async()=>({items:[]})}));assert.equal(h.list().length,2);
});
test('one backend ABI failure does not become a dead source or break another backend',async()=>{
 const h=createCompatibilityHost();h.register(descriptor('broken'),ownFixtureBackend({search:async()=>{throw Object.assign(Error('private raw URL'),{code:'ABI_MISMATCH'});}}));
 h.register(descriptor('working'),ownFixtureBackend({search:async()=>({items:[{id:'work',title:'Title'}]})}));
 await assert.rejects(h.invoke(descriptor('broken'),'search',{}),e=>e.code==='ABI_MISMATCH'&&e.owner==='runtime'&&!e.message.includes('private'));
 assert.equal((await h.invoke(descriptor('working'),'search',{})).items.length,1);
});
test('garbage, missing items and HTML do not pass as a functioning catalogue',async()=>{
 for(const value of ['<html>Discord</html>',{}, {items:[{id:'x'}]}]){
 const h=createCompatibilityHost();h.register(descriptor(),ownFixtureBackend({catalogue:async()=>value}));await assert.rejects(h.invoke(descriptor(),'catalogue',{}),e=>e.code==='RUNTIME_CONTRACT');}
});
test('forbidden feature routes cannot be registered in the new repository host',()=>{
 for(const op of ['torrent','subtitles','translate','play']){const h=createCompatibilityHost();assert.throws(()=>h.register(descriptor(),ownFixtureBackend({[op]:()=>{}})),e=>e.code==='CAPABILITY_UNSUPPORTED');}
});
test('backend network access always goes through shared source policy',async()=>{
 let calls=0;const h=createCompatibilityHost({transport:async()=>{calls++;return {status:429,headers:new Headers({'retry-after':'60'})};}});
 const backend=ownFixtureBackend({search:async(_,ctx)=>{await ctx.request({url:'https://fixture.example/'});return {items:[]};}});
 h.register(descriptor(),backend);h.register(descriptor('two'),backend);
 await assert.rejects(h.invoke(descriptor(),'search',{}),e=>e.code==='RATE_LIMITED'&&e.owner==='network');
 await assert.rejects(h.invoke(descriptor('two'),'search',{}),e=>e.code==='HOST_COOLDOWN');assert.equal(calls,1);
});
test('duplicate registration preserves the existing source and original native ID',async()=>{
 const h=createCompatibilityHost(),d=descriptor('one','mihon');h.register(d,ownFixtureBackend({chapters:async()=>({items:[]})}));
 assert.throws(()=>h.register(d,ownFixtureBackend({})),e=>e.code==='ALREADY_REGISTERED');assert.equal(h.list().length,1);
});

test('another session cannot invoke a registered backend or reuse its private scope',async()=>{
 const h=createCompatibilityHost();let calls=0;h.register(descriptor(),ownFixtureBackend({search:async()=>{calls++;return {items:[]};}}));
 await assert.rejects(h.invoke({...descriptor(),sessionId:'another-profile'},'search',{}),e=>e.code==='SESSION_MISMATCH');assert.equal(calls,0);
});
test('plugins cannot substitute the host transport or promote background requests',async()=>{
 let calls=0;const h=createCompatibilityHost({transport:async()=>{calls++;return {status:429,headers:new Headers({'retry-after':'60'})};}});
 h.register(descriptor(),ownFixtureBackend({search:async(_,ctx)=>{await ctx.request({url:'https://fixture.example/',background:false},()=>({status:200}));return {items:[]};}}));
 await assert.rejects(h.invoke(descriptor(),'search',{}, {background:true}),e=>e.code==='BACKGROUND_DISABLED');assert.equal(calls,0);
 await assert.rejects(h.invoke(descriptor(),'search',{}),e=>e.code==='RATE_LIMITED');assert.equal(calls,1);
});
test('actual success clears that operation failure without erasing another failed capability',async()=>{
 let fail=true;const h=createCompatibilityHost();h.register(descriptor(),ownFixtureBackend({search:async()=>{if(fail)throw Error('fixture failure');return {items:[{id:'one',title:'A'}]};},catalogue:async()=>({items:[]})}));
 await assert.rejects(h.invoke(descriptor(),'search',{}));await h.invoke(descriptor(),'catalogue',{});
 assert.equal(h.list()[0].checks.search.state,'error');assert.equal(h.list()[0].checks.catalogue.state,'empty');
 fail=false;await h.invoke(descriptor(),'search',{});assert.equal(h.list()[0].lastError,undefined);assert.equal(h.list()[0].checks.search.state,'returned_items');
});
