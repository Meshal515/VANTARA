package dev.vantara.runtime.android;

import androidx.test.platform.app.InstrumentationRegistry;
import android.content.Context;
import org.json.JSONObject;
import org.junit.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.Assert.*;

/** Actual published CS3 archives through the native format gate and isolated registration. Not live-source health. */
public class PublishedArchiveTest {
    @Test public void allFourPublishedArchivesPassNativeAdmissionAndRegisterWithoutNetwork()throws Exception {
        Context host=InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context tests=InstrumentationRegistry.getInstrumentation().getContext();
        for(String name:Arrays.asList("Animewitcher","Anime4up","AnimeRift","Witanime")){
            JSONObject pin;
            try(InputStream in=tests.getAssets().open(name+".json");ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
                byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)bytes.write(b,0,n);pin=new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));
            }
            File archive=File.createTempFile("native-archive-",".cs3",host.getCacheDir());
            File dex=File.createTempFile("native-archive-",".dex",host.getCacheDir());
            try {
                try(InputStream in=tests.getAssets().open(name+".cs3")){Files.copy(in,archive.toPath(),StandardCopyOption.REPLACE_EXISTING);}
                Cs3Package candidate=Cs3Package.read(archive,pin.getString("packageSha256"));
                assertEquals(name,pin.getString("entry"),candidate.entry());assertEquals(name,pin.getString("dexSha256"),candidate.dexHash());
                Files.write(dex.toPath(),candidate.dex());assertTrue(dex.setReadOnly());
                AndroidRuntimeClient.Scope scope=new AndroidRuntimeClient.Scope("cloudstream",candidate.packageHash(),"registration","offline-archive-test",new HashSet<>(Arrays.asList("https://fixtures.example")));
                try(AndroidRuntimeClient client=new AndroidRuntimeClient(host,scope,(owner,url)->{throw new AssertionError("No source traffic admitted during registration");})){
                    client.loadCloudStream(dex,candidate.dexHash(),candidate.entry()).get(12,TimeUnit.SECONDS);
                    JSONObject result=new JSONObject(client.invoke("capabilities","{}",3000).get(5,TimeUnit.SECONDS));
                    assertTrue(name,result.getBoolean("executed"));assertFalse(name,result.getBoolean("sourceFunctionsTested"));assertTrue(name,result.getJSONArray("sources").length()>0);
                }
            }finally{archive.delete();dex.delete();}
        }
    }
}
