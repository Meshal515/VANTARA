package dev.vantara.runtime.cs3world;

import com.lagradost.cloudstream3.network.WebViewResolver;
import kotlin.text.Regex;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.junit.After;
import org.junit.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.junit.Assert.*;

/**
 * The library's extractors (StreamWish, Filemoon, ...) build CloudStream's hidden browser with Kotlin's default
 * arguments and use it as an interceptor on their own request. In the world it is VANTARA's: it asks the host browser
 * through the bridge and the request goes on to the stream the page asked for.
 */
public class WorldBrowserTest {
    private static final int ALL_DEFAULTS = 2 | 4 | 8 | 16 | 32 | 64;

    @After public void reset() { Bridge.installBrowser(null); }

    private static String through(WebViewResolver resolver, String page, List<String> reached) throws Exception {
        OkHttpClient client = new OkHttpClient.Builder()
                .addInterceptor(resolver)
                .addInterceptor(chain -> {
                    reached.add(chain.request().url() + " ua=" + chain.request().header("User-Agent"));
                    return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                            .body(ResponseBody.create("#EXTM3U", MediaType.get("application/vnd.apple.mpegurl"))).build();
                }).build();
        try (Response response = client.newCall(new Request.Builder().url(page).header("Referer", "https://anime.example/ep/1").build()).execute()) {
            return response.request().url().toString();
        }
    }

    @Test public void theLibrarysOwnConstructionAsksVantarasBrowserAndFollowsTheStream() throws Exception {
        List<String> jobs = Collections.synchronizedList(new ArrayList<>());
        Bridge.installBrowser(job -> {
            jobs.add(job);
            return "{\"intercepted\":{\"url\":\"https://cdn.example/hls/master.m3u8?t=1\",\"method\":\"GET\"," +
                    "\"headers\":{\"User-Agent\":\"PageAgent\",\"Referer\":\"https://player.example/e/abc\"}}," +
                    "\"extra\":[],\"seen\":[],\"scripts\":[]}";
        });
        WebViewResolver resolver = new WebViewResolver(new Regex("\\.m3u8"), null, null, false, null, null, 0L, ALL_DEFAULTS, null);
        List<String> reached = new ArrayList<>();
        String finalUrl = through(resolver, "https://player.example/e/abc", reached);
        assertEquals("https://cdn.example/hls/master.m3u8?t=1", finalUrl);
        assertEquals(Collections.singletonList("https://cdn.example/hls/master.m3u8?t=1 ua=PageAgent"), reached);
        assertEquals(1, jobs.size());
        String job = jobs.get(0);
        assertTrue(job, job.contains("\"url\":\"https://player.example/e/abc\""));
        assertTrue(job, job.contains("\"intercept\":\"\\\\.m3u8\""));
        assertTrue(job, job.contains("\"referer\":\"https://anime.example/ep/1\""));
        assertTrue("the library's default timeout", job.contains("\"timeoutMs\":60000"));
        assertTrue("CloudStream's default User-Agent", job.contains("Chrome/149"));
    }

    @Test public void withoutABrowserTheRequestGoesOnUnchangedAsOnCloudStreamsJvmBuild() throws Exception {
        WebViewResolver resolver = new WebViewResolver(new Regex("\\.m3u8"), null, null, false, null, null, 0L, ALL_DEFAULTS, null);
        List<String> reached = new ArrayList<>();
        assertEquals("https://player.example/e/abc", through(resolver, "https://player.example/e/abc", reached));
        assertEquals(1, reached.size());
    }

    @Test public void aRequestCallbackPicksFromWhatThePageRequestedWhenThePatternMatchedNothing() throws Exception {
        Bridge.installBrowser(job -> "{\"intercepted\":null,\"extra\":[{\"url\":\"https://cdn.example/sub.vtt\",\"method\":\"GET\",\"headers\":{}}]," +
                "\"seen\":[{\"url\":\"https://ads.example/x.js\",\"method\":\"GET\"},{\"url\":\"https://cdn.example/video.mp4\",\"method\":\"GET\"}],\"scripts\":[\"ok\"]}");
        List<String> scripts = new ArrayList<>();
        WebViewResolver resolver = new WebViewResolver(new Regex("never"), Collections.singletonList(new Regex("\\.vtt")),
                "UA", true, "1+1", s -> { scripts.add(s); return kotlin.Unit.INSTANCE; }, 10_000L);
        @SuppressWarnings("unchecked")
        kotlin.Pair<Request, List<Request>> result = (kotlin.Pair<Request, List<Request>>) resolver.resolveUsingWebView(
                new Request.Builder().url("https://player.example/e/abc").build(),
                r -> r.url().toString().endsWith(".mp4"), null);
        assertEquals("https://cdn.example/video.mp4", result.getFirst().url().toString());
        assertEquals(1, result.getSecond().size());
        assertEquals("https://cdn.example/sub.vtt", result.getSecond().get(0).url().toString());
        assertEquals(Collections.singletonList("ok"), scripts);
    }
}
