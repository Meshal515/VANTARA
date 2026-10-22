import test from 'node:test';
import assert from 'node:assert/strict';
import { validateResourceRequest,resolvePublicURL } from './services.mjs';

test('طلبات صفحات المصادر تقبل POST المحدود وتمنع إرسال هوية حساب فانتارا', () => {
  const request = validateResourceRequest({ url: 'https://source.example/ajax', method: 'POST', body: 'action=chapters', headers: { 'content-type': 'application/x-www-form-urlencoded', referer: 'https://source.example/' } });
  assert.equal(request.method, 'POST');
  assert.equal(request.body, 'action=chapters');
  for (const headers of [{ authorization: 'Bearer account' }, { Host: '127.0.0.1' }, { cookie: 'line\nbreak' }])
    assert.throws(() => validateResourceRequest({url:'https://source.example/',headers}));
  for (const method of ['DELETE', 'PUT', 'CONNECT']) assert.throws(() => validateResourceRequest({url:'https://source.example/',method}));
  assert.throws(() => validateResourceRequest({url:'https://source.example/',method:'POST',body:'x'.repeat(65537)}));
});
test('النقل المثبت يفضل IPv4 العام عندما لا تتوفر شبكة IPv6 على ويندوز',async()=>{
  const selected=await resolvePublicURL('https://example.com/',async()=>[{address:'2606:4700::1111',family:6},{address:'93.184.216.34',family:4}]);
  assert.equal(selected.family,4);assert.equal(selected.address,'93.184.216.34');
});
