const EP="http://uchiyomi-suwayomi:4567/api/graphql";
const gql=async(query,variables)=>{const r=await fetch(EP,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query,variables})});return r.json();};
const err=j=>(j.errors&&j.errors[0]&&(j.errors[0].message||"").split("\n")[0].slice(0,80))||null;
(async()=>{
 console.log("### Arabic query retry: نانو ماشين");
 for(const [sid,label] of [["4110737012647435874","Team X"],["1073624495230267708","3asq"]]){
  for(const q of ["نانو","نانو ماشين","Nano"]){
   const s=await gql(`mutation($i:FetchSourceMangaInput!){fetchSourceManga(input:$i){mangas{id title}}}`,{i:{source:sid,type:"SEARCH",query:q,page:1}});
   const e=err(s);
   const n=e?("FAIL "+e):(s.data.fetchSourceManga.mangas.length+" results: "+s.data.fetchSourceManga.mangas.slice(0,2).map(m=>m.title).join(" / "));
   console.log(`  ${label} q="${q}" -> ${n}`);
  }
 }
 console.log("\n### POPULAR listing (does the source work at all?)");
 for(const [sid,label] of [["4110737012647435874","Team X"],["1073624495230267708","3asq"]]){
  const s=await gql(`mutation($i:FetchSourceMangaInput!){fetchSourceManga(input:$i){mangas{id title}}}`,{i:{source:sid,type:"POPULAR",page:1}});
  const e=err(s);
  console.log(`  ${label} POPULAR -> ${e?("FAIL "+e):(s.data.fetchSourceManga.mangas.length+" items: "+s.data.fetchSourceManga.mangas.slice(0,3).map(m=>m.title).join(" / "))}`);
 }
})();
