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
}
