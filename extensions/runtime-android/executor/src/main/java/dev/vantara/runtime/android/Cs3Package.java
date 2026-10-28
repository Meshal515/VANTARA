package dev.vantara.runtime.android;

import com.fasterxml.jackson.core.*;
import com.fasterxml.jackson.databind.*;
import java.io.*;
import java.nio.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.zip.*;

/** Bounded format/integrity inspection of a HOST-PRIVATE staged CS3. Not execution or publisher authentication. */
public final class Cs3Package {
    public static final int MAX_ARCHIVE=8*1024*1024,MAX_INFLATED=16*1024*1024,MAX_DEX=8*1024*1024;
    private static final ObjectMapper JSON=new ObjectMapper(JsonFactory.builder()
        .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(24).maxStringLength(8192).maxNumberLength(32).build())
        .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build()).enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    public static final class Failure extends IOException {
        public final String code;Failure(String code){super(code);this.code=code;}
    }
    private final String entry,name,packageHash,dexHash;
    private final int version;private final byte[] dex;
    private Cs3Package(String entry,String name,int version,String packageHash,byte[] dex)throws IOException {
        this.entry=entry;this.name=name;this.version=version;this.packageHash=packageHash;this.dex=dex;this.dexHash=hash("SHA-256",dex);
    }
    public String entry(){return entry;}public String name(){return name;}public int version(){return version;}
    public String packageHash(){return packageHash;}public String dexHash(){return dexHash;}public byte[] dex(){return dex.clone();}
    private static MessageDigest digest(String algorithm)throws IOException{try{return MessageDigest.getInstance(algorithm);}catch(NoSuchAlgorithmException e){throw new IOException(e);}}
    private static String hex(byte[] data){StringBuilder text=new StringBuilder();for(byte b:data)text.append(String.format(Locale.ROOT,"%02x",b&255));return text.toString();}
    private static String hash(String algorithm,byte[] data)throws IOException{return hex(digest(algorithm).digest(data));}
    private static void path(String name)throws Failure {
        if(name==null||name.isEmpty()||name.length()>512||name.startsWith("/")||name.contains("\\")||name.contains(":"))throw new Failure("PACKAGE_PATH_INVALID");
        for(int i=0;i<name.length();i++)if(name.charAt(i)<32||name.charAt(i)==127)throw new Failure("PACKAGE_PATH_INVALID");
        String[] parts=name.split("/",-1);
        for(int i=0;i<parts.length;i++)if(parts[i].equals(".")||parts[i].equals("..")||(parts[i].isEmpty()&&i!=parts.length-1))throw new Failure("PACKAGE_PATH_INVALID");
    }
    public static Cs3Package read(File archive,String expectedSha256)throws IOException {
        if(archive==null||!Files.isRegularFile(archive.toPath(),LinkOption.NOFOLLOW_LINKS))throw new Failure("PACKAGE_ARCHIVE_INVALID");
        long size=Files.size(archive.toPath());if(size<22||size>MAX_ARCHIVE)throw new Failure("PACKAGE_LIMIT");
        MessageDigest checksum=digest("SHA-256");long count=0;
        try(InputStream in=new FileInputStream(archive)){byte[] chunk=new byte[8192];int n;while((n=in.read(chunk))!=-1){count+=n;if(count>MAX_ARCHIVE)throw new Failure("PACKAGE_LIMIT");checksum.update(chunk,0,n);}}
        String actual=hex(checksum.digest());
        if(expectedSha256==null||!expectedSha256.matches("[0-9a-f]{64}")||!actual.equals(expectedSha256))throw new Failure("PACKAGE_HASH_MISMATCH");
        byte[] manifest=null,dex=null;Set<String> names=new HashSet<>();long total=0;
        try(ZipFile zip=new ZipFile(archive)){
            if(zip.size()>256)throw new Failure("PACKAGE_LIMIT");
            Enumeration<? extends ZipEntry> rows=zip.entries();
            while(rows.hasMoreElements()){
                ZipEntry item=rows.nextElement();String name=item.getName();path(name);
                if(!names.add(name))throw new Failure("PACKAGE_DUPLICATE_ENTRY");
                long length=item.getSize(),compressed=item.getCompressedSize();
                if(length<0||compressed<0||length>MAX_INFLATED||total+length>MAX_INFLATED||(length>0&&(compressed==0||length>compressed*200)))throw new Failure("PACKAGE_LIMIT");
                if(name.matches("classes[0-9]+\\.dex"))throw new Failure("MULTIDEX_PROFILE_UNSUPPORTED");
                int limit=name.equals("manifest.json")?65536:name.equals("classes.dex")?MAX_DEX:MAX_INFLATED;
                if(length>limit)throw new Failure("PACKAGE_LIMIT");
                ByteArrayOutputStream selected=(name.equals("manifest.json")||name.equals("classes.dex"))?new ByteArrayOutputStream():null;
                CRC32 crc=new CRC32();long read=0;
                try(InputStream in=zip.getInputStream(item)){byte[] chunk=new byte[8192];int n;while((n=in.read(chunk))!=-1){read+=n;total+=n;if(read>limit||total>MAX_INFLATED)throw new Failure("PACKAGE_LIMIT");crc.update(chunk,0,n);if(selected!=null)selected.write(chunk,0,n);}}
                if(read!=length||crc.getValue()!=item.getCrc())throw new Failure("PACKAGE_ARCHIVE_INVALID");
                if(name.equals("manifest.json"))manifest=selected.toByteArray();else if(name.equals("classes.dex"))dex=selected.toByteArray();
            }
        }catch(ZipException e){throw new Failure("PACKAGE_ARCHIVE_INVALID");}
        if(dex==null)throw new Failure("PACKAGE_DEX_MISSING");if(manifest==null)throw new Failure("PACKAGE_MANIFEST_INVALID");
        final JsonNode node;
        try{node=JSON.readTree(manifest);}catch(JsonProcessingException e){throw new Failure("PACKAGE_MANIFEST_INVALID");}
        if(node==null||!node.isObject()||node.size()>32)throw new Failure("PACKAGE_MANIFEST_INVALID");
        JsonNode entry=node.get("pluginClassName"),name=node.get("name"),version=node.get("version"),resources=node.get("requiresResources");
        if(entry==null||!entry.isTextual()||entry.textValue().length()>512||!entry.textValue().matches("[A-Za-z_$][A-Za-z0-9_$]*(\\.[A-Za-z_$][A-Za-z0-9_$]*)*")||name==null||!name.isTextual()||name.textValue().isBlank()||name.textValue().length()>200||version==null||!version.isIntegralNumber()||!version.canConvertToInt()||version.intValue()<0||(resources!=null&&!resources.isBoolean()))throw new Failure("PACKAGE_MANIFEST_INVALID");
        if(resources!=null&&resources.booleanValue())throw new Failure("RESOURCE_PROFILE_UNSUPPORTED");
        checkDex(dex);
        return new Cs3Package(entry.textValue(),name.textValue(),version.intValue(),actual,dex);
    }
    private static void checkDex(byte[] dex)throws IOException {
        if(dex.length<112||dex.length>MAX_DEX||dex[0]!='d'||dex[1]!='e'||dex[2]!='x'||dex[3]!='\n'||dex[7]!=0)throw new Failure("DEX_HEADER_INVALID");
        String version=new String(dex,4,3,java.nio.charset.StandardCharsets.US_ASCII);
        if(!Arrays.asList("035","037","038","039","040","041").contains(version))throw new Failure("DEX_HEADER_INVALID");
        ByteBuffer header=ByteBuffer.wrap(dex).order(ByteOrder.LITTLE_ENDIAN);
        if(header.getInt(32)!=dex.length||header.getInt(36)!=112||header.getInt(40)!=0x12345678)throw new Failure("DEX_HEADER_INVALID");
        Adler32 adler=new Adler32();adler.update(dex,12,dex.length-12);
        MessageDigest sha1=digest("SHA-1");sha1.update(dex,32,dex.length-32);
        if((int)adler.getValue()!=header.getInt(8)||!MessageDigest.isEqual(sha1.digest(),Arrays.copyOfRange(dex,12,32)))throw new Failure("DEX_CHECKSUM_MISMATCH");
    }
}
