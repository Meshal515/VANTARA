import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseAddonImport } from './import.js';
const raw={id:'org.demo',name:'Demo',version:'1.0.0',types:['movie'],resources:['stream']};
const url='https://addon.test/config/manifest.json';
it('imports one raw manifest only with an explicit service endpoint',()=>{
 expect(parseAddonImport(JSON.stringify(raw))[0].error).toContain('رابط الخدمة');
 expect(parseAddonImport(JSON.stringify(raw),{serviceUrl:url})[0]).toMatchObject({url,raw});
});
it('supports arrays and addon catalog transport descriptors without guessing origins',()=>{
 const out=parseAddonImport(JSON.stringify({addons:[{manifest:raw,transportUrl:url},url,{...raw,id:'org.two'}]}));
 expect(out).toHaveLength(3);expect(out[0]).toMatchObject({url,raw});expect(out[1].url).toBe(url);expect(out[2].error).toBeTruthy();
});
it('keeps invalid entries individually visible, strips no configured tokens from transport',()=>{
 const out=parseAddonImport(JSON.stringify([url,'javascript:alert(1)',null,{url,manifest:raw}]));
 expect(out.map(x=>Boolean(x.error))).toEqual([false,true,true,false]);expect(out[3].url).toContain('/config/');
 expect(out[3].name).toBe('Demo');
});
it('bounds JSON bytes, number of entries and nested hostile objects',()=>{
 expect(()=>parseAddonImport('x'.repeat(1048577))).toThrow();
 expect(()=>parseAddonImport(JSON.stringify(Array(101).fill(url)))).toThrow();
 expect(()=>parseAddonImport('{"__proto__":{"polluted":true}}')).toThrow();
 expect(()=>parseAddonImport('not JSON')).toThrow();
 expect({}.polluted).toBeUndefined();
});
it('normalizes Stremio links and accepts a single URL descriptor',()=>{
 expect(parseAddonImport(JSON.stringify({url:'stremio://addon.test/manifest.json'}))[0].url).toBe('https://addon.test/manifest.json');
});
it('turns a plain service base URL into its manifest endpoint and rejects excessive nesting',()=>{
 expect(parseAddonImport(JSON.stringify(raw),{serviceUrl:'https://addon.test/base'})[0].url).toBe('https://addon.test/base/manifest.json');
 let deep=raw;for(let i=0;i<70;i++)deep={nested:deep};
 expect(()=>parseAddonImport(JSON.stringify(deep))).toThrow();
});
it('previews sectioned server/subtitle packs without inventing manifests for setup-only entries',()=>{
 const out=parseAddonImport(JSON.stringify({streamAddons:[{name:'Streams',manifestUrl:url}],subtitleAddons:[{name:'Setup',manifestUrl:null,configureUrl:'https://setup.test/configure'},{name:'Subs',manifestUrl:'https://subs.test/manifest.json'}]}));
 expect(out).toHaveLength(3);expect(out[0]).toMatchObject({name:'Streams',url});
 expect(out[1]).toMatchObject({name:'Setup'});expect(out[1].error).toContain('رابط الخدمة');
 expect(out[2]).toMatchObject({name:'Subs',url:'https://subs.test/manifest.json'});
});
it('accepts the published VANTARA test pack while leaving configuration-only services unresolved',()=>{
 const text=readFileSync(new URL('../../../docs/addons/vantara-addon-test-pack-v2-arabic-subs.json',import.meta.url),'utf8');
 const out=parseAddonImport(text);expect(out).toHaveLength(15);
 expect(out.find(x=>x.name==='OpenSubtitles v3').url).toBe('https://opensubtitles-v3.strem.io/manifest.json');
 expect(out.find(x=>x.name==='SubSource').error).toContain('رابط الخدمة');
});
