const EP="http://uchiyomi-suwayomi:4567/api/graphql";
const gql=async(query,variables)=>{
  const r=await fetch(EP,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query,variables})});
  return r.json();
};
const SOURCES=[
 ["4110737012647435874","Team X"],
 ["1073624495230267708","3asq / العاشق"],
 ["918460697583900080","Mangalek / ليك"],
 ["7657007209499352344","MangaSwat"],
 ["2482399499047903203","Azora"],
];
const err=j=>(j.errors&&j.errors[0]&&(j.errors[0].message||"").split("\n")[0].slice(0,90))||null;
(async()=>{
 for(const [sid,label] of SOURCES){
  const row={source:label,search:"-",manga:"-",chapters:"-",pages:"-",note:""};
  const t0=Date.now();
  try{
   const s=await gql(`mutation($i:FetchSourceMangaInput!){fetchSourceManga(input:$i){mangas{id title}}}`,
     {i:{source:sid,type:"SEARCH",query:"nano machine",page:1}});
   const e=err(s);
   if(e){row.search="FAIL";row.note=e;console.log(JSON.stringify(row));continue;}
   const list=s.data.fetchSourceManga.mangas;
   row.search=`OK(${list.length}) ${Date.now()-t0}ms`;
   if(!list.length){console.log(JSON.stringify(row));continue;}
   const m=list[0]; row.manga=m.title.slice(0,30);
   const c=await gql(`mutation($i:FetchChaptersInput!){fetchChapters(input:$i){chapters{id name chapterNumber}}}`,{i:{mangaId:m.id}});
   const ce=err(c);
   if(ce){row.chapters="FAIL";row.note=ce;console.log(JSON.stringify(row));continue;}
   const chs=c.data.fetchChapters.chapters;
   row.chapters=`OK(${chs.length})`;
   const target=chs[chs.length-1]; // oldest = ch 1
   const p=await gql(`mutation($i:FetchChapterPagesInput!){fetchChapterPages(input:$i){pages}}`,{i:{chapterId:target.id}});
   const pe=err(p);
   if(pe){row.pages="FAIL";row.note=pe;console.log(JSON.stringify(row));continue;}
   const pages=p.data.fetchChapterPages.pages;
   row.pages=`OK(${pages.length}) ch=${target.chapterNumber}`;
   row.note=(pages[0]||"").slice(0,60);
  }catch(ex){row.note="EX "+ex.message.slice(0,70);}
  console.log(JSON.stringify(row));
 }
})();
