package dev.vantara.runtime.cs3world;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.*;

/**
 * CloudStream's own extractors through the bridge, offline: every request reaches only the transport VANTARA hands
 * in (its broker in the worker), and links come back as plain maps (no library type crosses the boundary).
 */
public class BridgeTest {
    @Test public void theOriginalLibraryExtractsThroughVantarasTransportOnly() throws Exception {
        String file = "https://download2392.mediafire.com/abc/6lkt7d27mtnn0jq/VERTEX_FORCE_001_480p.mp4";
        String page = "<html><body><a class=\"input popsok\" aria-label=\"Download file\" href=\"" + file + "\" id=\"downloadButton\" rel=\"nofollow\">Download (120MB)</a></body></html>";
        List<String> asked = Collections.synchronizedList(new ArrayList<>());
        Bridge.install(request -> {
            asked.add((String) request.get("url"));
            Map<String, Object> answer = new HashMap<>();
            answer.put("url", request.get("url"));
            answer.put("status", 200);
            answer.put("headers", Collections.singletonMap("Content-Type", Collections.singletonList("text/html; charset=utf-8")));
            answer.put("body", page.getBytes(StandardCharsets.UTF_8));
            return answer;
        });
        assertTrue("CloudStream ships its full extractor list", Bridge.extractors().size() > 200);
        List<Map<String, Object>> links = new ArrayList<>();
        boolean claimed = Bridge.extract("https://www.mediafire.com/file_premium/6lkt7d27mtnn0jq/VERTEX_FORCE_001_480p.mp4/file", null, 20_000,
                links::add, s -> {});
        assertTrue(claimed);
        assertEquals(1, links.size());
        assertEquals(file, links.get(0).get("url"));
        assertEquals("VIDEO", links.get(0).get("type"));
        assertFalse("every request went through VANTARA's transport", asked.isEmpty());
        for (String url : asked) assertTrue(url, url.startsWith("https://www.mediafire.com/"));
    }

    @Test public void aTransportRefusalIsAFailedServerNotACrash() throws Exception {
        Bridge.install(request -> { throw new RuntimeException("ORIGIN_NOT_ALLOWED"); });
        List<Map<String, Object>> links = new ArrayList<>();
        Bridge.extract("https://www.mediafire.com/file/x/y.mp4/file", null, 10_000, links::add, s -> {});
        assertTrue(links.isEmpty());
    }
}
