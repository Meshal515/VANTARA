package com.vantara.verification

import okhttp3.HttpUrl.Companion.toHttpUrl
import java.net.InetAddress
import java.net.URI
import java.util.UUID

/** No account URLs, alternate ports, local names or IP literals enter the browser. */
object VerificationPolicy {
    data class Endpoint(val host: String, val origin: String)
    fun endpoint(raw: String): Endpoint? = runCatching {
        if (raw.length > 8192 || raw.any { it.code < 32 }) return null
        val uri = URI(raw)
        if (!uri.scheme.equals("https", true) || uri.rawUserInfo != null || uri.port !in listOf(-1, 443)) return null
        val host = uri.host?.lowercase()?.takeIf { it.length <= 253 } ?: return null
        if (!host.matches(Regex("[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?")) || !host.contains('.')) return null
        if (host.split('.').any { it.isEmpty() || it.startsWith('-') || it.endsWith('-') || it.length > 63 }) return null
        if (host.split('.').last().all(Char::isDigit)) return null
        if (listOf("localhost", "local", "internal", "lan", "home", "test", "invalid", "onion").any { host == it || host.endsWith(".$it") }) return null
        Endpoint(host, "https://$host")
    }.getOrNull()

    /**
     * Same registrable domain (public-suffix aware): a challenge page may hop between a site's own subdomains
     * (www → ww3) or apex and www. Another site is never the same site, and an unknown suffix is never shared.
     */
    fun sameSite(a: Endpoint, b: Endpoint): Boolean {
        if (a.host == b.host) return true
        val left = registrable(a.host) ?: return false
        return left == registrable(b.host)
    }
    /** The public-suffix list when OkHttp has it (on the device), else [registrableFallback]. */
    private fun registrable(host: String): String? =
        runCatching { "https://$host/".toHttpUrl().topPrivateDomain() }.getOrNull() ?: registrableFallback(host)
    /**
     * Conservative without the list: the last two labels, or three under a two-letter country code whose second
     * level is a generic public one (example.co.uk). A bare public suffix is never a site.
     */
    internal fun registrableFallback(host: String): String? {
        val labels = host.lowercase().split('.')
        if (labels.size < 2) return null
        val tld = labels.last()
        val second = labels[labels.size - 2]
        val keep = if (tld.length == 2 && second in GENERIC_SECOND_LEVEL) 3 else 2
        return if (labels.size < keep) null else labels.takeLast(keep).joinToString(".")
    }
    private val GENERIC_SECOND_LEVEL = setOf("co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go", "gob", "mil", "nic", "sch")

    /** Called from a worker only, before navigating or serving a browser request. */
    fun publicDns(host: String): Boolean = runCatching {
        InetAddress.getAllByName(host).let { addresses -> addresses.isNotEmpty() && addresses.all(::publicAddress) }
    }.getOrDefault(false)

    fun publicAddress(address: InetAddress): Boolean {
        if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress || address.isSiteLocalAddress || address.isMulticastAddress) return false
        val bytes = address.address.map { it.toInt() and 255 }
        if (bytes.size == 16) {
            // Globally routed IPv6 only; excludes unique-local and NAT64 private mappings.
            return (bytes[0] and 0xe0) == 0x20 && !(bytes[0] == 0x20 && bytes[1] == 1 && bytes[2] == 0x0d && bytes[3] == 0xb8)
        }
        val a = bytes[0]; val b = bytes[1]; val c = bytes[2]
        return a !in listOf(0, 10, 127) && a < 224 &&
            !(a == 100 && b in 64..127) && !(a == 169 && b == 254) &&
            !(a == 172 && b in 16..31) && !(a == 192 && b == 168) &&
            !(a == 192 && b == 0 && c in listOf(0, 2)) &&
            !(a == 198 && b in 18..19) && !(a == 198 && b == 51 && c == 100) &&
            !(a == 203 && b == 0 && c == 113)
    }

    /**
     * كل كوكيز الموقع من متصفح التحقق المعزول (ترويسة CookieManager: «a=1; b=2»)، لا cf_clearance وحده.
     * كان التطبيق يأخذ cf_clearance فقط فيضيع ما يحتاجه الموقع مع الكوكي، ويرجع يطلب التحقق (بلاغ المالك 22 نوفمبر).
     * أسماء وقيم محصورة (لا حقن ترويسات)، وأربعون كوكي على الأكثر، و8KB للقيمة.
     */
    fun cookiePairs(header: String?): List<Pair<String, String>> {
        if (header == null || header.length > 65536 || header.any { it == '\r' || it == '\n' }) return emptyList()
        val name = Regex("^[A-Za-z0-9_.!#$%&'*+^`|~-]{1,128}$")
        return header.split(';').asSequence().map(String::trim).filter { '=' in it }.mapNotNull { part ->
            val n = part.substringBefore('=').trim(); val v = part.substringAfter('=').trim()
            if (!name.matches(n) || v.length > 8192 || v.any { it == ';' || it == ',' || it.code < 0x20 || it.code > 0x7e || it == ' ' }) null else n to v
        }.distinctBy { it.first }.take(40).toList()
    }

    /** كتابة واحدة في مخزن المحرك: رابط تُنسب إليه وترويسة Set-Cookie كما يقبلها CookieManager.setCookie. */
    data class CookieWrite(val url: String, val header: String, val remove: Boolean = false)

    /** عمر الجلسة المنقولة: CookieManager لا يكشف انتهاءها الأصلي. الموقع يرفضها حين تنتهي عنده، فتُستبدل بتحقق جديد. */
    const val IMPORT_MAX_AGE_S = 7L * 24 * 3600

    /**
     * نقل جلسة صفحة التحقق (عملية :verification ومخزنها المعزول) إلى مخزن المحرك، بديلًا عن المخزن الواحد في Mihon
     * (WebViewScreenContent وAndroidCookieJar على CookieManager نفسه، وCloudflareInterceptor يحذف cf_clearance القديم قبل
     * الحل). كان الاستيراد كوكي «للمضيف وحده» على المضيف الذي انتهت إليه الصفحة، والقديم لا يُحذف: كوكيان بالاسم نفسه
     * يُرسلان معًا (الأقدم أولًا فيُرفض)، ومضيف الطلب (www أو دونها) قد لا يحمله أصلًا.
     *
     * الآن: يُحذف cf_clearance القديم بكل نطاقاته (المضيفان وجذر الموقع)، ثم يُكتب الجديد على جذر الموقع كما يكتبه
     * Cloudflare (Domain=.site)، وبقية الكوكيز للمضيفين كليهما. [registrable] جذر الموقع (topPrivateDomain) أو null.
     */
    fun sessionImport(requestHost: String, landedHost: String, clearance: String?, pairs: List<Pair<String, String>>, registrable: String?): List<CookieWrite> {
        val hosts = listOf(requestHost, landedHost).distinct()
        val out = mutableListOf<CookieWrite>()
        val attrs = "; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=$IMPORT_MAX_AGE_S"
        if (clearance != null) {
            for (h in hosts) out += CookieWrite("https://$h/", "cf_clearance=; Path=/; Max-Age=0", remove = true)
            if (registrable != null) out += CookieWrite("https://$requestHost/", "cf_clearance=; Domain=.$registrable; Path=/; Max-Age=0", remove = true)
            if (registrable != null) out += CookieWrite("https://$requestHost/", "cf_clearance=$clearance; Domain=.$registrable$attrs")
            else for (h in hosts) out += CookieWrite("https://$h/", "cf_clearance=$clearance$attrs")
        }
        for ((name, value) in pairs.filter { it.first != "cf_clearance" }) for (h in hosts) out += CookieWrite("https://$h/", "$name=$value$attrs")
        return out
    }

    /** جذر الموقع من قائمة اللواحق العامة (OkHttp) أو التقدير المحافظ. */
    fun registrableOf(host: String): String? = registrable(host)

    /** CookieManager returns a request header: import precisely one bounded token. */
    fun clearance(header: String?): String? {
        if (header == null || header.length > 65536 || header.any { it == '\r' || it == '\n' }) return null
        val values = header.split(';').map(String::trim).filter { it.substringBefore('=') == "cf_clearance" }
        if (values.size != 1) return null
        return values.single().substringAfter('=', "").takeIf { value ->
            value.length in 1..8192 && value.all { it.isLetterOrDigit() && it.code < 128 || it in "-_.~+$%/=:" }
        }
    }
}

data class VerificationPending(
    val host: String, val origin: String, val url: String, val userAgent: String,
    val kind: String, val sourceName: String, val createdAt: Long,
    val token: String = UUID.randomUUID().toString(), val state: String = "required",
    val sourceId: String? = null,
    val firstSeenAt: Long = createdAt,
)

/** Thread-safe through Coordinator's monitor; no Activity or WebView ownership here. */
class VerificationLedger(private val capacity: Int = 8, private val ttlMs: Long = 10 * 60_000L) {
    private val entries = linkedMapOf<String, VerificationPending>()
    fun snapshot(): List<VerificationPending> = entries.values.toList()
    fun require(host: String, origin: String, url: String, userAgent: String, kind: String, sourceName: String, now: Long, sourceId: String? = null): VerificationPending? {
        entries[host]?.let { return it }
        if (entries.size >= capacity) return null
        return VerificationPending(host, origin, url, userAgent.take(1024), kind.take(40), sourceName.take(100), now, sourceId = sourceId).also { entries[host] = it }
    }
    fun annotate(host: String, sourceId: String, sourceName: String): VerificationPending? {
        val entry = entries[host]?.takeIf { it.state == "required" && it.sourceId == null } ?: return null
        return entry.copy(sourceId = sourceId, sourceName = sourceName.take(100)).also { entries[host] = it }
    }
    fun discardSource(sourceId: String): List<VerificationPending> =
        entries.values.filter { it.sourceId == sourceId }.onEach { entries.remove(it.host) }

    fun discardStale(now: Long): List<VerificationPending> =
        entries.values.filter { it.state == "required" && now - it.firstSeenAt >= 3 * ttlMs }
            .onEach { entries.remove(it.host) }

    fun begin(host: String, now: Long): VerificationPending? {
        val entry = entries[host] ?: return null
        if (entry.state != "required" || now - entry.createdAt >= ttlMs || entries.values.any { it.state == "active" }) return null
        // The user's own attempt starts its own clock: a request recorded minutes ago must not expire mid-check
        return entry.copy(state = "active", createdAt = now).also { entries[host] = it }
    }
    fun finish(host: String, token: String): VerificationPending? {
        val entry = entries[host]?.takeIf { it.token == token } ?: return null
        entries.remove(host)
        return entry
    }
    fun retry(host: String, token: String, now: Long): VerificationPending? {
        val entry = entries[host]?.takeIf { it.token == token } ?: return null
        return entry.copy(createdAt = now, token = UUID.randomUUID().toString(), state = "required")
            .also { entries[host] = it }
    }
    /**
     * Old requests are re-armed with a new token, still waiting for the user. An active check counts from when the user
     * started it ([begin]), so it is re-armed only if stuck (the page died without answering), never mid-check: counting
     * from the original request rejected a challenge the user had just passed.
     */
    fun expire(now: Long): List<VerificationPending> = entries.values
        .filter { now - it.createdAt >= ttlMs }
        .mapNotNull { retry(it.host, it.token, now) }
}
