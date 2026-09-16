const fs=require("fs");
const SU="http://uchiyomi-suwayomi:4567";
const targets=[["MangaSwat","/api/v1/manga/28/chapter/330/page/"],["Azora","/api/v1/manga/4/chapter/332/page/"]];
const sniff=b=>{
 if(b[0]===0xFF&&b[1]===0xD8)return "JPEG";
 if(b[0]===0x89&&b[1]===0x50)return "PNG";
 if(b.slice(0,4).toString()==="RIFF"&&b.slice(8,12).toString()==="WEBP")return "WEBP";
 if(b.slice(0,6).toString().startsWith("GIF8"))return "GIF";
 const h=b.slice(0,200).toString("utf8").toLowerCase();
 if(h.includes("<html")||h.includes("<!doctype"))return "HTML!!";
 return "UNKNOWN("+b.slice(0,8).toString("hex")+")";
};
const dims=(b,t)=>{
 try{
  if(t==="JPEG"){let i=2;while(i<b.length){if(b[i]!==0xFF){i++;continue;}const m=b[i+1];if(m>=0xC0&&m<=0xCF&&m!==0xC4&&m!==0xC8&&m!==0xCC){return b.readUInt16BE(i+5)+"x"+b.readUInt16BE(i+7);}i+=2+b.readUInt16BE(i+2);}}
  if(t==="PNG")return b.readUInt32BE(16)+"x"+b.readUInt32BE(20);
 }catch(e){}
 return "?";
};
(async()=>{
 for(const [name,base] of targets){
  for(const n of [0,1,2]){
   const t0=Date.now();
   try{
    const r=await fetch(SU+base+n);
    const b=Buffer.from(await r.arrayBuffer());
    const ty=sniff(b);
    const f=`/tmp/pages/${name}-p${n}.${ty.toLowerCase().replace("!!","")}`;
    fs.writeFileSync(f,b);
    console.log(`${name} page${n}: HTTP ${r.status} | ${ty} | ${dims(b,ty)} | ${(b.length/1024).toFixed(0)} KB | ${Date.now()-t0}ms`);
   }catch(e){console.log(`${name} page${n}: ERR ${e.message.slice(0,60)}`);}
  }
 }
})();
