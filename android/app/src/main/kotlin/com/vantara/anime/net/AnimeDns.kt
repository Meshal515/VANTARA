package com.vantara.anime.net

import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.dnsoverhttps.DnsOverHttps
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * محلّل أسماء لمواقع الأنمي.
 *
 * مزوّدو الإنترنت يحجبون كثيرًا من مواقع الأنمي العربية بالـDNS: الاسم لا
 * يُحلّ، أو يُحلّ إلى عنوان صفحة حجب/0.0.0.0. فـ:
 *  - مضيفات المصادر المسجّلة ([isSourceHost]): DNS عبر HTTPS أولًا
 *    (Cloudflare ثم Google)، ثم النظام.
 *  - غيرها (سيرفرات الفيديو، المانجا، كل شيء): النظام أولًا كما هو، و DoH
 *    فقط إن فشل النظام أو أعاد عنوانًا وهميًا.
 *
 * وعناوين IPv6 من DoH لا تُعاد إلا إن كان للجوال مسار IPv6 فعلي: جوال بلا IPv6
 * يفشل عليها فورًا بـENETUNREACH (رأيناه على جوال حقيقي)، وOkHttp يبدأ بها.
 *
 * عميل DoH مستقل تمامًا (عناوين 1.1.1.1/8.8.8.8 ثابتة، بلا [eu.kanade.tachiyomi.network.HostRouting])
 * حتى لا يستدعي نفسه.
 */
class AnimeDns(
    private val isSourceHost: (String) -> Boolean,
    private val system: Dns = Dns.SYSTEM,
    private val hasIpv6: () -> Boolean = ::deviceHasIpv6,
) : Dns {

    private val bootstrap: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(6, TimeUnit.SECONDS)
            .readTimeout(6, TimeUnit.SECONDS)
            .callTimeout(10, TimeUnit.SECONDS)
            .build()
    }

    private val resolvers: List<Pair<String, Dns>> by lazy {
        listOf(
            "Cloudflare" to doh("https://cloudflare-dns.com/dns-query", "1.1.1.1", "1.0.0.1"),
            "Google" to doh("https://dns.google/dns-query", "8.8.8.8", "8.8.4.4"),
        )
    }

    private fun doh(url: String, vararg ips: String): Dns =
        DnsOverHttps.Builder()
            .client(bootstrap)
            .url(url.toHttpUrl())
            // عناوين حرفية: لا بحث DNS لحل خادم الـDNS نفسه
            .bootstrapDnsHosts(ips.map { InetAddress.getByName(it) })
            .build()

    private class Cached(val addresses: List<InetAddress>, val until: Long)

    private val cache = ConcurrentHashMap<String, Cached>()

    override fun lookup(hostname: String): List<InetAddress> {
        cache[hostname]?.takeIf { it.until > System.currentTimeMillis() }?.let { return it.addresses }
        return if (isSourceHost(hostname)) {
            runCatching { viaDoh(hostname) }.getOrNull()?.also { remember(hostname, it) }
                ?: system.lookup(hostname)
        } else {
            val plain = runCatching { system.lookup(hostname) }
            val good = plain.getOrNull()?.takeUnless { isSinkhole(it) }
            good ?: runCatching { viaDoh(hostname) }.getOrNull()?.also { remember(hostname, it) }
                ?: plain.getOrThrow()
        }
    }

    /** للتشخيص: ما يعيده النظام وما يعيده DoH لنفس الاسم، كلٌّ على حدة. */
    fun compare(hostname: String): Pair<Result<List<InetAddress>>, Result<List<InetAddress>>> =
        runCatching { system.lookup(hostname) } to runCatching { viaDoh(hostname) }

    private fun viaDoh(hostname: String): List<InetAddress> {
        var last: Throwable? = null
        for ((_, resolver) in resolvers) {
            try {
                val found = usable(resolver.lookup(hostname))
                if (found.isNotEmpty() && !isSinkhole(found)) return found
            } catch (e: Throwable) {
                last = e
            }
        }
        throw UnknownHostException("DoH: $hostname (${last?.message ?: "بلا نتيجة"})")
    }

    /** IPv4 أولًا، وIPv6 فقط إن كان له مسار. */
    internal fun usable(addresses: List<InetAddress>): List<InetAddress> {
        val v4 = addresses.filterIsInstance<Inet4Address>()
        val v6 = addresses.filterIsInstance<Inet6Address>()
        return if (hasIpv6()) v4 + v6 else v4.ifEmpty { v6 }
    }

    private fun remember(host: String, addresses: List<InetAddress>) {
        cache[host] = Cached(addresses, System.currentTimeMillis() + TTL_MS)
    }

    companion object {
        private const val TTL_MS = 10 * 60_000L

        /** هل للجوال عنوان IPv6 عام على واجهة شغّالة؟ (بدونه IPv6 = ENETUNREACH) */
        fun deviceHasIpv6(): Boolean = runCatching {
            NetworkInterface.getNetworkInterfaces()?.toList().orEmpty().any { nif ->
                nif.isUp && !nif.isLoopback && nif.inetAddresses.toList().any {
                    it is Inet6Address && !it.isLinkLocalAddress && !it.isLoopbackAddress && !it.isSiteLocalAddress &&
                        // ULA (fc00::/7) ليست عامة
                        (it.address[0].toInt() and 0xFE) != 0xFC
                }
            }
        }.getOrDefault(false)

        /** عنوان لا يمكن أن يكون موقعًا عامًا: إجابة حجب. */
        fun isSinkhole(addresses: List<InetAddress>): Boolean =
            addresses.isNotEmpty() && addresses.all {
                it.isAnyLocalAddress || it.isLoopbackAddress || it.isSiteLocalAddress || it.isLinkLocalAddress
            }
    }
}
