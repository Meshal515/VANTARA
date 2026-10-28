package dev.vantara.runtime.android;

import org.junit.*;
import org.junit.rules.TemporaryFolder;
import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;
import static org.junit.Assert.*;

/** Real filesystem transactions; authored package bytes, not executed source-health evidence. */
public class RuntimePackageStoreTest {
    @Test public void manualMetadataChangesAndRemovalStayWithinSelectedAccount()throws Exception{
        RuntimePackageStore first=store("first"),second=store("second");File one=archive(1);
        for(RuntimePackageStore s:Arrays.asList(first,second))try(RuntimePackageStore.Staged candidate=s.stage(one,hash(one))){candidate.activate("same-id","{\"enabled\":true}");}
        java.lang.reflect.Method update=null,remove=null;
        for(java.lang.reflect.Method m:RuntimePackageStore.class.getMethods()){
            if(m.getName().equals("updateMetadata"))update=m;
            if(m.getName().equals("uninstall"))remove=m;
        }
        assertNotNull("Missing atomic package settings API",update);assertNotNull("Missing explicit scoped uninstall API",remove);
        File binary=first.current("same-id").dexFile();
        update.invoke(first,"same-id","{\"enabled\":false}");
        assertEquals("{\"enabled\":false}",store("first").current("same-id").metadata());
        assertEquals("{\"enabled\":true}",second.current("same-id").metadata());
        remove.invoke(first,"same-id");
        assertNull(store("first").current("same-id"));assertNotNull(second.current("same-id"));
        assertTrue("Uninstall must not erase shared immutable objects or session files",binary.isFile());
    }
    @Rule public TemporaryFolder temp=new TemporaryFolder();
    private File archive(int version)throws Exception{
        byte[] dex=new byte[112];System.arraycopy("dex\n035\0".getBytes(StandardCharsets.US_ASCII),0,dex,0,8);
        ByteBuffer b=ByteBuffer.wrap(dex).order(ByteOrder.LITTLE_ENDIAN);b.putInt(32,112);b.putInt(36,112);b.putInt(40,0x12345678);
        System.arraycopy(MessageDigest.getInstance("SHA-1").digest(Arrays.copyOfRange(dex,32,112)),0,dex,12,20);Adler32 a=new Adler32();a.update(dex,12,100);b.putInt(8,(int)a.getValue());
        File archive=temp.newFile();try(ZipOutputStream z=new ZipOutputStream(new FileOutputStream(archive))){z.putNextEntry(new ZipEntry("manifest.json"));z.write(("{\"pluginClassName\":\"test.original.Plugin\",\"name\":\"Original fixture\",\"version\":"+version+",\"requiresResources\":false}").getBytes(StandardCharsets.UTF_8));z.closeEntry();z.putNextEntry(new ZipEntry("classes.dex"));z.write(dex);z.closeEntry();}return archive;
    }
    private String hash(File file)throws Exception{StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file.toPath())))s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
    private RuntimePackageStore store(String account)throws Exception{return new RuntimePackageStore(temp.getRoot().toPath().resolve("runtime-owned"),account);}
    @Test public void uncommittedCandidateIsNotAnInstalledPackage()throws Exception{
        RuntimePackageStore store=store("account");File file=archive(1);
        try(RuntimePackageStore.Staged staged=store.stage(file,hash(file))){assertTrue(staged.dexFile().isFile());assertNull(store.current("package-id"));}
        assertNull(store.current("package-id"));
    }
    @Test public void activationAndControllerRestartPreserveStablePackageIdentity()throws Exception{
        RuntimePackageStore store=store("account");File one=archive(1),two=archive(2);
        try(RuntimePackageStore.Staged staged=store.stage(one,hash(one))){staged.activate("stable-package-id");}
        RuntimePackageStore.Installed first=store("account").current("stable-package-id");assertEquals(1,first.version());assertArrayEquals(Files.readAllBytes(first.dexFile().toPath()),Cs3Package.read(one,hash(one)).dex());
        try(RuntimePackageStore.Staged staged=store.stage(two,hash(two))){staged.activate("stable-package-id");}
        RuntimePackageStore.Installed next=store("account").current("stable-package-id");assertEquals(first.packageId(),next.packageId());assertEquals(2,next.version());assertEquals(hash(two),next.packageHash());assertTrue(first.dexFile().isFile());
    }
    @Test public void failedUpdateLeavesThePreviousPackageAndUnrelatedUserData()throws Exception{
        Path sentinel=temp.getRoot().toPath().resolve("user-repos.json");Files.write(sentinel,"preserve".getBytes(StandardCharsets.UTF_8));
        RuntimePackageStore store=store("account");File one=archive(1),two=archive(2);
        try(RuntimePackageStore.Staged staged=store.stage(one,hash(one))){staged.activate("stable-package-id");}
        try{store.stage(two,String.join("",Collections.nCopies(64,"0")));fail("Accepted wrong hash");}catch(Cs3Package.Failure expected){assertEquals("PACKAGE_HASH_MISMATCH",expected.code);}
        assertEquals(hash(one),store.current("stable-package-id").packageHash());assertEquals("preserve",new String(Files.readAllBytes(sentinel),StandardCharsets.UTF_8));
    }
    @Test public void accountsRemainSeparateEvenWhenPackageNamesMatch()throws Exception{
        File one=archive(1);try(RuntimePackageStore.Staged staged=store("first").stage(one,hash(one))){staged.activate("same-id");}
        assertNotNull(store("first").current("same-id"));assertNull(store("second").current("same-id"));
    }
    @Test public void lowerVersionCannotReplaceCurrentPackage()throws Exception{
        RuntimePackageStore store=store("account");File one=archive(1),two=archive(2);
        try(RuntimePackageStore.Staged staged=store.stage(two,hash(two))){staged.activate("stable-id");}
        try(RuntimePackageStore.Staged staged=store.stage(one,hash(one))){try{staged.activate("stable-id");fail("Downgraded package");}catch(IOException expected){assertEquals("PACKAGE_DOWNGRADE_REJECTED",expected.getMessage());}}
        assertEquals(2,store.current("stable-id").version());
    }
    @Test public void invalidPackageKeyCannotEscapeTheStore()throws Exception{
        RuntimePackageStore store=store("account");File one=archive(1);
        try(RuntimePackageStore.Staged staged=store.stage(one,hash(one))){try{staged.activate("../outside");fail("Unsafe package ID");}catch(IllegalArgumentException expected){}}
        assertFalse(temp.getRoot().toPath().resolve("outside").toFile().exists());
    }
    @Test public void aPreviouslyCorruptedDexObjectCannotBeRepublishedAsTheValidatedCandidate()throws Exception{
        RuntimePackageStore store=store("account");File one=archive(1);
        try(RuntimePackageStore.Staged staged=store.stage(one,hash(one))){staged.activate("stable-id");}
        File corrupt=store.current("stable-id").dexFile();assertTrue(corrupt.setWritable(true));Files.write(corrupt.toPath(),new byte[]{1,2,3});
        try(RuntimePackageStore.Staged staged=store.stage(one,hash(one))){try{staged.activate("stable-id");fail("Republished a different on-disk object");}catch(IOException expected){assertEquals("PACKAGE_OBJECT_CORRUPT",expected.getMessage());}}
    }
    @Test public void symbolicSourcePathCannotPointAdmissionOutsideTheOwnedDownload()throws Exception{
        File one=archive(1);Path link=temp.getRoot().toPath().resolve("linked.cs3");Files.createSymbolicLink(link,one.toPath());
        try{store("account").stage(link.toFile(),hash(one));fail("Accepted a linked source path");}catch(IOException expected){assertEquals("PACKAGE_ARCHIVE_INVALID",expected.getMessage());}
    }
    @Test public void sourceMetadataAndBinaryRevisionAreActivatedTogether()throws Exception{
        RuntimePackageStore store=store("account");File one=archive(1),two=archive(2);
        try(RuntimePackageStore.Staged staged=store.stage(one,hash(one))){staged.activate("stable-id","{\"source\":\"first\"}");}
        assertEquals("{\"source\":\"first\"}",store("account").current("stable-id").metadata());
        try(RuntimePackageStore.Staged staged=store.stage(two,hash(two))){assertEquals("{\"source\":\"first\"}",store.current("stable-id").metadata());staged.activate("stable-id","{\"source\":\"second\"}");}
        RuntimePackageStore.Installed current=store("account").current("stable-id");assertEquals(hash(two),current.packageHash());assertEquals("{\"source\":\"second\"}",current.metadata());
    }
    @Test public void oneCorruptInstalledRecordDoesNotHideTheOtherInstalledPackage()throws Exception{
        RuntimePackageStore store=store("account");File one=archive(1);
        for(String id:Arrays.asList("good-id","bad-id"))try(RuntimePackageStore.Staged staged=store.stage(one,hash(one))){staged.activate(id);}
        Path broken;
        try(java.util.stream.Stream<Path> files=Files.walk(temp.getRoot().toPath())){broken=files.filter(p->p.getFileName().toString().equals("bad-id.vri")).findFirst().get();}
        Files.write(broken,new byte[]{1});RuntimePackageStore.Inventory inventory=store("account").inventory();
        assertEquals(1,inventory.installed().size());assertEquals("good-id",inventory.installed().get(0).packageId());
        assertEquals(1,inventory.unreadable().size());assertEquals("bad-id",inventory.unreadable().get(0).packageId());assertEquals("PACKAGE_REGISTRY_CORRUPT",inventory.unreadable().get(0).code());assertTrue(Files.exists(broken));
    }
    @Test public void legacyV1RecordWithoutMetadataIsReadableWithoutRewritingIt()throws Exception{
        RuntimePackageStore store=store("account");File one=archive(1);
        try(RuntimePackageStore.Staged staged=store.stage(one,hash(one))){staged.activate("legacy-id");}
        Path pointer;try(java.util.stream.Stream<Path> paths=Files.walk(temp.getRoot().toPath())){pointer=paths.filter(p->p.getFileName().toString().equals("legacy-id.vri")).findFirst().get();}
        byte[] now=Files.readAllBytes(pointer);DataInputStream input=new DataInputStream(new ByteArrayInputStream(now));input.readInt();for(int i=0;i<4;i++)input.readUTF();input.readInt();
        byte[] old=Arrays.copyOf(now,now.length-input.available());Files.write(pointer,old);
        RuntimePackageStore.Installed restored=store("account").current("legacy-id");assertEquals(hash(one),restored.packageHash());assertEquals("{}",restored.metadata());assertArrayEquals(old,Files.readAllBytes(pointer));
    }
    @Test public void oversizedMetadataCannotChangeTheActivePackage()throws Exception{
        RuntimePackageStore store=store("account");File one=archive(1),two=archive(2);
        try(RuntimePackageStore.Staged staged=store.stage(one,hash(one))){staged.activate("stable-id","{\"keep\":true}");}
        char[] tooLarge=new char[16001];Arrays.fill(tooLarge,'x');
        try(RuntimePackageStore.Staged staged=store.stage(two,hash(two))){try{staged.activate("stable-id",new String(tooLarge));fail("Metadata budget bypassed");}catch(IOException expected){assertEquals("PACKAGE_METADATA_LIMIT",expected.getMessage());}}
        assertEquals(hash(one),store.current("stable-id").packageHash());assertEquals("{\"keep\":true}",store.current("stable-id").metadata());
    }
}
