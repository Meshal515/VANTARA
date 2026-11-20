const test=require('node:test');
const assert=require('node:assert/strict');
const {firstPartyRequest,serverOrigin}=require('./first-party.cjs');
test('نقل الحسابات يصل للخادم الأصلي وحده ولا يمرر هوية الحساب إلى إضافات خارجية',async()=>{
  let called;
  const out=await firstPartyRequest({url:'https://vantara-sync.ngm-309.workers.dev/v1/accounts',method:'GET',headers:{authorization:'Bearer private-session'}},async(url,options)=>{called={url,options};return new Response('{"accounts":[]}',{status:200,headers:{'content-type':'application/json'}});});
  assert.equal(out.status,200);assert.equal(out.text,'{"accounts":[]}');
  assert.equal(called.options.headers.authorization,'Bearer private-session');
  for(const url of ['https://torrentio.strem.fun/v1/accounts','http://vantara-sync.ngm-309.workers.dev/v1/accounts','https://vantara-sync.ngm-309.workers.dev.example/v1/accounts'])
    await assert.rejects(firstPartyRequest({url},async()=>{throw Error('طلب خارجي غير متوقع');}));
});
test('صورة الحساب الثنائية تصل دون تحويل بايتاتها إلى نص',async()=>{
  const bytes=Buffer.from([0,255,137,80,78,71]);let sent;
  await firstPartyRequest({url:'https://vantara-sync.ngm-309.workers.dev/v1/media',method:'POST',headers:{'content-type':'image/png'},bodyBase64:bytes.toString('base64')},async(_url,options)=>{sent=options.body;return new Response('{}');});
  assert.deepEqual(sent,bytes);
});
test('خادم بديل ضبطه المستخدم يُقبل وحده بجانب الأصلي، وHTTP خارجي لا',async()=>{
  assert.equal(serverOrigin('https://my-sync.example.workers.dev/'),'https://my-sync.example.workers.dev');
  assert.equal(serverOrigin('http://127.0.0.1:8787'),'http://127.0.0.1:8787');
  for(const bad of ['http://evil.example','https://u:p@x.example','javascript:alert(1)',''])assert.equal(serverOrigin(bad),null,bad);
  const origins=['https://vantara-sync.ngm-309.workers.dev','https://my-sync.example.workers.dev'];
  const ok=await firstPartyRequest({url:'https://my-sync.example.workers.dev/v1/sync'},async()=>new Response('{}'),origins);
  assert.equal(ok.status,200);
  await assert.rejects(firstPartyRequest({url:'https://other.example/v1/sync'},async()=>new Response('{}'),origins));
});
