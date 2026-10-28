"""Authored format fixtures; minimal DEX metadata is not a runnable provider."""
import hashlib,io,json,struct,unittest,zipfile,zlib
from package_gate import inspect_package, PackageError

def dex(entry='fixture.Plugin'):
    strings=['L'+entry.replace('.','/')+';','Lcom/lagradost/cloudstream3/plugins/Plugin;','V','load','Fixture']
    n=len(strings);sid=112;tid=sid+4*n;proto=tid+12;method=proto+12;classes=method+8;data=classes+32
    buf=bytearray(data);offsets=[]
    for s in strings:offsets.append(len(buf));buf.extend(bytes([len(s)])+s.encode()+b'\0')
    while len(buf)%4:buf.append(0)
    mapoff=len(buf);maps=[(0,1,0),(1,n,sid),(2,3,tid),(3,1,proto),(5,1,method),(6,1,classes),(0x2002,n,data),(0x1000,1,mapoff)]
    buf.extend(struct.pack('<I',len(maps)))
    for kind,size,off in maps:buf.extend(struct.pack('<HHII',kind,0,size,off))
    buf[:8]=b'dex\n035\0'
    struct.pack_into('<20I',buf,32,len(buf),112,0x12345678,0,0,mapoff,n,sid,3,tid,1,proto,0,0,1,method,1,classes,len(buf)-data,data)
    for i,off in enumerate(offsets):struct.pack_into('<I',buf,sid+i*4,off)
    for i in range(3):struct.pack_into('<I',buf,tid+i*4,i)
    struct.pack_into('<III',buf,proto,2,2,0)
    struct.pack_into('<HHI',buf,method,1,0,3)
    struct.pack_into('<8I',buf,classes,0,1,1,0,4,0,0,0)
    return seal(buf)
def seal(buf):
    buf=bytearray(buf);buf[12:32]=hashlib.sha1(buf[32:]).digest();struct.pack_into('<I',buf,8,zlib.adler32(buf[12:])&0xffffffff);return bytes(buf)
def package(payload=None,manifest=None,extra=()):
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json',json.dumps(manifest or {'name':'Fixture','version':1,'pluginClassName':'fixture.Plugin','requiresResources':False}))
        z.writestr('classes.dex',payload if payload is not None else dex())
        for name,b in extra:z.writestr(name,b)
    return out.getvalue()
class PackageGateTest(unittest.TestCase):
    def rejects(self,code,data,**kw):
        with self.assertRaises(PackageError) as e:inspect_package(data,**kw)
        self.assertEqual(code,e.exception.code)
    def test_valid_metadata_is_not_runtime_execution_or_publisher_signature(self):
        b=package();r=inspect_package(b)
        self.assertFalse(r['executed']);self.assertEqual('not_implemented',r['runtimeExecution']);self.assertEqual('observed_unpinned',r['integrity'])
        self.assertEqual('fixture.Plugin',r['manifest']['pluginClassName'])
        self.assertIn('Lcom/lagradost/cloudstream3/plugins/Plugin;->load()V',r['methodReferences'])
    def test_pin_is_required_to_claim_pin_match(self):
        b=package();r=inspect_package(b,expected_sha256=hashlib.sha256(b).hexdigest());self.assertEqual('matches_pin',r['integrity'])
        self.rejects('HASH_MISMATCH',b,expected_sha256='0'*64)
    def test_traversal_and_windows_aliases_rejected(self):
        for name in ['../outside','/absolute','a/../../outside','a\\outside','C:outside']:
            self.rejects('UNSAFE_ARCHIVE_PATH',package(extra=[(name,b'x')]))
    def test_duplicate_entry_rejected(self):self.rejects('DUPLICATE_ARCHIVE_ENTRY',package(extra=[('manifest.json',b'{}')]))
    def test_archive_expansion_bounded(self):self.rejects('EXPANSION_LIMIT',package(extra=[('bomb',b'a'*10000)]),max_expanded_bytes=1000)
    def test_entrypoint_must_exist(self):self.rejects('ENTRYPOINT_MISSING',package(manifest={'name':'Other','version':1,'pluginClassName':'other.Plugin'}))
    def test_dex_checksum_required(self):
        b=bytearray(dex());b[-1]^=1;self.rejects('DEX_CHECKSUM',package(bytes(b)))
    def test_dex_tables_are_bounded_even_with_valid_hashes(self):
        b=bytearray(dex());struct.pack_into('<I',b,60,0xfffffff0);self.rejects('DEX_BOUNDS',package(seal(b)))
    def test_native_libraries_not_silently_accepted(self):self.rejects('NATIVE_CODE_UNSUPPORTED',package(extra=[('lib/arm64/a.so',b'ELF')]))
    def test_declared_name_cannot_select_a_path(self):self.rejects('INVALID_MANIFEST',package(manifest={'name':'X','version':1,'pluginClassName':'../Plugin'}))
    def test_future_dex_profile_rejected_explicitly(self):
        b=bytearray(dex());b[:8]=b'dex\n041\0';self.rejects('DEX_VERSION_UNSUPPORTED',package(seal(b)))
    def test_zip_symlink_rejected(self):
        b=io.BytesIO()
        with zipfile.ZipFile(b,'w') as z:
            i=zipfile.ZipInfo('link');i.create_system=3;i.external_attr=0o120777<<16;z.writestr(i,'../other')
        self.rejects('UNSAFE_ARCHIVE_PATH',b.getvalue())
    def test_empty_and_unknown_formats_do_not_crash(self):
        for b in [b'',b'not zip',b'PK\x03\x04'] :self.rejects('INVALID_ARCHIVE',b)

class MetadataAmplificationTest(unittest.TestCase):
    def test_shared_string_offsets_cannot_expand_metadata_without_bound(self):
        count=5000;off=112+count*4;buf=bytearray(off)
        buf[:8]=b'dex\n035\0';struct.pack_into('<20I',buf,32,off+1027,112,0x12345678,0,0,0,count,112,0,0,0,0,0,0,0,0,0,0,1027,off)
        for i in range(count):struct.pack_into('<I',buf,112+i*4,off)
        buf.extend(b'\x80\x08'+b'a'*1024+b'\0')
        with self.assertRaises(PackageError) as e:inspect_package(package(seal(buf)))
        self.assertEqual('DEX_METADATA_LIMIT',e.exception.code)
    def test_non_string_hash_pin_is_a_structured_error(self):
        with self.assertRaises(PackageError) as e:inspect_package(package(),expected_sha256=42)
        self.assertEqual('INVALID_HASH_PIN',e.exception.code)
    def test_metadata_amplification_fails_closed_under_64mb_process_limit(self):
        import os,subprocess,sys,tempfile
        count=50000;off=112+count*4;buf=bytearray(off)
        buf[:8]=b'dex\n035\0';struct.pack_into('<20I',buf,32,off+1027,112,0x12345678,0,0,0,count,112,0,0,0,0,0,0,0,0,0,0,1027,off)
        for i in range(count):struct.pack_into('<I',buf,112+i*4,off)
        buf.extend(b'\x80\x08'+b'a'*1024+b'\0')
        with tempfile.TemporaryDirectory() as folder:
            path=__import__('pathlib').Path(folder)/'bounded.cs3';path.write_bytes(package(seal(buf)))
            script="""import resource,sys
resource.setrlimit(resource.RLIMIT_AS,(64*1024*1024,64*1024*1024))
from package_gate import inspect_package,PackageError
try:inspect_package(open(sys.argv[1],'rb').read())
except PackageError as e:
 print(e.code)
 sys.exit(0 if e.code=='DEX_METADATA_LIMIT' else 2)
raise SystemExit(3)
"""
            result=subprocess.run([sys.executable,'-c',script,str(path)],env={**os.environ,'PYTHONPATH':str(__import__('pathlib').Path(__file__).parent.resolve())},text=True,capture_output=True,timeout=10)
            self.assertEqual(0,result.returncode,result.stderr);self.assertEqual('DEX_METADATA_LIMIT',result.stdout.strip())

if __name__=='__main__':unittest.main()
