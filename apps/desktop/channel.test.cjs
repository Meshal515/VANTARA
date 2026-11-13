const {test}=require('node:test');const assert=require('node:assert/strict');
const {parseChannel,rendererArguments}=require('./channel.cjs');
test('Debug and Stable never share identity, data, or update manifest',()=>{
  const debug=parseChannel({channel:'debug',build:7,sourceSha:'0123456789abcdef0123456789abcdef01234567',builtAt:'2026-11-13T00:00:00Z'});
  const stable=parseChannel({channel:'stable',build:215});
  assert.equal(debug.productName,'VANTARA Debug');assert.equal(stable.productName,'VANTARA');
  assert.notEqual(debug.appId,stable.appId);assert.notEqual(debug.manifestUrl,stable.manifestUrl);
  assert.match(debug.manifestUrl,/windows-debug-channel\/desktop-debug\.json$/);
  // Stable يقرأ آخر إصدار مستقر لا القناة القديمة 0.3.x التي سببت الرجوع لواجهة أقدم
  assert.doesNotMatch(stable.manifestUrl,/windows-channel/);
  assert.deepEqual(rendererArguments(debug,'0.4.7'),['--vantara-version=0.4.7','--vantara-channel=debug','--vantara-build=7','--vantara-source=0123456789abcdef0123456789abcdef01234567','--vantara-built=2026-11-13T00:00:00.000Z']);
});
test('missing or hostile channel.json falls back to Stable without a build number',()=>{
  for(const raw of [null,{},{channel:'nightly',build:-1,sourceSha:'zz'},{channel:'debug',build:1.5}]){
    const info=parseChannel(raw);
    assert.equal(info.build,null);
    if(raw?.channel!=='debug')assert.equal(info.channel,'stable');
  }
});
