"""Original, non-executing CS3 ZIP/DEX inspection. Not a VM or code sandbox."""
import argparse,hashlib,io,json,re,stat,struct,zipfile,zlib
from pathlib import Path,PurePosixPath

class PackageError(ValueError):
    def __init__(self,code):self.code=code;super().__init__(code)
def fail(code):raise PackageError(code)

class MetadataBudget:
    def __init__(self,limit=8*1024*1024):self.remaining=limit
    def charge(self,size):
        if size<0 or size>self.remaining:fail('DEX_METADATA_LIMIT')
        self.remaining-=size

def inspect_dex(data,budget=None):
    budget=budget or MetadataBudget()
    if len(data)<112 or data[:4]!=b'dex\n' or data[7]!=0:fail('INVALID_DEX')
    if data[4:7] not in (b'035',b'037',b'038',b'039',b'040'):fail('DEX_VERSION_UNSUPPORTED')
    if struct.unpack_from('<I',data,32)[0]!=len(data) or struct.unpack_from('<I',data,36)[0]!=112 or struct.unpack_from('<I',data,40)[0]!=0x12345678:fail('INVALID_DEX')
    if hashlib.sha1(data[32:]).digest()!=data[12:32] or zlib.adler32(data[12:])&0xffffffff!=struct.unpack_from('<I',data,8)[0]:fail('DEX_CHECKSUM')
    def bounds(off,size):
        if off<0 or size<0 or off+size>len(data):fail('DEX_BOUNDS')
    def table(at,width):
        count,off=struct.unpack_from('<II',data,at)
        if count>200000 or count and off<112:fail('DEX_BOUNDS')
        bounds(off,count*width);return count,off
    sc,so=table(56,4);tc,to=table(64,4);pc,po=table(72,12);fc,fo=table(80,8);mc,mo=table(88,8);cc,co=table(96,32)
    budget.charge((sc+tc+pc+fc+mc)*16+cc*96)
    string_cache={}
    def u32(off):bounds(off,4);return struct.unpack_from('<I',data,off)[0]
    def string_at(off):
        original=off
        if off in string_cache:
            text=string_cache[off];budget.charge(len(text)*4+64);return text
        bounds(off,1);units=0
        for i in range(5):
            bounds(off,1);n=data[off];off+=1;units|=(n&127)<<(7*i)
            if n<128:break
        else:fail('INVALID_DEX_STRING')
        if units>1048576:fail('INVALID_DEX_STRING')
        budget.charge(units*4+64)
        end=data.find(b'\0',off,min(len(data),off+3*units+1))
        if end<0:fail('INVALID_DEX_STRING')
        raw=data[off:end];decoded=bytearray();i=0
        while i<len(raw):
            c=raw[i];i+=1
            if c<128:decoded.extend((c,0));continue
            size=2 if 0xc0<=c<=0xdf else 3 if 0xe0<=c<=0xef else 0
            if not size or i+size-1>len(raw):fail('INVALID_DEX_STRING')
            value=c&((1<<(7-size))-1)
            for _ in range(size-1):
                n=raw[i];i+=1
                if n&0xc0!=0x80:fail('INVALID_DEX_STRING')
                value=(value<<6)|(n&63)
            if size==2 and value<128 and value!=0 or size==3 and value<2048:fail('INVALID_DEX_STRING')
            decoded.extend((value&255,value>>8))
        if len(decoded)!=units*2:fail('INVALID_DEX_STRING')
        text=decoded.decode('utf-16-le','surrogatepass');string_cache[original]=text;return text
    strings=[string_at(u32(so+4*i)) for i in range(sc)]
    def get(seq,i):
        if i>=len(seq):fail('DEX_BOUNDS')
        return seq[i]
    types=[]
    for i in range(tc):
        text=get(strings,u32(to+4*i));budget.charge(len(text)*4+16);types.append(text)
    def type_list(off):
        if not off:return []
        count=u32(off)
        if count>65535:fail('DEX_BOUNDS')
        bounds(off+4,count*2);budget.charge(count*16)
        return [get(types,struct.unpack_from('<H',data,off+4+i*2)[0]) for i in range(count)]
    protos=[]
    for i in range(pc):
        shorty,ret,params=struct.unpack_from('<III',data,po+12*i);get(strings,shorty)
        args=type_list(params);result=get(types,ret);budget.charge(64+(len(result)+2)*4)
        for arg in args:budget.charge(len(arg)*4)
        protos.append('('+''.join(args)+')'+result)
    classes={};references=[];field_refs=[]
    for i in range(cc):
        row=struct.unpack_from('<8I',data,co+32*i);name=get(types,row[0]);parent=None if row[2]==0xffffffff else get(types,row[2]);type_list(row[3])
        if name in classes:fail('INVALID_DEX')
        classes[name]=parent
    for i in range(mc):
        owner,proto,name=struct.unpack_from('<HHI',data,mo+8*i)
        parent=get(types,owner);label=get(strings,name);signature=get(protos,proto);budget.charge(64+4*(len(parent)+len(label)+len(signature)+2))
        references.append(parent+'->'+label+signature)
    for i in range(fc):
        owner,kind,name=struct.unpack_from('<HHI',data,fo+8*i)
        parent=get(types,owner);label=get(strings,name);kind=get(types,kind);budget.charge(64+4*(len(parent)+len(label)+len(kind)+3))
        field_refs.append(parent+'->'+label+':'+kind)
    return {'version':data[4:7].decode(),'classes':classes,'types':types,'methods':references,'fields':field_refs}

def inspect_package(blob,*,expected_sha256=None,max_archive_bytes=8*1024*1024,max_expanded_bytes=32*1024*1024):
    if not isinstance(blob,(bytes,bytearray)) or not blob:fail('INVALID_ARCHIVE')
    if len(blob)>max_archive_bytes:fail('ARCHIVE_LIMIT')
    blob=bytes(blob);budget=MetadataBudget()
    digest=hashlib.sha256(blob).hexdigest()
    if expected_sha256 is not None:
        if not isinstance(expected_sha256,str) or not re.fullmatch('[0-9a-fA-F]{64}',expected_sha256):fail('INVALID_HASH_PIN')
        if expected_sha256.lower()!=digest:fail('HASH_MISMATCH')
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            infos=archive.infolist();names=set();total=0;entries={}
            if not infos or len(infos)>256:fail('ARCHIVE_ENTRY_LIMIT')
            for info in infos:
                name=info.orig_filename
                if not name or '\0' in name or '\\' in name or ':' in name or name.startswith('/') or '..' in PurePosixPath(name).parts or stat.S_ISLNK(info.external_attr>>16):fail('UNSAFE_ARCHIVE_PATH')
                canonical=str(PurePosixPath(name))
                if canonical in names:fail('DUPLICATE_ARCHIVE_ENTRY')
                names.add(canonical)
                if name.endswith('.so'):fail('NATIVE_CODE_UNSUPPORTED')
                if info.flag_bits&1 or info.compress_type not in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED):fail('UNSUPPORTED_ARCHIVE_ENCODING')
                total+=info.file_size
                if total>max_expanded_bytes or info.file_size>16*1024*1024 or info.file_size>max(1024*1024,info.compress_size*200):fail('EXPANSION_LIMIT')
                if not info.is_dir():
                    with archive.open(info) as file:payload=file.read(info.file_size+1)
                    if len(payload)!=info.file_size:fail('INVALID_ARCHIVE')
                    entries[name]=payload
            raw=entries.get('manifest.json')
            if raw is None or len(raw)>65536:fail('INVALID_MANIFEST')
            def pairs(items):
                obj={}
                for k,v in items:
                    if k in obj:fail('INVALID_MANIFEST')
                    obj[k]=v
                return obj
            try:manifest=json.loads(raw,object_pairs_hook=pairs)
            except (ValueError,UnicodeError,RecursionError):fail('INVALID_MANIFEST')
            if not isinstance(manifest,dict) or not isinstance(manifest.get('pluginClassName'),str) or not re.fullmatch(r'[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+',manifest['pluginClassName'],flags=re.ASCII) or type(manifest.get('version'))is not int or manifest['version']<0 or not isinstance(manifest.get('name'),str) or not manifest['name'] or len(manifest['name'])>200 or type(manifest.get('requiresResources',False))is not bool:fail('INVALID_MANIFEST')
            dexes=[];classes={};methods=set();fields=set();types=set()
            for name,payload in entries.items():
                if not name.endswith('.dex'):continue
                if not re.fullmatch(r'classes(?:[2-9]|[1-9][0-9]+)?\.dex',name):fail('UNSUPPORTED_DEX_LAYOUT')
                d=inspect_dex(payload,budget)
                if classes.keys()&d['classes'].keys():fail('DUPLICATE_DEX_CLASS')
                classes.update(d['classes']);methods.update(d['methods']);fields.update(d['fields']);types.update(d['types']);dexes.append({'file':name,'version':d['version'],'definedClasses':len(d['classes'])})
            entry='L'+manifest['pluginClassName'].replace('.','/')+';'
            if 'classes.dex' not in entries or entry not in classes:fail('ENTRYPOINT_MISSING')
            external=lambda ref:ref.split('->')[0] not in classes
            return {'family':'cloudstream','manifest':manifest,'sha256':digest,'bytes':len(blob),'expandedBytes':total,'integrity':'matches_pin' if expected_sha256 else 'observed_unpinned','publisherSignatureVerified':False,'executed':False,'runtimeExecution':'not_implemented','dex':dexes,'entrySuperclass':classes[entry],'externalTypes':sorted(t for t in types if t.startswith('L') and t not in classes),'methodReferences':sorted(m for m in methods if external(m)),'fieldReferences':sorted(f for f in fields if external(f))}
    except PackageError:raise
    except (zipfile.BadZipFile,EOFError,RuntimeError,struct.error,UnicodeError,zlib.error,OverflowError):fail('INVALID_ARCHIVE')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('package');parser.add_argument('--sha256');parser.add_argument('--output');args=parser.parse_args()
    try:result=inspect_package(Path(args.package).read_bytes(),expected_sha256=args.sha256)
    except PackageError as error:raise SystemExit(error.code)
    text=json.dumps(result,indent=2,ensure_ascii=True)
    if args.output:Path(args.output).write_text(text+'\n')
    else:print(text)
