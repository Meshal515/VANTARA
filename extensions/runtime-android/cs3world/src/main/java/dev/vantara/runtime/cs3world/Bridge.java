package dev.vantara.runtime.cs3world;

import com.lagradost.cloudstream3.MainActivityKt;
import com.lagradost.cloudstream3.SubtitleFile;
import com.lagradost.cloudstream3.utils.ExtractorApiKt;
import com.lagradost.cloudstream3.utils.ExtractorLink;
import kotlin.Unit;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlinx.coroutines.BuildersKt;
import kotlinx.coroutines.TimeoutKt;
import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.function.Function;

/**
 * The only entry into CloudStream's own library inside VANTARA's isolated worker. The library lives in its own class
 * loader world (its own Kotlin, coroutines, OkHttp); only java.* types cross this boundary, so its versions never meet
 * VANTARA's. Every request it makes goes through {@code transport}: VANTARA's broker, with its DNS, SNI and origin policy.
 *
 * Request map: url, method, headers (Map&lt;String,List&lt;String&gt;&gt;), body (byte[] or null), followRedirects (Boolean).
 * Response map: url, status (Integer), headers (Map&lt;String,List&lt;String&gt;&gt;), body (byte[]).
 */
public final class Bridge {
    private Bridge() {}
    private static volatile Function<Map<String, Object>, Map<String, Object>> transport;
    private static volatile boolean installed;

    /** Sets (or replaces) the transport; the library's clients are wired to it once. */
    public static synchronized void install(Function<Map<String, Object>, Map<String, Object>> next) {
        transport = next;
        if (installed) return;
        OkHttpClient client = new OkHttpClient.Builder()
                .followRedirects(false).followSslRedirects(false)
                .connectTimeout(20, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).callTimeout(45, TimeUnit.SECONDS)
                .addInterceptor(chain -> {
                    Function<Map<String, Object>, Map<String, Object>> current = transport;
                    if (current == null) throw new java.io.IOException("TRANSPORT_UNAVAILABLE");
                    // NiceHttp sets follow-redirects per request on its own client copy; this interceptor answers the
                    // whole call, so the broker follows (or not) exactly as that request asked.
                    boolean follow = !(chain.call() instanceof okhttp3.internal.connection.RealCall)
                            || ((okhttp3.internal.connection.RealCall) chain.call()).getClient().followRedirects();
                    return exchange(current, chain.request(), follow);
                })
                .build();
        MainActivityKt.getApp().setBaseClient(client);
        MainActivityKt.getInsecureApp().setBaseClient(client);
        installed = true;
    }

    private static Response exchange(Function<Map<String, Object>, Map<String, Object>> transport, Request request, boolean follow) throws java.io.IOException {
        Map<String, Object> out = new HashMap<>();
        out.put("url", request.url().toString());
        out.put("method", request.method());
        out.put("headers", request.headers().toMultimap());
        RequestBody body = request.body();
        if (body != null) {
            okio.Buffer buffer = new okio.Buffer();
            body.writeTo(buffer);
            if (buffer.size() > 1024 * 1024) throw new java.io.IOException("REQUEST_BODY_LIMIT");
            out.put("body", buffer.readByteArray());
            MediaType type = body.contentType();
            if (type != null && request.header("Content-Type") == null) {
                Map<String, List<String>> headers = new LinkedHashMap<>(request.headers().toMultimap());
                headers.put("Content-Type", java.util.Collections.singletonList(type.toString()));
                out.put("headers", headers);
            }
        }
        out.put("followRedirects", follow);
        Map<String, Object> in;
        try { in = transport.apply(out); }
        catch (RuntimeException failure) { throw new java.io.IOException(failure.getMessage() == null ? "TRANSPORT_FAILED" : failure.getMessage()); }
        Headers.Builder headers = new Headers.Builder();
        @SuppressWarnings("unchecked") Map<String, List<String>> answered = (Map<String, List<String>>) in.getOrDefault("headers", java.util.Collections.emptyMap());
        for (Map.Entry<String, List<String>> row : answered.entrySet())
            for (String value : row.getValue()) headers.addUnsafeNonAscii(row.getKey(), value);
        Headers built = headers.build();
        String type = built.get("Content-Type");
        byte[] bytes = (byte[]) in.getOrDefault("body", new byte[0]);
        Request answeredFor = request.newBuilder().url((String) in.getOrDefault("url", request.url().toString())).build();
        return new Response.Builder().request(answeredFor).protocol(Protocol.HTTP_1_1)
                .code((Integer) in.get("status")).message("")
                .headers(built)
                .body(ResponseBody.create(bytes, type == null ? null : MediaType.parse(type)))
                .build();
    }

    /** Every extractor CloudStream ships: name and main URL, for matching and diagnostics. */
    public static List<String[]> extractors() {
        List<String[]> out = new ArrayList<>();
        for (Object api : ExtractorApiKt.getExtractorApis()) {
            com.lagradost.cloudstream3.utils.ExtractorApi e = (com.lagradost.cloudstream3.utils.ExtractorApi) api;
            out.add(new String[]{e.getName(), e.getMainUrl()});
        }
        return out;
    }

    /**
     * CloudStream's own loadExtractor for one server page. Each link and subtitle is handed over the moment the
     * extractor produces it. Returns whether an extractor claimed the page.
     */
    public static boolean extract(String url, String referer, long timeoutMs,
                                  Consumer<Map<String, Object>> link, Consumer<Map<String, Object>> subtitle) throws Exception {
        kotlin.jvm.functions.Function1<SubtitleFile, Unit> onSubtitle = s -> {
            Map<String, Object> m = new HashMap<>();
            m.put("lang", s.getLang()); m.put("url", s.getUrl()); m.put("headers", s.getHeaders());
            subtitle.accept(m);
            return Unit.INSTANCE;
        };
        kotlin.jvm.functions.Function1<ExtractorLink, Unit> onLink = l -> {
            Map<String, Object> m = new HashMap<>();
            m.put("source", l.getSource()); m.put("name", l.getName()); m.put("url", l.getUrl());
            m.put("referer", l.getReferer()); m.put("quality", l.getQuality()); m.put("headers", l.getHeaders());
            m.put("type", l.getType().name());
            link.accept(m);
            return Unit.INSTANCE;
        };
        Object claimed = BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, outer) ->
                TimeoutKt.withTimeoutOrNull(timeoutMs, (inner, cont) ->
                        ExtractorApiKt.loadExtractor(url, referer, onSubtitle, onLink, cont), outer));
        return Boolean.TRUE.equals(claimed);
    }
}
