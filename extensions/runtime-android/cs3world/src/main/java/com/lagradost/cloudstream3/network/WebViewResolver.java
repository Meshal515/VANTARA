package com.lagradost.cloudstream3.network;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.vantara.runtime.cs3world.Bridge;
import kotlin.Pair;
import kotlin.Unit;
import kotlin.collections.CollectionsKt;
import kotlin.coroutines.Continuation;
import kotlin.jvm.functions.Function1;
import kotlin.jvm.internal.DefaultConstructorMarker;
import kotlin.text.Regex;
import okhttp3.Headers;
import okhttp3.Interceptor;
import okhttp3.Request;
import okhttp3.Response;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * CloudStream's hidden browser inside the library world, in place of the library's JVM build (which intercepts
 * nothing: there is no WebView on a JVM). Same class, constructors and methods as library 4.9.1, so its extractors
 * (StreamWish, Filemoon, Filesim, GenericM3U8, WatchSB) link to this one; it asks VANTARA's hidden browser in the host
 * through {@link Bridge#browse}. The build replaces the library's class with this one (cs3world/build.gradle).
 *
 * The suspend methods answer synchronously (a suspend function may return its value without suspending): the
 * library's extractors run on the worker's IO threads, as the provider's own WebViewResolver does.
 */
public final class WebViewResolver implements Interceptor {
    public static final Companion Companion = new Companion(null);
    private static final long DEFAULT_TIMEOUT = 60_000L;
    private static final String DEFAULT_USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
    private static volatile String webViewUserAgent;
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Regex interceptUrl;
    private final List<Regex> additionalUrls;
    private final String userAgent;
    private final boolean useOkhttp;
    private final String script;
    private final Function1<? super String, Unit> scriptCallback;
    private final long timeout;

    public WebViewResolver(Regex interceptUrl, List<Regex> additionalUrls, String userAgent, boolean useOkhttp,
                           String script, Function1<? super String, Unit> scriptCallback, long timeout) {
        if (interceptUrl == null) throw new NullPointerException("interceptUrl");
        if (additionalUrls == null) throw new NullPointerException("additionalUrls");
        this.interceptUrl = interceptUrl;
        this.additionalUrls = additionalUrls;
        this.userAgent = userAgent;
        this.useOkhttp = useOkhttp;
        this.script = script;
        this.scriptCallback = scriptCallback;
        this.timeout = timeout;
    }

    /** Kotlin's default-arguments constructor, as the library's extractors call it. */
    @SuppressWarnings("unchecked")
    public WebViewResolver(Regex interceptUrl, List additionalUrls, String userAgent, boolean useOkhttp, String script,
                           Function1 scriptCallback, long timeout, int mask, DefaultConstructorMarker marker) {
        this(interceptUrl,
                (mask & 2) != 0 ? CollectionsKt.emptyList() : (List<Regex>) additionalUrls,
                (mask & 4) != 0 ? DEFAULT_USER_AGENT : userAgent,
                (mask & 8) != 0 || useOkhttp,
                (mask & 16) != 0 ? null : script,
                (mask & 32) != 0 ? null : (Function1<? super String, Unit>) scriptCallback,
                (mask & 64) != 0 ? DEFAULT_TIMEOUT : timeout);
    }

    public final Regex getInterceptUrl() { return interceptUrl; }
    public final List<Regex> getAdditionalUrls() { return additionalUrls; }
    public final String getUserAgent() { return userAgent; }
    public final boolean getUseOkhttp() { return useOkhttp; }
    public final String getScript() { return script; }
    public final Function1<String, Unit> getScriptCallback() {
        @SuppressWarnings("unchecked") Function1<String, Unit> callback = (Function1<String, Unit>) scriptCallback;
        return callback;
    }
    public final long getTimeout() { return timeout; }

    @Override public Response intercept(Interceptor.Chain chain) throws IOException {
        Request request = chain.request();
        Request fixed = resolve(request, null).getFirst();
        return chain.proceed(fixed != null ? fixed : request);
    }

    public final Object resolveUsingWebView(String url, String referer, String method,
                                            Function1<? super Request, Boolean> requestCallBack,
                                            Continuation<? super Pair<Request, ? extends List<Request>>> continuation) {
        return resolveUsingWebView(url, referer, Collections.<String, String>emptyMap(), method, requestCallBack, continuation);
    }

    public static Object resolveUsingWebView$default(WebViewResolver self, String url, String referer, String method,
                                                     Function1 requestCallBack, Continuation continuation, int mask, Object unused) {
        @SuppressWarnings("unchecked") Function1<? super Request, Boolean> callback = (mask & 8) != 0 ? null : requestCallBack;
        @SuppressWarnings("unchecked") Continuation<? super Pair<Request, ? extends List<Request>>> c = continuation;
        return self.resolveUsingWebView(url, (mask & 2) != 0 ? null : referer, (mask & 4) != 0 ? "GET" : method, callback, c);
    }

    public final Object resolveUsingWebView(String url, String referer, Map<String, String> headers, String method,
                                            Function1<? super Request, Boolean> requestCallBack,
                                            Continuation<? super Pair<Request, ? extends List<Request>>> continuation) {
        Request.Builder builder = new Request.Builder().url(url);
        if (headers != null) for (Map.Entry<String, String> h : headers.entrySet()) {
            try { builder.header(h.getKey(), h.getValue()); } catch (IllegalArgumentException ignored) { }
        }
        if (referer != null && !referer.isEmpty()) builder.header("Referer", referer);
        return resolve(builder.build(), requestCallBack);
    }

    public static Object resolveUsingWebView$default(WebViewResolver self, String url, String referer, Map headers, String method,
                                                     Function1 requestCallBack, Continuation continuation, int mask, Object unused) {
        @SuppressWarnings("unchecked") Map<String, String> h = (mask & 4) != 0 ? Collections.<String, String>emptyMap() : (Map<String, String>) headers;
        @SuppressWarnings("unchecked") Function1<? super Request, Boolean> callback = (mask & 16) != 0 ? null : requestCallBack;
        @SuppressWarnings("unchecked") Continuation<? super Pair<Request, ? extends List<Request>>> c = continuation;
        return self.resolveUsingWebView(url, (mask & 2) != 0 ? null : referer, h, (mask & 8) != 0 ? "GET" : method, callback, c);
    }

    public final Object resolveUsingWebView(Request requestCreator, Function1<? super Request, Boolean> requestCallBack,
                                            Continuation<? super Pair<Request, ? extends List<Request>>> continuation) {
        return resolve(requestCreator, requestCallBack);
    }

    public static Object resolveUsingWebView$default(WebViewResolver self, Request requestCreator, Function1 requestCallBack,
                                                     Continuation continuation, int mask, Object unused) {
        @SuppressWarnings("unchecked") Function1<? super Request, Boolean> callback = (mask & 2) != 0 ? null : requestCallBack;
        @SuppressWarnings("unchecked") Continuation<? super Pair<Request, ? extends List<Request>>> c = continuation;
        return self.resolveUsingWebView(requestCreator, callback, c);
    }

    private Pair<Request, List<Request>> resolve(Request request, Function1<? super Request, Boolean> requestCallBack) {
        Pair<Request, List<Request>> nothing = new Pair<>(null, Collections.<Request>emptyList());
        String answer;
        try {
            Map<String, Object> job = new LinkedHashMap<>();
            job.put("url", request.url().toString());
            job.put("method", request.method());
            Map<String, String> headers = new LinkedHashMap<>();
            for (String name : request.headers().names()) if (!"Referer".equalsIgnoreCase(name)) headers.put(name, request.header(name));
            job.put("headers", headers);
            job.put("referer", request.header("Referer"));
            job.put("userAgent", userAgent != null ? userAgent : webViewUserAgent);
            job.put("intercept", interceptUrl.getPattern());
            List<String> extra = new ArrayList<>();
            for (Regex r : additionalUrls) extra.add(r.getPattern());
            job.put("extra", extra);
            job.put("script", script);
            job.put("timeoutMs", timeout);
            answer = Bridge.browse(JSON.writeValueAsString(job));
        } catch (Exception failure) { return nothing; }
        if (answer == null) return nothing;
        JsonNode result;
        try { result = JSON.readTree(answer); } catch (Exception failure) { return nothing; }
        if (result == null) return nothing;

        JsonNode scripts = result.get("scripts");
        if (scripts != null && scriptCallback != null) for (JsonNode s : scripts) {
            try { scriptCallback.invoke(s.asText()); } catch (RuntimeException ignored) { }
        }
        List<Request> extra = new ArrayList<>();
        JsonNode extraNodes = result.get("extra");
        if (extraNodes != null) for (JsonNode n : extraNodes) { Request r = request(n); if (r != null) extra.add(r); }
        Request intercepted = request(result.get("intercepted"));
        if (intercepted == null && requestCallBack != null) {
            JsonNode seen = result.get("seen");
            if (seen != null) for (JsonNode n : seen) {
                Request r = request(n);
                if (r == null) continue;
                Boolean accept;
                try { accept = requestCallBack.invoke(r); } catch (RuntimeException failure) { accept = Boolean.FALSE; }
                if (Boolean.TRUE.equals(accept)) { intercepted = r; break; }
            }
        }
        return new Pair<>(intercepted, extra);
    }

    private static Request request(JsonNode node) {
        if (node == null || node.isNull()) return null;
        JsonNode url = node.get("url");
        if (url == null || !url.asText().startsWith("http")) return null;
        Headers.Builder headers = new Headers.Builder();
        JsonNode h = node.get("headers");
        if (h != null) for (Iterator<Map.Entry<String, JsonNode>> it = h.fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> e = it.next();
            try { headers.add(e.getKey(), e.getValue().asText()); } catch (IllegalArgumentException ignored) { }
        }
        try { return new Request.Builder().url(url.asText()).headers(headers.build()).build(); }
        catch (IllegalArgumentException invalid) { return null; }
    }

    public static final class Companion {
        private Companion() { }
        public Companion(DefaultConstructorMarker marker) { this(); }
        public final long getDEFAULT_TIMEOUT() { return DEFAULT_TIMEOUT; }
        public final String getWebViewUserAgent() { return webViewUserAgent; }
        public final void setWebViewUserAgent(String value) { webViewUserAgent = value; }
    }
}
