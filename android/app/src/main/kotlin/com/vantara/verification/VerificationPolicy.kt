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
)

/** Thread-safe through Coordinator's monitor; no Activity or WebView ownership here. */
class VerificationLedger(private val capacity: Int = 8, private val ttlMs: Long = 10 * 60_000L) {
    private val entries = linkedMapOf<String, VerificationPending>()
    fun snapshot(): List<VerificationPending> = entries.values.toList()
    fun require(host: String, origin: String, url: String, userAgent: String, kind: String, sourceName: String, now: Long): VerificationPending? {
        entries[host]?.let { return it }
        if (entries.size >= capacity) return null
        return VerificationPending(host, origin, url, userAgent.take(1024), kind.take(40), sourceName.take(100), now).also { entries[host] = it }
    }
    fun begin(host: String, now: Long): VerificationPending? {
        val entry = entries[host] ?: return null
        if (entry.state != "required" || now - entry.createdAt >= ttlMs || entries.values.any { it.state == "active" }) return null
        return entry.copy(state = "active").also { entries[host] = it }
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
    fun expire(now: Long): List<VerificationPending> = entries.values
        .filter { now - it.createdAt >= ttlMs }
        .mapNotNull { retry(it.host, it.token, now) }
}
