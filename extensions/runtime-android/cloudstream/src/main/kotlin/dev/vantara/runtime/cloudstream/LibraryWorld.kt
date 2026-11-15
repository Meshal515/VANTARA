package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLinkType
import dev.vantara.runtime.api.RuntimeHttpAccess
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.function.Consumer
import java.util.zip.ZipInputStream

/**
 * CloudStream's own library (cs3world) inside this isolated worker: its 324 extractors for the server pages no extractor
 * here handles. Providers are written against that library, and VANTARA's own interoperability layer ships seven.
 *
 * - A separate class-loader world: its parent is the boot class loader, so the library's Kotlin, coroutines and OkHttp
 *   never meet this worker's. Only java.* types cross (dev.vantara.runtime.cs3world.Bridge).
 * - Every request it makes goes through this generation's broker access (DNS, SNI, origin policy, verification), never
 *   a socket of its own.
 * - Loaded once per worker, verified against the SHA-256 shipped with it; any failure leaves the world off (the
 *   extraction reports the server missing, as before) and never stops the provider.
 */
internal object LibraryWorld {
    private const val ASSET = "cs3world/world.zip"
    private const val DIGEST = "cs3world/world.sha256"
    private const val BRIDGE = "dev.vantara.runtime.cs3world.Bridge"
    /** Each server page's ceiling inside the library (the operation's own budget is the collection's). */
    private const val SERVER_BUDGET_MS = 25_000L

    @Volatile private var access: RuntimeHttpAccess? = null
    private val lock = Any()
    @Volatile private var bridge: Class<*>? = null
    @Volatile private var unavailable = false

    /** This generation's broker; the world's transport reads it at each request. */
    fun attach(http: RuntimeHttpAccess) {
        access = http
        // Loading 17 MB of DEX takes a moment on a phone: start it now, off the provider's path.
        Thread({ runCatching { load() } }, "vantara-cs3world").apply { isDaemon = true }.start()
    }

    fun reset() { access = null }

    private fun load(): Class<*>? {
        bridge?.let { return it }
        if (unavailable) return null
        synchronized(lock) {
            bridge?.let { return it }
            if (unavailable) return null
            // No worker context yet (the provider is still initializing): not a failure, the next call loads it
            if (WorkerState.context == null) return null
            return try {
                open()?.also { bridge = it } ?: run { unavailable = true; null }
            } catch (failure: Throwable) {
                unavailable = true
                android.util.Log.w("VantaraCs3World", "WORLD_UNAVAILABLE:" + failure.javaClass.simpleName)
                null
            }
        }
    }

    private fun open(): Class<*>? {
        // InMemoryDexClassLoader with several DEX buffers: API 27+
        if (android.os.Build.VERSION.SDK_INT < 27) return null
        val context = WorkerState.context ?: return null
        val zip = context.assets.open(ASSET).use { it.readBytes() }
        val expected = context.assets.open(DIGEST).use { String(it.readBytes()).trim() }
        val actual = MessageDigest.getInstance("SHA-256").digest(zip).joinToString("") { "%02x".format(it) }
        check(actual == expected) { "CS3WORLD_INTEGRITY" }
        val dex = mutableListOf<ByteBuffer>()
        val resources = HashMap<String, ByteArray>()
        ZipInputStream(zip.inputStream()).use { z ->
            while (true) {
                val entry = z.nextEntry ?: break
                when {
                    Regex("classes\\d*\\.dex").matches(entry.name) -> dex += ByteBuffer.wrap(z.readBytes())
                    entry.name.startsWith("res/") && !entry.isDirectory -> resources[entry.name.removePrefix("res/")] = z.readBytes()
                }
            }
        }
        check(dex.isNotEmpty()) { "CS3WORLD_EMPTY" }
        // The boot class loader (java.* and the framework only, nothing of this worker's own libraries), under a loader
        // that serves the world's jar resources: an in-memory DEX has none, and ServiceLoader (cryptography providers,
        // Jackson modules) and kotlin-reflect's built-ins read them. Without them the extractor list failed to initialise.
        val loader = dalvik.system.InMemoryDexClassLoader(dex.toTypedArray(), WorldResources(String::class.java.classLoader, resources))
        val previous = Thread.currentThread().contextClassLoader
        Thread.currentThread().contextClassLoader = loader
        val type = try { Class.forName(BRIDGE, true, loader) } finally { Thread.currentThread().contextClassLoader = previous }
        type.getMethod("install", java.util.function.Function::class.java).invoke(null, transport)
        android.util.Log.i("VantaraCs3World", "WORLD_READY dex=${dex.size}")
        return type
    }

    private val transport = java.util.function.Function<Map<String, Any?>, Map<String, Any?>> { request ->
        val http = access ?: throw IllegalStateException("TRANSPORT_UNAVAILABLE")
        @Suppress("UNCHECKED_CAST")
        val headers = (request["headers"] as? Map<String, List<String>>).orEmpty()
        val answer = try {
            http.exchange(RuntimeHttpAccess.Request(request["url"] as String, request["method"] as String, headers,
                request["body"] as ByteArray?, request["followRedirects"] as? Boolean ?: true))
        } catch (failure: Exception) {
            // The broker's refusal code (ORIGIN_NOT_ALLOWED, VERIFICATION_REQUIRED, …), never a body or URL
            throw IllegalStateException(failure.message?.takeIf { it.matches(Regex("[A-Z_]{3,64}")) } ?: "TRANSPORT_FAILED")
        }
        mapOf("url" to answer.url(), "status" to answer.status(), "headers" to answer.headers(), "body" to answer.body())
    }

    /**
     * CloudStream's own extractor for [url]. Each link reaches [callback] the moment the library produces it.
     * true when the library gave at least one playable link.
     */
    suspend fun extract(url: String, referer: String?, subtitleCallback: (SubtitleFile) -> Unit, callback: (ExtractorLink) -> Unit): Boolean {
        val type = load() ?: run { note("WORLD_OFF host=${host(url)} unavailable=$unavailable"); return false }
        val method = type.getMethod("extract", String::class.java, String::class.java, Long::class.javaPrimitiveType,
            Consumer::class.java, Consumer::class.java)
        var delivered = 0
        val onLink = Consumer<Map<String, Any?>> { raw -> link(raw)?.let { synchronized(this) { delivered++ }; callback(it) } }
        val onSubtitle = Consumer<Map<String, Any?>> { raw ->
            val lang = raw["lang"] as? String ?: return@Consumer
            val file = raw["url"] as? String ?: return@Consumer
            if (file.startsWith("https://") || file.startsWith("http://")) subtitleCallback(SubtitleFile(lang, file))
        }
        return try {
            kotlinx.coroutines.runInterruptible(kotlinx.coroutines.Dispatchers.IO) {
                method.invoke(null, url, referer, SERVER_BUDGET_MS, onLink, onSubtitle)
            }
            val got = synchronized(this) { delivered }
            note("EXTRACT host=${host(url)} links=$got")
            got > 0
        } catch (cancel: kotlinx.coroutines.CancellationException) { throw cancel }
        catch (failure: Throwable) {
            val cause = (failure as? java.lang.reflect.InvocationTargetException)?.targetException ?: failure
            // Type and the first line only: never a URL, page body or credential
            note("EXTRACT_FAILED host=${host(url)} ${cause.javaClass.name}: ${cause.message?.lineSequence()?.firstOrNull()?.take(160)?.replace(Regex("https?://\\S+"), "<url>")}")
            synchronized(this) { delivered > 0 }
        }
    }

    private fun host(url: String) = runCatching { java.net.URI(url).host }.getOrNull() ?: "?"
    private fun note(line: String) { runCatching { android.util.Log.i("VantaraCs3World", line) } }

    /** The library's link as this worker's: http(s) only, no credentials; torrents and magnets are not extractor media here. */
    private fun link(raw: Map<String, Any?>): ExtractorLink? {
        val url = raw["url"] as? String ?: return null
        val parsed = runCatching { java.net.URI(url) }.getOrNull() ?: return null
        if (!(parsed.scheme.equals("https", true) || parsed.scheme.equals("http", true)) || parsed.rawUserInfo != null || parsed.host == null) return null
        val type = when (raw["type"] as? String) {
            "M3U8" -> ExtractorLinkType.M3U8
            "DASH" -> ExtractorLinkType.DASH
            "VIDEO" -> ExtractorLinkType.VIDEO
            "MAGNET", "TORRENT" -> return null
            else -> ExtractorLinkType.INFERRED
        }
        val name = (raw["name"] as? String).orEmpty().take(200)
        return ExtractorLink((raw["source"] as? String).orEmpty().take(200).ifBlank { name }, name, url, type).apply {
            referer = (raw["referer"] as? String).orEmpty()
            quality = (raw["quality"] as? Int) ?: quality
            @Suppress("UNCHECKED_CAST")
            headers = (raw["headers"] as? Map<String, String>).orEmpty().entries.take(32).associate { it.key to it.value }
        }
    }
}

/** Read-only jar resources of the library world, at the paths the libraries ask for. No file is written anywhere. */
private class WorldResources(parent: ClassLoader?, private val files: Map<String, ByteArray>) : ClassLoader(parent) {
    private val handler = object : java.net.URLStreamHandler() {
        override fun openConnection(u: java.net.URL): java.net.URLConnection = object : java.net.URLConnection(u) {
            override fun connect() {}
            override fun getInputStream(): java.io.InputStream =
                java.io.ByteArrayInputStream(files[u.path.removePrefix("/")] ?: throw java.io.FileNotFoundException(u.path))
        }
    }
    private fun url(name: String): java.net.URL? =
        files[name]?.let { java.net.URL("cs3world", "", -1, "/$name", handler) }
    override fun findResource(name: String): java.net.URL? = url(name)
    override fun findResources(name: String): java.util.Enumeration<java.net.URL> =
        java.util.Collections.enumeration(listOfNotNull(url(name)))
}
