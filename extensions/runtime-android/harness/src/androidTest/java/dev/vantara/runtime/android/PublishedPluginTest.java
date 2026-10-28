package dev.vantara.runtime.android;

import static org.junit.Assert.*;
import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Real downloaded CS3 DEX, real isolated Android process. This proves registration, not source health. */
public class PublishedPluginTest {
    private AndroidRuntimeClient client;private File dex;
    @After public void cleanup() throws Exception{if(client!=null)client.close();if(dex!=null)Files.deleteIfExists(dex.toPath());}
    private void register(String name) throws Exception {
        Context host=InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context tests=InstrumentationRegistry.getInstrumentation().getContext();
        JSONObject pin;try(InputStream input=tests.getAssets().open(name+".json");ByteArrayOutputStream bytes=new ByteArrayOutputStream()){byte[] chunk=new byte[4096];int n;while((n=input.read(chunk))!=-1)bytes.write(chunk,0,n);pin=new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));}
        assertFalse(pin.getBoolean("sourceTrafficAllowed"));assertFalse(pin.getBoolean("sourceFunctionsTested"));
        dex=File.createTempFile("published-",".dex",host.getCacheDir());
        try(InputStream input=tests.getAssets().open(name+".dex")){Files.copy(input,dex.toPath(),StandardCopyOption.REPLACE_EXISTING);}assertTrue(dex.setReadOnly());
        AtomicInteger traffic=new AtomicInteger();
        AndroidRuntimeClient.Scope scope=new AndroidRuntimeClient.Scope("cloudstream",pin.getString("packageSha256"),name,"offline-lab",new HashSet<>(Arrays.asList("https://offline.vantara.example")));
        client=new AndroidRuntimeClient(host,scope,(s,u)->{traffic.incrementAndGet();throw new AssertionError("Source-site traffic forbidden");});
        client.loadCloudStream(dex,pin.getString("dexSha256"),pin.getString("entry")).get(12,TimeUnit.SECONDS);
        JSONObject profile=new JSONObject(client.invoke("capabilities","{}",4000).get(6,TimeUnit.SECONDS));
        assertTrue(profile.getBoolean("executed"));assertFalse(profile.getBoolean("sourceFunctionsTested"));
        JSONArray sources=profile.getJSONArray("sources");assertTrue("Published plugin did not register sources",sources.length()>0);
        for(int i=0;i<sources.length();i++){JSONObject source=sources.getJSONObject(i);assertFalse(source.getString("name").isEmpty());assertTrue(source.getString("mainUrl").startsWith("https://"));}
        assertEquals("Offline registration contacted a source",0,traffic.get());
        assertFalse(client.isClosed());
    }
    @Test public void animeWitcherPublishedPackageActuallyLoadsAndRegisters() throws Exception{register("Animewitcher");}
    @Test public void anime4upPublishedPackageActuallyLoadsAndRegisters() throws Exception{register("Anime4up");}
    @Test public void animeRiftPublishedPackageLoadsWithoutAnySourceTraffic() throws Exception{register("AnimeRift");}
    @Test public void witAnimePublishedPackageActuallyLoadsAndRegisters() throws Exception{register("Witanime");}
}
