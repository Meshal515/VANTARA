const fs=require('node:fs/promises');const path=require('node:path');
exports.migratePortableProfile=async function(previous,target){
  if(await fs.stat(target).then(()=>true,()=>false))return;
  const staging=target+'.migrating-'+process.pid;
  const excluded=new Set(['torrent-cache','subtitle-cache','Cache','Code Cache','GPUCache','Crashpad','DawnGraphiteCache','DawnWebGPUCache']);
  try{
    await fs.mkdir(path.dirname(target),{recursive:true});
    if(await fs.stat(previous).then(()=>true,()=>false))await fs.cp(previous,staging,{recursive:true,filter:file=>!excluded.has(path.basename(file))&&!path.basename(file).startsWith('Singleton')});
    else await fs.mkdir(staging,{recursive:true});
    await fs.rename(staging,target);
  }catch(error){await fs.rm(staging,{recursive:true,force:true}).catch(()=>{});throw new Error('تعذر نقل بيانات فانتارا إلى مجلد النسخة المحمولة؛ اختر مجلدًا يمكن الكتابة فيه.');}
};
