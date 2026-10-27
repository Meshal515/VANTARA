/**
 * Minimal dependency-free VANTARA Add-on preview server.
 * This file is copied by tools/create-vantara-addon.mjs.
 * Empty streams/pages are intentional: never advertise playable media without
 * a real provider response.
 */
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const manifest=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url),'utf8'));
const manga=manifest.protocolVersion===1&&manifest.runtime==='remote';
const toJSON=(res,code,body)=>{
  res.writeHead(code,{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'access-control-allow-origin':'*',
    'access-control-allow-methods':'GET, OPTIONS',
    'x-content-type-options':'nosniff',
  });
  res.end(JSON.stringify(body));
};
export function createAddonServer(){
  return createServer((req,res)=>{
    if(req.method==='OPTIONS')return toJSON(res,204,{});
    if(req.method!=='GET')return toJSON(res,405,{error:'GET only'});
    let u;try{u=new URL(req.url,'http://localhost');}catch{return toJSON(res,400,{error:'bad URL'});}
    if(u.pathname==='/manifest.json')return toJSON(res,200,manifest);
    if(manga){
      if(u.pathname==='/home')return toJSON(res,200,{mangas:[],hasNextPage:false});
      if(u.pathname==='/search')return toJSON(res,200,{mangas:[],hasNextPage:false});
      if(u.pathname.startsWith('/details/'))return toJSON(res,200,{manga:null,chapters:[]});
      if(u.pathname.startsWith('/chapters/'))return toJSON(res,200,{chapters:[]});
      if(u.pathname.startsWith('/pages/'))return toJSON(res,200,{pages:[]});
    }else{
      if(/^\/catalog\/movie\/sample\.json$/.test(u.pathname))return toJSON(res,200,{metas:[]});
      if(/^\/meta\/movie\/[^/]+\.json$/.test(u.pathname))return toJSON(res,200,{meta:null});
      if(/^\/stream\/movie\/[^/]+\.json$/.test(u.pathname))return toJSON(res,200,{streams:[]});
      if(/^\/subtitles\/(?:movie|series)\/[^/]+\.json$/.test(u.pathname))return toJSON(res,200,{subtitles:[]});
    }
    return toJSON(res,404,{error:'resource unavailable'});
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.PORT||8787);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT must be a number from 1024 to 65535');
  createAddonServer().listen(port,'127.0.0.1',()=>{
    process.stdout.write('VANTARA addon local preview at http://127.0.0.1:'+port+'/manifest.json\\n');
  });
}
