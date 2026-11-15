import {it,expect} from 'vitest';
import {createCloudStreamRepositories,isNativeRuntimeCopy} from './cloudstream-runtime.js';

it('does not reinterpret Stremio torrent sources as native CloudStream adapters',()=>{
  expect(isNativeRuntimeCopy({sourceId:'addon|cs3|cs3_abc|source'})).toBe(true);
  expect(isNativeRuntimeCopy({sourceId:'addon|https://torrentio/manifest.json'})).toBe(false);
  expect(isNativeRuntimeCopy({sourceId:'witanime'})).toBe(true);
});
it('requires measured Android runtime capability and preserves method results from its real bridge contract',async()=>{
  expect(await createCloudStreamRepositories(null)).toBe(null);
  expect(await createCloudStreamRepositories({capabilities:async()=>({cloudstream:false})})).toBe(null);
  const calls=[];
  const plugin={capabilities:async()=>({cloudstream:true,platform:'android'}),
    setProfile:async args=>{calls.push(['profile',args]);},
    list:async()=>({repos:[{url:'https://repo.test/repo.json',name:'Actual repository'}],installed:[]}),
    extensions:async args=>({extensions:[{pkg:'cs3_one',name:'Provider',protocol:'cloudstream',repoUrl:args.url}]}),
    install:async args=>{calls.push(['install',args]);return {pkg:args.pkg,installed:true};},
    uninstall:async args=>calls.push(['uninstall',args]),enable:async args=>calls.push(['enable',args]),
    addRepository:async args=>({name:'Actual repository',url:args.url}),removeRepository:async args=>calls.push(['remove',args])};
  const store=await createCloudStreamRepositories(plugin);
  await store.setProfile('account-one');
  expect((await store.list()).repos[0].name).toBe('Actual repository');
  expect((await store.extensions('https://repo.test/repo.json'))[0].pkg).toBe('cs3_one');
  expect((await store.install('https://repo.test/repo.json','cs3_one','cinema')).installed).toBe(true);
  await store.enable('cs3_one',false);await store.uninstall('cs3_one');
  expect(calls).toEqual([['profile',{profile:'account-one'}],['install',{url:'https://repo.test/repo.json',pkg:'cs3_one',content:'cinema'}],['enable',{pkg:'cs3_one',enabled:false}],['uninstall',{pkg:'cs3_one'}]]);
});
