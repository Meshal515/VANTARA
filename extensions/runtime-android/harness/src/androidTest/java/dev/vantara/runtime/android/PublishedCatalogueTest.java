package dev.vantara.runtime.android;

import static org.junit.Assert.*;
import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import dev.vantara.runtime.api.RuntimeHttpAccess;
import org.json.*;
import org.junit.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Actual published Anime4up code parses original deterministic HTML. No site traffic or fake parser. */
public class PublishedCatalogueTest {
    AndroidRuntimeClient client;File dex;JSONObject pin;Context host;
    static final String ORIGIN="https://w1.anime4up.rest";
    static final String HTML="<!doctype html><html><head><title>VANTARA offline catalogue</title></head><body>"+
        "<div class='main-widget'><div class='main-didget-head'><h3>أحدث الأعمال</h3></div>"+
        "<section class='themexblock anime-card-container'><a class='image' href='/anime/vantara-test/'><img src='https://images.example/poster.jpg'></a>"+
        "<div class='anime-grid'><div class='anime-card-themex'><div class='anime-card-title'><h3><a href='/anime/vantara-test/'>VANTARA Offline Test</a></h3></div>"+
        "<div class='anime-thumbnail'><a href='/anime/vantara-test/'><img src='https://images.example/poster.jpg' data-src='https://images.example/poster.jpg'></a></div>"+
        "<div class='anime-card-type'>TV</div></div></div></section></div></body></html>";
    @Before public void prepare() throws Exception {
        host=InstrumentationRegistry.getInstrumentation().getTargetContext();Context tests=InstrumentationRegistry.getInstrumentation().getContext();
        try(InputStream in=tests.getAssets().open("Anime4up.json");ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)out.write(b,0,n);pin=new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));}
        dex=File.createTempFile("published-catalogue-",".dex",host.getCacheDir());try(InputStream in=tests.getAssets().open("Anime4up.dex")){Files.copy(in,dex.toPath(),StandardCopyOption.REPLACE_EXISTING);}assertTrue(dex.setReadOnly());
    }
    @After public void cleanup() throws Exception{if(client!=null)client.close();if(dex!=null)Files.deleteIfExists(dex.toPath());}
    @Test public void publishedLegacyCatalogueParsesActualMetadataWithoutDeclaredSections() throws Exception {
        AtomicInteger exchanged=new AtomicInteger();
        // Only this pinned package's declared origin is admitted; transport never opens a socket.
        AndroidRuntimeClient.Scope scope=new AndroidRuntimeClient.Scope("cloudstream",pin.getString("packageSha256"),"Anime4up","offline-lab",new HashSet<>(Arrays.asList(ORIGIN)));
        client=new AndroidRuntimeClient(host,scope,new AndroidRuntimeClient.HostHttpTransport(){
            public RuntimeHttpAccess.Response exchange(AndroidRuntimeClient.Scope s,RuntimeHttpAccess.Request r){exchanged.incrementAndGet();assertTrue(r.url().startsWith(ORIGIN+"/"));assertEquals("GET",r.method());return new RuntimeHttpAccess.Response(r.url(),200,Collections.singletonMap("Content-Type",Arrays.asList("text/html; charset=utf-8")),HTML.getBytes(StandardCharsets.UTF_8));}
        });
        client.loadCloudStream(dex,pin.getString("dexSha256"),pin.getString("entry")).get(12,TimeUnit.SECONDS);
        JSONObject capability=new JSONObject(client.invoke("capabilities","{}",4000).get(6,TimeUnit.SECONDS));
        assertEquals(ORIGIN,capability.getJSONArray("sources").getJSONObject(0).getString("mainUrl"));
        JSONObject catalogue=new JSONObject(client.invoke("catalogue","{}",4000).get(6,TimeUnit.SECONDS));
        boolean found=false;JSONArray sections=catalogue.getJSONArray("items");
        for(int i=0;i<sections.length();i++){JSONArray items=sections.getJSONObject(i).getJSONArray("list");for(int j=0;j<items.length();j++){JSONObject item=items.getJSONObject(j);if(item.getString("name").equals("VANTARA Offline Test")){assertEquals(ORIGIN+"/anime/vantara-test/",item.getString("url"));assertEquals("https://images.example/poster.jpg",item.getString("posterUrl"));found=true;}}}
        assertTrue("Published parser returned no actual fixture work",found);assertTrue(exchanged.get()>0);
    }
}
