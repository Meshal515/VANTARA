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
    static final String DETAIL="<!doctype html><html><head><title>VANTARA Offline Test</title></head><body>"+
        "<h1 class='anime-details-title'>VANTARA Offline Test</h1><div class='anime-thumbnail'><img src='https://images.example/poster.jpg'></div>"+
        "<p class='anime-story'>وصف مصدر اختباري</p><div class='anime-info'>2026</div><ul class='anime-genres'><li><a>Action</a></li></ul>"+
        "<div id='episodesList'><div class='themexblock'><a href='"+ORIGIN+"/episode/vantara-test-1/'>الحلقة 1</a></div></div>"+
        "<ul class='all-episodes-list'><li><a href='"+ORIGIN+"/episode/vantara-test-1/'>الحلقة 1</a></li></ul></body></html>";
    static final String EPISODE="<!doctype html><html><head><title>VANTARA test episode</title></head><body>"+
        "<div class='anime-page-link'><a href='"+ORIGIN+"/anime/vantara-test/'>VANTARA Offline Test</a></div>"+
        "<div class='download-list'><table class='table'><tbody><tr><td>1080p</td><td class='td-link'><a href='https://video.fixture.example/direct.mp4'>Direct</a></td></tr></tbody></table></div></body></html>";
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
    @Test public void publishedSearchDetailsEpisodesAndDirectLinksUseActualProviderCode() throws Exception {
        AtomicInteger calls=new AtomicInteger();
        client=new AndroidRuntimeClient(host,new AndroidRuntimeClient.Scope("cloudstream",pin.getString("packageSha256"),"Anime4up","offline-lab",new HashSet<>(Arrays.asList(ORIGIN))),new AndroidRuntimeClient.HostHttpTransport(){
            public RuntimeHttpAccess.Response exchange(AndroidRuntimeClient.Scope scope,RuntimeHttpAccess.Request request){
                calls.incrementAndGet();assertTrue(request.url().startsWith(ORIGIN+"/"));
                String html=request.url().contains("/episode/")?EPISODE:request.url().contains("/anime/vantara-test/")?DETAIL:HTML;
                return new RuntimeHttpAccess.Response(request.url(),200,Collections.singletonMap("Content-Type",Arrays.asList("text/html; charset=utf-8")),html.getBytes(StandardCharsets.UTF_8));
            }
        });
        client.loadCloudStream(dex,pin.getString("dexSha256"),pin.getString("entry")).get(12,TimeUnit.SECONDS);
        JSONArray search=call("search",new JSONObject().put("query","VANTARA")).getJSONArray("items");
        assertTrue("Published search parser did not return the fixture work",search.length()>0);
        assertEquals("VANTARA Offline Test",search.getJSONObject(0).getString("name"));
        String url=search.getJSONObject(0).getString("url");assertEquals(ORIGIN+"/anime/vantara-test/",url);
        JSONObject detail=call("details",new JSONObject().put("url",url)).getJSONObject("item");
        assertEquals("VANTARA Offline Test",detail.getString("name"));assertEquals("وصف مصدر اختباري",detail.getString("plot"));
        JSONArray episodes=call("episodes",new JSONObject().put("url",url)).getJSONArray("items");assertEquals(1,episodes.length());
        String opaque=episodes.getJSONObject(0).getString("data");assertTrue(opaque.contains("/episode/vantara-test-1/"));
        JSONArray links=call("videoLinks",new JSONObject().put("data",opaque)).getJSONArray("items");
        assertTrue("Published extraction returned no actual link",links.length()>0);assertEquals("https://video.fixture.example/direct.mp4",links.getJSONObject(0).getString("url"));
        assertTrue(calls.get()>=4);
    }
    private JSONObject call(String operation,JSONObject input) throws Exception{return new JSONObject(client.invoke(operation,input.toString(),4000).get(6,TimeUnit.SECONDS));}
}
