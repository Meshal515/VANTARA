package dev.vantara.runtime.android;

import static org.junit.Assert.*;
import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import dev.vantara.runtime.api.RuntimeHttpAccess;
import org.json.*;
import org.junit.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** Published Rift DEX parses authored API responses. ZERO source sockets.
 * This does not admit live Rift traffic, validate real authentication, persist
 * a source identity across worker generations, or prove video playback. */
public class PublishedRiftFlowTest {
    private static final String ORIGIN="https://gateway.embrassme.top";
    private JSONObject item(int n)throws Exception{return new JSONObject().put("_id","work-"+n).put("title","VANTARA Offline Rift "+n).put("main_picture","https://images.fixture.example/"+n+".jpg").put("synopsis","Offline plot "+n).put("release_year",2026).put("release_status","finished");}
    private JSONArray works()throws Exception{JSONArray out=new JSONArray();for(int n=1;n<=5;n++)out.put(item(n));return out;}
    private int number(String value)throws Exception{
        java.util.regex.Matcher match=java.util.regex.Pattern.compile("(?:work|host)-([1-5])").matcher(value);
        assertTrue("Missing offline work identity",match.find());return Integer.parseInt(match.group(1));
    }
    private JSONObject response(RuntimeHttpAccess.Request request)throws Exception{
        String path=java.net.URI.create(request.url()).getPath();
        JSONObject body=request.body()==null?new JSONObject():new JSONObject(new String(request.body(),StandardCharsets.UTF_8));
        if(path.endsWith("/library/home_content"))return new JSONObject().put("sections",new JSONArray().put(new JSONObject().put("sectionTitle","Offline works").put("items",works())));
        if(path.endsWith("/library/search")){assertEquals("POST",request.method());assertTrue(body.has("query"));return new JSONObject().put("items",works()).put("has_more",false);}
        if(path.contains("/library/details/"))return new JSONObject().put("item",item(number(path)));
        if(path.contains("/library/episodes/")){int n=number(path);return new JSONObject().put("items",new JSONArray().put(new JSONObject().put("_id","ep-"+n).put("episode_number",n)));}
        if(path.endsWith("/episode/sources")){int n=number(body.getString("animeId"));assertEquals("ep-"+n,body.getString("episodeId"));return new JSONObject().put("items",new JSONArray().put(new JSONObject().put("_id","host-"+n).put("server_name","Offline direct").put("provider","rift-streamer").put("sub_title","ar_fixture").put("qualities",new JSONArray().put("1080P"))));}
        if(path.endsWith("/source/can_play"))return new JSONObject().put("sessionId","offline-session");
        if(path.endsWith("/ads_manager/claim")){assertEquals("PUT",request.method());return new JSONObject().put("ok",true);}
        if(path.endsWith("/source/direct_link")){assertEquals("offline-session",body.getString("sessionId"));return new JSONObject().put("url_response",true).put("videoUrl","https://media.fixture.example/rift-"+number(body.getString("id"))+".mp4").put("http_headers",new JSONObject().put("X-Fixture","offline"));}
        throw new AssertionError("Unexpected offline API path: "+path);
    }
    @Test public void publishedRiftParsesFiveOfflineWorksSearchEpisodesAndDirectHeaders()throws Exception{
        Context host=InstrumentationRegistry.getInstrumentation().getTargetContext(),tests=InstrumentationRegistry.getInstrumentation().getContext();
        JSONObject pin;try(InputStream input=tests.getAssets().open("AnimeRift.json");ByteArrayOutputStream bytes=new ByteArrayOutputStream()){byte[] chunk=new byte[4096];int n;while((n=input.read(chunk))!=-1)bytes.write(chunk,0,n);pin=new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));}
        File dex=File.createTempFile("rift-flow-",".dex",host.getCacheDir());
        try(InputStream input=tests.getAssets().open("AnimeRift.dex")){Files.copy(input,dex.toPath(),StandardCopyOption.REPLACE_EXISTING);}assertTrue(dex.setReadOnly());
        AtomicInteger calls=new AtomicInteger();
        AndroidRuntimeClient.Scope scope=new AndroidRuntimeClient.Scope("cloudstream",pin.getString("packageSha256"),"AnimeRift","offline-flow",Collections.singleton(ORIGIN));
        try(AndroidRuntimeClient client=new AndroidRuntimeClient(host,scope,new AndroidRuntimeClient.HostHttpTransport(){
            @Override public RuntimeHttpAccess.Response exchange(AndroidRuntimeClient.Scope caller,RuntimeHttpAccess.Request request)throws Exception{
                assertEquals("gateway.embrassme.top",java.net.URI.create(request.url()).getHost());calls.incrementAndGet();
                return new RuntimeHttpAccess.Response(request.url(),200,Collections.singletonMap("Content-Type",Collections.singletonList("application/json")),response(request).toString().getBytes(StandardCharsets.UTF_8));
            }
        })){
            client.loadCloudStream(dex,pin.getString("dexSha256"),pin.getString("entry")).get(12,TimeUnit.SECONDS);
            assertEquals(0,calls.get());
            JSONObject home=invoke(client,"catalogue",new JSONObject());
            JSONArray rows=home.getJSONArray("items").getJSONObject(0).getJSONArray("list");assertEquals(5,rows.length());
            Set<String> ids=new HashSet<>();
            for(int n=1;n<=5;n++){
                String url=ORIGIN+"/api/v4/library/details/work-"+n;ids.add(url);
                JSONArray search=invoke(client,"search",new JSONObject().put("query","work-"+n)).getJSONArray("items");assertEquals(5,search.length());
                JSONObject detail=invoke(client,"details",new JSONObject().put("url",url)).getJSONObject("item");assertEquals("VANTARA Offline Rift "+n,detail.getString("name"));assertEquals("Offline plot "+n,detail.getString("plot"));
                JSONArray episodes=invoke(client,"episodes",new JSONObject().put("url",url)).getJSONArray("items");assertEquals(1,episodes.length());
                JSONObject episode=episodes.getJSONObject(0);assertEquals(n,episode.getInt("episode"));assertEquals("work-"+n+"|ep-"+n+"|"+n,episode.getString("data"));
                JSONArray links=invoke(client,"videoLinks",new JSONObject().put("data",episode.getString("data"))).getJSONArray("items");assertEquals(1,links.length());
                JSONObject link=links.getJSONObject(0);assertEquals("https://media.fixture.example/rift-"+n+".mp4",link.getString("url"));assertEquals(1080,link.getInt("quality"));assertEquals("offline",link.getJSONObject("headers").getString("X-Fixture"));
            }
            assertEquals(5,ids.size());assertTrue(calls.get()>=30);
        }finally{Files.deleteIfExists(dex.toPath());}
    }
    private JSONObject invoke(AndroidRuntimeClient client,String operation,JSONObject input)throws Exception{return new JSONObject(client.invokeJson(operation,input.toString(),4000).get(6,TimeUnit.SECONDS));}
}
