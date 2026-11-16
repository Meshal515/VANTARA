package com.vantara.addons

import okhttp3.Authenticator
import okhttp3.CookieJar
import okhttp3.Dns
import okhttp3.EventListener
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

/** Explicit addon credentials belong to the selected media origin, not redirected CDNs/subtitles. */
internal fun scopedAddonRequest(request: Request, origin: HttpUrl?, supplied: Set<String>): Request {
    if (origin != null && request.url.scheme == origin.scheme && request.url.host == origin.host && request.url.port == origin.port) return request
    val navigation = setOf("user-agent", "referer", "origin", "accept", "accept-language", "range")
    val builder = request.newBuilder()
    for (header in supplied + setOf("Authorization", "Cookie", "Cookie2", "Proxy-Authorization")) {
        if (header.lowercase() !in navigation) builder.removeHeader(header)
    }
    val referer = request.header("Referer")
    if (referer != null && runCatching { val uri = java.net.URI(referer); uri.rawQuery != null || uri.userInfo != null }.getOrDefault(true)) builder.removeHeader("Referer")
    return builder.build()
}

/**
 * The media link policy. Remote Stremio addons: [RemoteAddonClient.publicUrl] (https:443), unchanged.
 * A source engine's own links (CloudStream `addon|cs3|`, [plain]) as the original engine plays them: http and any
 * port are real servers there (reference round 1: Akwam http://…downet.net, mp4upload https://…:183). Never
 * credentials in the link, local names or private/loopback literals; a DNS name is checked again at connect time
 * ([RemoteAddonClient.publicAddresses] in the client below), so redirects cannot reach the user's network.
 */
fun addonMediaUrl(input: String, plain: Boolean): HttpUrl {
    if (!plain) return RemoteAddonClient.publicUrl(input)
    val u = input.toHttpUrl()
    require(u.scheme == "http" || u.scheme == "https") { "رابط وسائط غير مسموح" }
    require(u.username.isEmpty() && u.password.isEmpty()) { "رابط وسائط يحمل بيانات دخول" }
    if (u.host.matches(Regex("[0-9.]+")) || u.host.contains(':')) RemoteAddonClient.publicAddresses(listOf(java.net.InetAddress.getByName(u.host)))
    else require(Regex("([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z][a-z0-9-]*").matches(u.host) &&
        !Regex("(?:^|\\.)(localhost|local|internal|lan|home)$").containsMatchIn(u.host)) { "مضيف وسائط غير مسموح" }
    return u
}

/** Addon playback shares the transport pool, but never source cookies or solver interceptors. */
fun nativeAddonMediaClient(base: OkHttpClient, mediaUrl: String? = null, headers: Map<String, String> = emptyMap(), plainMedia: Boolean = false): OkHttpClient {
    val origin = mediaUrl?.takeIf { it.startsWith("https:") || plainMedia && it.startsWith("http:") }?.let { addonMediaUrl(it, plainMedia) }
    val builder = base.newBuilder()
        .cookieJar(CookieJar.NO_COOKIES).authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
        .eventListener(EventListener.NONE).cache(null)
        .dns(Dns { RemoteAddonClient.publicAddresses(base.dns.lookup(it)) })
    builder.interceptors().clear()
    builder.networkInterceptors().clear()
    // Validate redirected manifests, media chunks and subtitles, not just the initial URL.
    builder.addNetworkInterceptor { chain ->
        addonMediaUrl(chain.request().url.toString(), plainMedia)
        chain.proceed(scopedAddonRequest(chain.request(), origin, headers.keys))
    }
    val plain = builder.build()
    // Media hosts a source engine marked (CloudStream/Aniyomi video servers, AnimeHostRouter.markVideoHost) may sit
    // behind an ISP filter that resets the TLS handshake on their name, as their sites do. Those hosts get the same
    // one-time retry with a split ClientHello as the site requests. Unmarked hosts (Stremio addons) are unchanged.
    val fragmenting = plain.newBuilder().socketFactory(com.vantara.anime.net.SniFragmentingSocketFactory()).build()
    return plain.newBuilder().addInterceptor { chain ->
        val request = chain.request()
        val host = request.url.host.lowercase()
        if (!com.vantara.anime.net.AnimeHostRouter.prefersDoh(host)) return@addInterceptor chain.proceed(request)
        if (host in fragmentedMediaHosts) return@addInterceptor fragmenting.newCall(request).execute()
        try { chain.proceed(request) }
        catch (e: java.io.IOException) {
            if (chain.call().isCanceled() || !com.vantara.anime.net.AnimeHostRouter.looksLikeSniReset(e)) throw e
            fragmenting.newCall(request).execute().also { fragmentedMediaHosts += host }
        }
    }.build()
}

/** Media hosts whose handshake needed the split ClientHello once: their later requests go straight that way. */
private val fragmentedMediaHosts: MutableSet<String> = java.util.concurrent.ConcurrentHashMap.newKeySet()
