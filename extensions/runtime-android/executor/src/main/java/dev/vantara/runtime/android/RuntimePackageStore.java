package dev.vantara.runtime.android;

import java.io.*;
import java.nio.channels.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;

/** Dedicated NEW-family store. Never point this at legacy repositories, libraries or account databases. */
public final class RuntimePackageStore {
    private static final int MAGIC=0x56525031;
    private final Path root,objects,records,staging;
    public record Installed(String packageId,String packageHash,String dexHash,String entry,int version,File dexFile){}

    public RuntimePackageStore(Path ownedDirectory,String accountId)throws IOException {
        Objects.requireNonNull(ownedDirectory);
        if(accountId==null||accountId.isEmpty()||accountId.length()>200)throw new IllegalArgumentException("Invalid package-store account");
        directory(ownedDirectory);root=ownedDirectory.toRealPath().resolve(hash(accountId.getBytes(StandardCharsets.UTF_8)));
        directory(root);objects=root.resolve("objects");records=root.resolve("installed");staging=root.resolve("staging");
        directory(objects);directory(records);directory(staging);
    }
    private static void directory(Path path)throws IOException {
        if(Files.isSymbolicLink(path))throw new IOException("PACKAGE_STORAGE_INVALID");
        Files.createDirectories(path);if(!Files.isDirectory(path,LinkOption.NOFOLLOW_LINKS))throw new IOException("PACKAGE_STORAGE_INVALID");
    }
    private static void id(String id){if(id==null||!id.matches("[A-Za-z0-9_-]{1,128}"))throw new IllegalArgumentException("Invalid stable package ID");}
    private static String hash(byte[] bytes)throws IOException {
        try{StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
        catch(NoSuchAlgorithmException e){throw new IOException(e);}
    }
    private static String dexHash(Path file)throws IOException {
        if(!Files.isRegularFile(file,LinkOption.NOFOLLOW_LINKS))throw new IOException("PACKAGE_OBJECT_CORRUPT");
        final MessageDigest digest;
        try{digest=MessageDigest.getInstance("SHA-256");}catch(NoSuchAlgorithmException e){throw new IOException(e);}
        try(InputStream in=Files.newInputStream(file)){byte[] chunk=new byte[8192];int n;long total=0;while((n=in.read(chunk))!=-1){total+=n;if(total>Cs3Package.MAX_DEX)throw new IOException("PACKAGE_OBJECT_CORRUPT");digest.update(chunk,0,n);}}
        StringBuilder value=new StringBuilder();for(byte b:digest.digest())value.append(String.format(Locale.ROOT,"%02x",b&255));return value.toString();
    }
    private static void write(Path path,byte[] data)throws IOException {
        try(FileOutputStream out=new FileOutputStream(path.toFile())){out.write(data);out.getFD().sync();}
    }
    /** Format/integrity checks precede any installed-record mutation. Caller still must validate actual worker registration. */
    public Staged stage(File source,String expectedSha256)throws IOException {
        if(source==null||!Files.isRegularFile(source.toPath(),LinkOption.NOFOLLOW_LINKS))throw new IOException("PACKAGE_ARCHIVE_INVALID");
        if(Files.size(source.toPath())>Cs3Package.MAX_ARCHIVE)throw new IOException("PACKAGE_LIMIT");
        Path candidate=Files.createTempDirectory(staging,"candidate-");boolean ok=false;
        try {
            Path archive=candidate.resolve("original.cs3");
            try(InputStream in=new FileInputStream(Objects.requireNonNull(source));FileOutputStream out=new FileOutputStream(archive.toFile())){
                byte[] chunk=new byte[8192];int n;long total=0;
                while((n=in.read(chunk))!=-1){total+=n;if(total>Cs3Package.MAX_ARCHIVE)throw new IOException("PACKAGE_LIMIT");out.write(chunk,0,n);}out.getFD().sync();
            }
            Cs3Package parsed=Cs3Package.read(archive.toFile(),expectedSha256);
            Path dex=candidate.resolve("classes.dex");write(dex,parsed.dex());
            if(!dex.toFile().setReadOnly()||!archive.toFile().setReadOnly())throw new IOException("PACKAGE_STORAGE_INVALID");
            Staged result=new Staged(candidate,parsed);ok=true;return result;
        }finally{if(!ok)removeCandidate(candidate);}
    }
    public Installed current(String packageId)throws IOException {
        id(packageId);Path pointer=records.resolve(packageId+".vri");
        if(!Files.exists(pointer,LinkOption.NOFOLLOW_LINKS))return null;
        if(!Files.isRegularFile(pointer,LinkOption.NOFOLLOW_LINKS)||Files.size(pointer)>8192)throw new IOException("PACKAGE_REGISTRY_CORRUPT");
        try(DataInputStream in=new DataInputStream(Files.newInputStream(pointer))){
            if(in.readInt()!=MAGIC||!packageId.equals(in.readUTF()))throw new IOException("PACKAGE_REGISTRY_CORRUPT");
            String archive=in.readUTF(),dex=in.readUTF(),entry=in.readUTF();int version=in.readInt();
            if(!archive.matches("[0-9a-f]{64}")||!dex.matches("[0-9a-f]{64}")||entry.length()>512||version<0||in.read()!=-1)throw new IOException("PACKAGE_REGISTRY_CORRUPT");
            Path object=objects.resolve(archive),file=object.resolve("classes.dex");
            if(Files.isSymbolicLink(object)||!Files.isRegularFile(file,LinkOption.NOFOLLOW_LINKS))throw new IOException("PACKAGE_OBJECT_MISSING");
            return new Installed(packageId,archive,dex,entry,version,file.toFile());
        }catch(EOFException e){throw new IOException("PACKAGE_REGISTRY_CORRUPT",e);}
    }
    public final class Staged implements AutoCloseable {
        private final Path path;private final Cs3Package candidate;private boolean closed,moved;
        private Staged(Path path,Cs3Package candidate){this.path=path;this.candidate=candidate;}
        public Cs3Package candidate(){return candidate;}
        public synchronized File dexFile(){if(closed)throw new IllegalStateException("PACKAGE_CANDIDATE_CLOSED");return path.resolve("classes.dex").toFile();}
        /** Host calls this ONLY after successful isolated registration. It marks installed, never healthy/playable. */
        public synchronized Installed activate(String packageId)throws IOException {
            id(packageId);if(closed)throw new IOException("PACKAGE_CANDIDATE_CLOSED");
            Path lockFile=root.resolve("activation.lock");if(Files.isSymbolicLink(lockFile))throw new IOException("PACKAGE_STORAGE_INVALID");
            try(FileChannel channel=FileChannel.open(lockFile,StandardOpenOption.CREATE,StandardOpenOption.WRITE)){
                final FileLock lease;
                try{lease=channel.tryLock();}catch(OverlappingFileLockException busy){throw new IOException("PACKAGE_STORE_BUSY");}
                if(lease==null)throw new IOException("PACKAGE_STORE_BUSY");
                try(FileLock held=lease){
                    Installed old=current(packageId);
                    if(old!=null&&old.version()>candidate.version())throw new IOException("PACKAGE_DOWNGRADE_REJECTED");
                    Path object=objects.resolve(candidate.packageHash());
                    if(Files.exists(object,LinkOption.NOFOLLOW_LINKS)){
                        if(Files.isSymbolicLink(object)||!Cs3Package.read(object.resolve("original.cs3").toFile(),candidate.packageHash()).dexHash().equals(candidate.dexHash())||!dexHash(object.resolve("classes.dex")).equals(candidate.dexHash()))throw new IOException("PACKAGE_OBJECT_CORRUPT");
                    }else{Files.move(path,object,StandardCopyOption.ATOMIC_MOVE);moved=true;}
                    ByteArrayOutputStream bytes=new ByteArrayOutputStream();
                    try(DataOutputStream out=new DataOutputStream(bytes)){
                        out.writeInt(MAGIC);out.writeUTF(packageId);out.writeUTF(candidate.packageHash());out.writeUTF(candidate.dexHash());out.writeUTF(candidate.entry());out.writeInt(candidate.version());
                    }
                    Path pending=Files.createTempFile(records,"pending-",".vri");
                    try{write(pending,bytes.toByteArray());Files.move(pending,records.resolve(packageId+".vri"),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}
                    finally{Files.deleteIfExists(pending);}
                    closed=true;if(!moved)removeCandidate(path);
                    return current(packageId);
                }
            }
        }
        @Override public synchronized void close()throws IOException {if(closed)return;closed=true;if(!moved)removeCandidate(path);}
    }
    private static void removeCandidate(Path path)throws IOException {
        // Only the fresh, owned staging subtree. No package objects, installed records or legacy stores.
        if(!Files.exists(path,LinkOption.NOFOLLOW_LINKS))return;
        try(java.util.stream.Stream<Path> walk=Files.walk(path)){
            for(Path item:walk.sorted(Comparator.reverseOrder()).collect(java.util.stream.Collectors.toList()))Files.delete(item);
        }
    }
}
