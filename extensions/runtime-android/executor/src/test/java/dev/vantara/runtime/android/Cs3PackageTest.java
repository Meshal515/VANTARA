package dev.vantara.runtime.android;

import org.junit.*;
import org.junit.rules.TemporaryFolder;
import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;
import static org.junit.Assert.*;

/** Authored format fixtures only. Passing archive checks is never proof of source execution. */
public class Cs3PackageTest {
    @Rule public TemporaryFolder temporary=new TemporaryFolder();
    private byte[] dex()throws Exception{
        byte[] data=new byte[112];System.arraycopy("dex\n035\0".getBytes(StandardCharsets.US_ASCII),0,data,0,8);
        ByteBuffer b=ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);b.putInt(32,data.length);b.putInt(36,112);b.putInt(40,0x12345678);
        System.arraycopy(MessageDigest.getInstance("SHA-1").digest(Arrays.copyOfRange(data,32,data.length)),0,data,12,20);
        Adler32 adler=new Adler32();adler.update(data,12,data.length-12);b.putInt(8,(int)adler.getValue());return data;
    }
    private String manifest(boolean resources){return "{\"pluginClassName\":\"test.authored.Plugin\",\"name\":\"Authored fixture\",\"version\":2,\"requiresResources\":"+resources+"}";}
    private File archive(String manifest,Map<String,byte[]> entries)throws Exception{
        File file=temporary.newFile();try(ZipOutputStream zip=new ZipOutputStream(new FileOutputStream(file))){
            zip.putNextEntry(new ZipEntry("manifest.json"));zip.write(manifest.getBytes(StandardCharsets.UTF_8));zip.closeEntry();
            for(Map.Entry<String,byte[]> e:entries.entrySet()){zip.putNextEntry(new ZipEntry(e.getKey()));zip.write(e.getValue());zip.closeEntry();}
        }return file;
    }
    private String hash(File file)throws Exception{return hex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file.toPath())));}
    private String hex(byte[] bytes){StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
    private String failure(File file,String expected)throws Exception{
        try{Cs3Package.read(file,expected);fail("Expected archive rejection");return "";}
        catch(Cs3Package.Failure e){return e.code;}
    }
    @Test public void parsesBoundedMetadataAndReturnsExactDefensiveDexBytes()throws Exception{
        byte[] original=dex();File file=archive(manifest(false),Collections.singletonMap("classes.dex",original));
        Cs3Package p=Cs3Package.read(file,hash(file));
        assertEquals("test.authored.Plugin",p.entry());assertEquals("Authored fixture",p.name());assertEquals(2,p.version());assertEquals(hash(file),p.packageHash());assertArrayEquals(original,p.dex());
        byte[] copy=p.dex();copy[0]=0;assertArrayEquals(original,p.dex());assertEquals(hex(MessageDigest.getInstance("SHA-256").digest(original)),p.dexHash());
    }
    @Test public void pinnedHashMismatchIsRejectedBeforeParsing()throws Exception{
        File file=archive(manifest(false),Collections.singletonMap("classes.dex",dex()));assertEquals("PACKAGE_HASH_MISMATCH",failure(file,String.join("",Collections.nCopies(64,"0"))));
    }
    @Test public void missingDexAndUnsupportedMultidexAreExplicit()throws Exception{
        File missing=archive(manifest(false),Collections.emptyMap());assertEquals("PACKAGE_DEX_MISSING",failure(missing,hash(missing)));
        Map<String,byte[]> entries=new LinkedHashMap<>();entries.put("classes.dex",dex());entries.put("classes2.dex",dex());File multiple=archive(manifest(false),entries);assertEquals("MULTIDEX_PROFILE_UNSUPPORTED",failure(multiple,hash(multiple)));
    }
    @Test public void resourcesAreNotAdvertisedAsExecutable()throws Exception{
        File file=archive(manifest(true),Collections.singletonMap("classes.dex",dex()));assertEquals("RESOURCE_PROFILE_UNSUPPORTED",failure(file,hash(file)));
    }
    @Test public void traversalEntryIsRejectedAndNeverExtracted()throws Exception{
        Map<String,byte[]> entries=new LinkedHashMap<>();entries.put("classes.dex",dex());entries.put("../escape",new byte[]{1});File file=archive(manifest(false),entries);assertEquals("PACKAGE_PATH_INVALID",failure(file,hash(file)));assertFalse(new File(temporary.getRoot().getParentFile(),"escape").exists());
    }
    @Test public void corruptedDexCannotBeAdmittedByRehashingTheOuterArchive()throws Exception{
        byte[] broken=dex();broken[111]=1;File file=archive(manifest(false),Collections.singletonMap("classes.dex",broken));assertEquals("DEX_CHECKSUM_MISMATCH",failure(file,hash(file)));
    }
    @Test public void duplicateJsonKeysAndTrailingDocumentsAreRejected()throws Exception{
        File duplicate=archive(manifest(false).replace("\"version\":2","\"version\":2,\"version\":3"),Collections.singletonMap("classes.dex",dex()));assertEquals("PACKAGE_MANIFEST_INVALID",failure(duplicate,hash(duplicate)));
        File trailing=archive(manifest(false)+"{}",Collections.singletonMap("classes.dex",dex()));assertEquals("PACKAGE_MANIFEST_INVALID",failure(trailing,hash(trailing)));
    }
    @Test public void highlyCompressedExtraPayloadIsBounded()throws Exception{
        Map<String,byte[]> entries=new LinkedHashMap<>();entries.put("classes.dex",dex());entries.put("bomb",new byte[2*1024*1024]);File file=archive(manifest(false),entries);assertEquals("PACKAGE_LIMIT",failure(file,hash(file)));
    }
}
