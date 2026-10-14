const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const {migratePortableProfile}=require('./profile.cjs');
test('ترقية portable تحفظ الحساب والإضافات دون نسخ التورنت أو مسح الملف القديم',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vantara-profile-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const old=path.join(dir,'old'),dest=path.join(dir,'new');await fs.mkdir(path.join(old,'torrent-cache'),{recursive:true});await fs.writeFile(path.join(old,'settings.json'),'private-settings');await fs.writeFile(path.join(old,'torrent-cache','file'),'large-cache');
  await migratePortableProfile(old,dest);
  assert.equal(await fs.readFile(path.join(dest,'settings.json'),'utf8'),'private-settings');
  assert.equal(await fs.readFile(path.join(old,'settings.json'),'utf8'),'private-settings');
  await assert.rejects(fs.access(path.join(dest,'torrent-cache')));
  await fs.writeFile(path.join(dest,'settings.json'),'new-choice');await migratePortableProfile(old,dest);
  assert.equal(await fs.readFile(path.join(dest,'settings.json'),'utf8'),'new-choice');
});
