package dev.vantara.runtime.http;

import okhttp3.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;

/** Host-private storage only. Supply a dedicated app-private directory, never a user library path. */
public final class FileCookieVaults implements HttpBroker.Vaults {
    private static final int MAGIC=0x56524331, MAX_FILE=256*1024, MAX_COOKIES=128;
    private final Path directory;
    private final Map<String,HttpBroker.CookieVault> handles=new HashMap<>();
    public FileCookieVaults(Path directory){this.directory=Objects.requireNonNull(directory);}
    private static String key(HttpBroker.Scope scope) {
        try {
            MessageDigest digest=MessageDigest.getInstance("SHA-256");
            for(String field:List.of(scope.family(),scope.packageId(),scope.sourceId(),scope.sessionId())) {
                byte[] bytes=field.getBytes(StandardCharsets.UTF_8);
                digest.update((byte)(bytes.length>>>24));digest.update((byte)(bytes.length>>>16));digest.update((byte)(bytes.length>>>8));digest.update((byte)bytes.length);digest.update(bytes);
            }
            StringBuilder out=new StringBuilder();for(byte b:digest.digest())out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();
        }catch(NoSuchAlgorithmException impossible){throw new AssertionError(impossible);}
    }
    @Override public synchronized HttpBroker.CookieVault forScope(HttpBroker.Scope scope) {
        return handles.computeIfAbsent(key(scope),id->new DiskVault(directory.resolve(id+".cookies")));
    }
    private static final class DiskVault implements HttpBroker.CookieVault {
        private final Path path;
        DiskVault(Path path){this.path=path;}
        private List<Cookie> read() {
            if(!Files.exists(path,LinkOption.NOFOLLOW_LINKS))return new ArrayList<>();
            try {
                if(Files.isSymbolicLink(path)||Files.size(path)>MAX_FILE)throw new IOException();
                try(DataInputStream input=new DataInputStream(Files.newInputStream(path))) {
                    if(input.readInt()!=MAGIC)throw new IOException();int count=input.readInt();if(count<0||count>MAX_COOKIES)throw new IOException();
                    List<Cookie> result=new ArrayList<>();
                    for(int i=0;i<count;i++) {
                        String origin=input.readUTF(),value=input.readUTF();
                        HttpUrl url=HttpUrl.get(origin);if(!url.isHttps())throw new IOException();
                        Cookie cookie=Cookie.parse(url,value);if(cookie==null)throw new IOException();
                        if(cookie.expiresAt()>System.currentTimeMillis())result.add(cookie);
                    }
                    if(input.read()!=-1)throw new IOException();return result;
                }
            }catch(IOException|IllegalArgumentException e){throw new IllegalStateException("COOKIE_STORAGE_CORRUPT");}
        }
        @Override public synchronized List<Cookie> load(HttpUrl url) {
            List<Cookie> result=new ArrayList<>();for(Cookie c:read())if(c.matches(url))result.add(c);return result;
        }
        @Override public synchronized void save(HttpUrl url,List<Cookie> incoming) {
            if(incoming.isEmpty())return;
            List<Cookie> merged=read();
            for(Cookie cookie:incoming) {
                // A transport response cannot mint a cookie for an unrelated host.
                if(!cookie.matches(url))continue;
                merged.removeIf(old->old.name().equals(cookie.name())&&old.domain().equals(cookie.domain())&&old.path().equals(cookie.path()));
                if(cookie.expiresAt()>System.currentTimeMillis())merged.add(cookie);
            }
            if(merged.size()>MAX_COOKIES)throw new IllegalStateException("COOKIE_STORAGE_LIMIT");
            Path temporary=null;
            try {
                ByteArrayOutputStream bytes=new ByteArrayOutputStream();
                try(DataOutputStream output=new DataOutputStream(bytes)) {
                    output.writeInt(MAGIC);output.writeInt(merged.size());
                    for(Cookie c:merged){output.writeUTF("https://"+c.domain()+c.path());output.writeUTF(c.toString());}
                }
                if(bytes.size()>MAX_FILE)throw new IllegalStateException("COOKIE_STORAGE_LIMIT");
                Files.createDirectories(path.getParent());temporary=Files.createTempFile(path.getParent(),".vrt-cookie-",".tmp");
                try(FileOutputStream output=new FileOutputStream(temporary.toFile())){output.write(bytes.toByteArray());output.getFD().sync();}
                Files.move(temporary,path,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);temporary=null;
            }catch(IOException e){throw new IllegalStateException("COOKIE_STORAGE_FAILED");}
            finally {if(temporary!=null)try{Files.deleteIfExists(temporary);}catch(IOException ignored){}}
        }
    }
}
