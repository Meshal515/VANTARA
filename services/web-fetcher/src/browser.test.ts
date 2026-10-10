import { describe,it,expect } from 'vitest';
import { browserFallback } from './browser.ts';
const env={BROWSER_FETCH_URL:'https://private-browser.example/fetch',BROWSER_FETCH_SECRET:'private-test-secret-at-least-32-chars'};
const input={url:'https://witanime.site/search?q=clover',method:'GET',headers:new Headers(),follow:true};
describe('optional browser fallback',()=>{
 it('isolates users, passes POST and redirect semantics, and never forwards user authorization',async()=>{
  const seen: Record<string,unknown>[]=[];
  const fetchImpl=(async(_url:unknown,init:RequestInit)=>{seen.push(JSON.parse(String(init.body)));expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${env.BROWSER_FETCH_SECRET}`);return Response.json({status:200,url:input.url,text:'cards',type:'text/html'});}) as typeof fetch;
  expect(await browserFallback(env,'host',input,fetchImpl)).not.toBeNull();
  await browserFallback(env,'guest',{...input,method:'POST',body:'View=1',follow:false},fetchImpl);
  expect(seen[0]!.session).not.toBe(seen[1]!.session);expect(seen[1]).toMatchObject({method:'POST',body:'View=1',follow:false});
 });
 it('is disabled without configuration and rejects other sources, insecure backend, or foreign responses',async()=>{
  let calls=0;const fake=(async()=>{calls++;return Response.json({status:200,url:'http://127.0.0.1/',text:'bad'});}) as typeof fetch;
  expect(await browserFallback({},'host',input,fake)).toBeNull();
  expect(await browserFallback(env,'host',{...input,url:'https://witanime.site.evil.test/'},fake)).toBeNull();
  expect(await browserFallback({...env,BROWSER_FETCH_URL:'http://private.test/'},'host',input,fake)).toBeNull();expect(calls).toBe(0);
  expect(await browserFallback(env,'host',input,fake)).toBeNull();expect(calls).toBe(1);
 });
});
