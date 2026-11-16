#!/usr/bin/env python3
"""
تدقيق عقد المضيف: هل يجد كل صنف ودالة وحقل تطلبه إضافة Mihon/Keiyoushi مقابله داخل APK التطبيق نفسه؟

  python3 tools/repository-compat/host_abi_audit.py <VANTARA.apk> <extension.apk>...

كل نقص يُطبع (CLASS/METHOD/FIELD) مع الإضافات التي تطلبه، والخروج 1 إن وُجد نقص. هذا يكشف قبل أي جهاز ما
ظهر سابقًا وقت التشغيل فقط (`runBlockingK` من coroutines 1.11، `okhttp3.zstd.Zstd`). ما يرثه الصنف من إطار
Android لا يُحكم عليه (لا نحمل إطار Android هنا)؛ الإطار نفسه وjava.* مستثنيان.
31 أكتوبر 2026: 70 إضافة (كل عربي Keiyoushi والمدمجة) ← نقص واحد: ImageDecoder لـProComic (يعمل بدونه).
"""
import collections, os, struct, sys, tempfile, zipfile

def parse(path):
  b=open(path,'rb').read()
  u=lambda o:struct.unpack_from('<I',b,o)[0]
  h=lambda o:struct.unpack_from('<H',b,o)[0]
  sid_off=u(60);tid_sz,tid_off=u(64),u(68);pid_sz,pid_off=u(72),u(76);fid_sz,fid_off=u(80),u(84);mid_sz,mid_off=u(88),u(92);cd_sz,cd_off=u(96),u(100)
  def uleb(o):
    r=s=0
    while True:
      x=b[o];o+=1;r|=(x&0x7f)<<s;s+=7
      if x<0x80:return r,o
  cache={}
  def st(i):
    if i in cache:return cache[i]
    o=u(sid_off+4*i);_,o=uleb(o);e=b.index(0,o);v=b[o:e].decode('utf8','replace');cache[i]=v;return v
  types=[st(u(tid_off+4*i)) for i in range(tid_sz)]
  def proto(i):
    o=pid_off+12*i;ret=types[u(o+4)];po=u(o+8);ps=[]
    if po:
      n=u(po);ps=[types[h(po+4+2*k)] for k in range(n)]
    return '('+''.join(ps)+')'+ret
  methods=[(types[h(mid_off+8*i)],st(u(mid_off+8*i+4)),proto(h(mid_off+8*i+2))) for i in range(mid_sz)]
  fields=[(types[h(fid_off+8*i)],st(u(fid_off+8*i+4)),types[h(fid_off+8*i+2)]) for i in range(fid_sz)]
  classes={}
  for i in range(cd_sz):
    o=cd_off+32*i;c=types[u(o)];sup=types[u(o+8)] if u(o+8)!=0xffffffff else None
    io=u(o+12);ifs=[types[h(io+4+2*k)] for k in range(u(io))] if io else []
    dm=set();df=set();cdo=u(o+24)
    if cdo:
      sf,p=uleb(cdo);inf,p=uleb(p);dmn,p=uleb(p);vmn,p=uleb(p)
      for n in (sf,inf):
        idx=0
        for k in range(n):
          d,p=uleb(p);idx+=d;_,p=uleb(p);df.add(fields[idx][1:])
      idx=0
      for k in range(dmn):
        d,p=uleb(p);idx=idx+d if k else d;_,p=uleb(p);_,p=uleb(p);dm.add(methods[idx][1:])
      idx=0
      for k in range(vmn):
        d,p=uleb(p);idx=idx+d if k else d;_,p=uleb(p);_,p=uleb(p);dm.add(methods[idx][1:])
    classes[c]=(sup,ifs,dm,df)
  return classes,methods,fields
FW=('Landroid/','Ljava/','Ljavax/','Ldalvik/','Lorg/json/','Lorg/xml/','Lorg/w3c/','Lsun/','[')
def has(cls,kind,key,seen=None):
  seen=seen or set()
  if cls in seen or cls not in app: return None if cls not in app else False
  seen.add(cls);sup,ifs,dm,df=app[cls]
  if key in (dm if kind=='m' else df): return True
  for p in ([sup] if sup else [])+ifs:
    if p=='Ljava/lang/Object;' or p=='Ljava/lang/Enum;' or p=='Ljava/lang/Record;':
      if key[0] in ('toString','hashCode','equals','getClass','clone','finalize','notify','notifyAll','wait','name','ordinal','compareTo','valueOf','getDeclaringClass','describeConstable'): return True
      continue
    if p and p.startswith(FW): return None   # inherits from framework: cannot judge
    r=has(p,kind,key,seen)
    if r: return True
    if r is None and p not in app: return None
  return False
def audit(path):
  ext,methods,fields=parse(path);out=[]
  for c,n,pr in methods:
    if c in ext or c.startswith(FW) or c not in app: 
      if c not in ext and not c.startswith(FW) and c not in app: out.append(('CLASS',c))
      continue
    if has(c,'m',(n,pr))==False: out.append(('METHOD',c,n,pr))
  for c,n,t in fields:
    if c in ext or c.startswith(FW) or c not in app: continue
    if has(c,'f',(n,t))==False: out.append(('FIELD',c,n,t))
  return sorted(set(out))

def dexes(apk):
    with zipfile.ZipFile(apk) as z:
        for n in z.namelist():
            if n.startswith('classes') and n.endswith('.dex'):
                with tempfile.NamedTemporaryFile(suffix='.dex', delete=False) as t:
                    t.write(z.read(n))
                yield t.name

if __name__ == '__main__':
    if len(sys.argv) < 3: sys.exit(__doc__)
    app = {}
    for d in dexes(sys.argv[1]):
        app.update(parse(d)[0]); os.unlink(d)
    gaps = collections.defaultdict(list)
    for apk in sys.argv[2:]:
        for d in dexes(apk):
            for g in audit(d): gaps[g].append(os.path.basename(apk))
            os.unlink(d)
    for g, who in sorted(gaps.items(), key=lambda kv: -len(kv[1])): print(len(who), *g, '<-', ', '.join(sorted(set(who))[:5]))
    print(f'{len(sys.argv) - 2} extensions, {len(gaps)} host gaps')
    sys.exit(1 if gaps else 0)
