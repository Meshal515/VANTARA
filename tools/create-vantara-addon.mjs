#!/usr/bin/env node
/**
 * First-slice scaffold, not a universal CloudStream/Mihon binary runtime.
 * Usage: node tools/create-vantara-addon.mjs --kind manga|video|subtitles|torrent --name MyAddon --dir ./MyAddon --origin https://addons.example.org
 * All generated artifacts are inspectable source; no eval or executable addon
 * code is imported into VANTARA's browser.
 */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const DEFAULT_ORIGIN='https://addons.example.org';

export function makeManifest({kind,name,origin=DEFAULT_ORIGIN}){
  if(!['manga','video','subtitles','torrent'].includes(kind))throw Error('Choose --kind manga|video|subtitles|torrent');
  if(typeof name!=='string'||!name.trim()||name.length>90)throw Error('Provide a short --name');
  let url;
  try{url=new URL(origin);}catch{throw Error('--origin must be a public HTTPS origin');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||url.pathname!=='/'||
      !/^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$/i.test(url.hostname)||
      /^(?:localhost|127\.|10\.|192\.168\.)/.test(url.hostname))throw Error('--origin must be a public HTTPS origin');
  const slug=name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,55)||'my-addon';
  const common={id:'org.vantara.'+slug.replace(/-/g,'.'),name:name.trim(),version:'1.0.0'};
  if(kind==='manga')return {
    ...common,
    protocolVersion:1,minVantaraVersion:'0.2.0',runtime:'remote',
    contentTypes:['manga'],capabilities:['home','search','details','chapters','pages'],
    baseUrl:url.href,
    resources:{home:'/home?page={page}',search:'/search?query={query}&page={page}',details:'/details/{workId}',chapters:'/chapters/{workId}',pages:'/pages/{chapterId}'},
    permissions:{networkHosts:[url.hostname],verification:false},
    description:'Starter only — replace empty resource responses with your own permitted manga catalog.'
  };
  return {
    ...common,
    types:kind==='subtitles'?['movie','series']:['movie'],
    resources:kind==='subtitles'?['subtitles']:kind==='torrent'?['stream']:['catalog','meta','stream','subtitles'],
    catalogs:kind==='video'?[{type:'movie',id:'sample',name:'Example (empty)'}]:[],
    ...(kind==='torrent'?{idPrefixes:['demo:']}:{}),
    description:'Starter only — responses contain no playable media. Implement lawful providers before publishing.'
  };
}

export function parseOptions(argv){
  const o={};
  for(let i=0;i<argv.length;i++){
    const v=argv[i];
    if(v==='--help'||v==='-h'){o.help=true;continue;}
    if(!['--kind','--name','--dir','--origin'].includes(v)||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Expected --kind --name --dir [--origin]; see --help');
    o[v.slice(2)]=argv[++i];
  }
  return o;
}
const usage=`VANTARA Add-on Kit
  node tools/create-vantara-addon.mjs --kind manga --name "My Manga" --dir ./my-manga --origin https://addons.example.org
  node tools/create-vantara-addon.mjs --kind video --name "My Movies" --dir ./my-movies --origin https://addons.example.org
  Kinds: manga, video (Stremio protocol), subtitles (Stremio), torrent (Stremio stream protocol)
  The generator never overwrites an existing directory; for production serve via HTTPS.`;

export async function createAddon({kind,name,dir,origin=DEFAULT_ORIGIN}){
  if(!dir||typeof dir!=='string')throw Error('Please specify --dir');
  const manifest=makeManifest({kind,name,origin});
  const destination=resolve(dir);
  // No recursive overwrite. Existing libraries and credentials are never touched.
  await mkdir(destination,{recursive:false});
  const files={
    'manifest.json':JSON.stringify(manifest,null,2)+'\n',
    'index.mjs':await readFile(new URL('./addon-kit-server-template.mjs',import.meta.url),'utf8'),
    'package.json':JSON.stringify({
      name:'vantara-'+manifest.id.replace(/[^a-z0-9-]/ig,'-').toLowerCase(),
      version:'1.0.0',private:true,type:'module',
      scripts:{dev:'node index.mjs',test:'node --test addon.test.mjs'}
    },null,2)+'\n',
    'addon.test.mjs':`import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAddonServer} from './index.mjs';
test('manifest and resources respond with real JSON',async()=>{
 const server=createAddonServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const manifest=await (await fetch(base+'/manifest.json')).json();
  assert.equal(manifest.id,${JSON.stringify(manifest.id)});
  assert.equal(manifest.name,${JSON.stringify(manifest.name)});
  const route=${JSON.stringify(kind==='manga'?'/home':kind==='subtitles'?'/subtitles/movie/demo.json':kind==='torrent'?'/stream/movie/demo.json':'/catalog/movie/sample.json')};
  const response=await fetch(base+route);assert.equal(response.status,200);
  const data=await response.json();assert.ok(data&&typeof data==='object');
  const missing=await fetch(base+'/does-not-exist');assert.equal(missing.status,404);
 }finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});`,
    'README.md':`# ${manifest.name}

Generated with the official VANTARA Add-on Kit **starter template**.

- Type: ${kind}
- Dev preview: \`npm run dev\` (localhost:8787)
- Smoke test: \`npm test\` (built-in Node test runner, no dependencies)
- Production: replace the demo/empty JSON routes in \`index.mjs\` with real authorized source data and deploy them over **HTTPS**, with CORS and stable origin. Update \`manifest.json\` accordingly.
- Open your published \`https://YOUR-DOMAIN/manifest.json\` in VANTARA; this local HTTP dev preview is not installable by the production addon registry.
- ${kind==='manga'?'VANTARA Remote v1 manga endpoints are data-only. Support differs by platform; do not advertise native Android capability before verified.':'This is a standard Stremio-style manifest, not a CloudStream .cs3 plugin. Android/Windows/PWA behavior depends on the app runtime and media decoding.'}
- No streams, images or chapters are included in this scaffold. Do not claim media is playable until a real functional test succeeds.
- Never paste private account cookies/API secrets into a public manifest.
`
  };
  for(const [name,body] of Object.entries(files))await writeFile(resolve(destination,name),body,{flag:'wx'});
  return {directory:destination,manifest};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=parseOptions(process.argv.slice(2));
    if(args.help){process.stdout.write(usage+'\n');process.exitCode=0;}
    else{
      const out=await createAddon(args);
      process.stdout.write('Created '+out.directory+'\n'+
        'Run: cd '+out.directory+' && npm test && npm run dev\n'+
        'IMPORTANT: preview is local only; deploying HTTPS and real source implementation remain required.\n');
    }
  }catch(e){process.stderr.write('Add-on Kit: '+e.message+'\n\n'+usage+'\n');process.exitCode=1;}
}
