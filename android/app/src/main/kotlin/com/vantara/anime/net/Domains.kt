package com.vantara.anime.net

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Response
import kotlinx.serialization.Serializable
import java.io.IOException
import java.util.concurrent.atomic.AtomicReference

/**
 * دومينات مصدر واحد: الحالي، والقديمة، والمرايا، وبصمة الصفحة الحقيقية.
 *
 * مواقع الأنمي العربية تغيّر دومينها كل أسابيع، والإضافة المنشورة تحمل دومينًا
 * ثابتًا في كودها. فالمحرك لا يثق بـ`baseUrl` الإضافة: يعيد كتابة كل طلب إلى
 * الدومين الحالي من البيان البعيد، ويتتبّع التحويلات بحذر.
 *
 * الحذر مهم: `witanime.cyou` صار يحوّل إلى `witanime.net` وهي صفحة Blogger
 * مزيّفة. تحويلٌ إلى دومين أجنبي (موقع مختلف في eTLD+1) لا يُقبل إلا إذا حملت
 * الصفحة **بصمة** المصدر (نص أو محدِّد يعرفه البيان).
 */
data class DomainPlan(
    /** الدومين الحالي كما في البيان، مثل `https://ww3.okanime.xyz`. */
    val current: String,
    /** مضيفات قديمة تُعاد كتابتها إلى الحالي (ومنها مضيف `baseUrl` في الإضافة). */
    val legacy: Set<String> = emptySet(),
    /** دومينات بديلة معروفة: تحويلٌ إليها مقبول بلا فحص. */
    val mirrors: Set<String> = emptySet(),
    /** Regex تبحث عنه في HTML الصفحة المحوَّل إليها قبل قبولها. */
    val fingerprint: String? = null,
    /** مسارات غيّرها الموقع وما زالت الإضافة تطلبها بشكلها القديم. */
    val rewrites: List<UrlRewrite> = emptyList(),
    /** حدود الطلبات لكل مسار (يطبّقها [RateGate] على كل طلبات المصدر). */
    val limits: List<RateLimit> = emptyList(),
) {
    val currentUrl: HttpUrl? get() = current.toHttpUrlOrNull()
    val currentHost: String? get() = currentUrl?.host

    /** كل المضيفات التي نعرفها لهذا المصدر. */
    fun knownHosts(): Set<String> =
        buildSet {
            currentHost?.let { add(it) }
            addAll(legacy.map(::bareHost))
            addAll(mirrors.mapNotNull { it.toHttpUrlOrNull()?.host ?: bareHost(it) })
        }
}

/**
 * مثال OkAnime: الإضافة تطلب `/search/?s=X&page=N`، والموقع صار `/search?q=X`
 * ويحوّل الشكل القديم إلى `http://…/search` بلا كلمة البحث.
 */
@Serializable
data class UrlRewrite(
    /** المسار المطابق حرفيًا، مثل `/search/`. */
    val path: String,
    /** المسار الجديد؛ غيابه يُبقي المسار. */
    val to: String? = null,
    /** إعادة تسمية معاملات الاستعلام: القديم ← الجديد، والبقية كما هي. */
    val params: Map<String, String> = emptyMap(),
)

/** `path`: Regex على مسار الطلب؛ `perMinute`: أقصى عدد في أي دقيقة. */
@Serializable
data class RateLimit(val path: String, val perMinute: Int)

/** `https://www.x.com/a` أو `www.x.com` ← `www.x.com`. */
internal fun bareHost(s: String): String = s.toHttpUrlOrNull()?.host ?: s.substringAfter("://").substringBefore('/').lowercase()

/**
 * «الموقع» = آخر جزأين من المضيف (`det.animerco.org` ← `animerco.org`)، أو
 * ثلاثة إن كان الجزء قبل الأخير لاحقة عامة لدولة (`x.com.sa`، `y.co.uk`).
 * يكفي لتمييز دوران النطاقات الفرعية داخل الموقع نفسه، ولا يحتاج قاعدة
 * لواحق كاملة.
 */
internal fun siteOf(host: String): String {
    val parts = host.lowercase().trimEnd('.').split('.')
    if (parts.size <= 2) return parts.joinToString(".")
    val sld = parts[parts.size - 2]
    val tld = parts.last()
    val take = if (tld.length == 2 && sld in setOf("co", "com", "net", "org", "gov", "edu", "ac")) 3 else 2
    return parts.takeLast(take).joinToString(".")
}

object DomainPolicy {

    /** هل الطلب موجّه لمضيف قديم يجب أن يُعاد إلى الحالي؟ */
    fun rewrite(url: HttpUrl, plan: DomainPlan, active: HttpUrl?): HttpUrl? {
        val target = active ?: plan.currentUrl ?: return null
        if (url.host == target.host) return null
        val legacy = plan.legacy.map(::bareHost)
        if (url.host !in legacy) return null
        return url.newBuilder().scheme(target.scheme).host(target.host).port(target.port).build()
    }

    /** يطبّق أول قاعدة [UrlRewrite] يطابق مسارها؛ null إن لم تطابق أي قاعدة. */
    fun fixPath(url: HttpUrl, plan: DomainPlan): HttpUrl? {
        val rule = plan.rewrites.firstOrNull { it.path == url.encodedPath } ?: return null
        val b = url.newBuilder()
        rule.to?.let { b.encodedPath(it) }
        if (rule.params.isNotEmpty()) {
            b.query(null)
            for (i in 0 until url.querySize) {
                val name = url.queryParameterName(i)
                b.addQueryParameter(rule.params[name] ?: name, url.queryParameterValue(i))
            }
        }
        return b.build().takeIf { it != url }
    }

    enum class Verdict { SAME, KNOWN, SAME_SITE, FINGERPRINT_OK, FOREIGN }

    /**
     * حكم على تحويل من [from] إلى [to]:
     *  - SAME/KNOWN/SAME_SITE: مقبول (نفس الموقع أو مرآة معروفة).
     *  - FINGERPRINT_OK: موقع مختلف لكن الصفحة تحمل البصمة.
     *  - FOREIGN: موقع مختلف بلا بصمة ← مرفوض (موقف أو تحويل إعلاني أو مزيّف).
     */
    fun judge(from: HttpUrl, to: HttpUrl, plan: DomainPlan, html: String?): Verdict {
        if (from.host == to.host) return Verdict.SAME
        if (to.host in plan.knownHosts()) return Verdict.KNOWN
        if (siteOf(from.host) == siteOf(to.host)) return Verdict.SAME_SITE
        val fp = plan.fingerprint
        if (fp != null && html != null && Regex(fp, RegexOption.IGNORE_CASE).containsMatchIn(html)) return Verdict.FINGERPRINT_OK
        return Verdict.FOREIGN
    }
}

class ForeignRedirectException(val from: String, val to: String) :
    IOException("المصدر حوّل إلى موقع غريب: $from → $to")

/**
 * اعتراض الدومين لعميل مصدر واحد:
 *  1. يعيد كتابة المضيف القديم إلى الدومين النشط.
 *  2. بعد اتباع OkHttp للتحويلات، يحكم على المضيف النهائي؛ إن كان موقعًا
 *     جديدًا مقبولًا صار هو النشط (ويُبلَّغ [onDomain] لتسجيله في الصحة)،
 *     وإن كان غريبًا رمى [ForeignRedirectException].
 */
class DomainInterceptor(
    private val plan: DomainPlan,
    private val onDomain: (String) -> Unit = {},
) : Interceptor {

    private val active = AtomicReference<HttpUrl?>(plan.currentUrl)

    fun activeBase(): String? = active.get()?.let { "${it.scheme}://${it.host}" }

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val rewritten = DomainPolicy.rewrite(original.url, plan, active.get())
        val hosted = rewritten ?: original.url
        val url = DomainPolicy.fixPath(hosted, plan) ?: hosted
        val request = if (url != original.url) {
            original.newBuilder().url(url).apply {
                if (rewritten != null) {
                    // Referer/Origin القديمان يكشفان الدومين الميت لبعض المواقع
                    original.header("Referer")?.let { ref -> header("Referer", swapHost(ref)) }
                    original.header("Origin")?.let { o -> header("Origin", swapHost(o)) }
                }
            }.build()
        } else {
            original
        }
        val response = chain.proceed(request)
        val finalUrl = response.request.url
        if (finalUrl.host == request.url.host) return response
        // سيرفرات الفيديو (dood → d000d…) تتحوّل كثيرًا ولا تخص دومين المصدر
        val siteHosts = plan.knownHosts() + listOfNotNull(active.get()?.host)
        if (request.url.host !in siteHosts) return response

        // الطلب تحوّل لمضيف آخر: هل هو المصدر نفسه في بيت جديد؟
        val isHtml = response.header("Content-Type")?.contains("html", true) == true
        val html = if (isHtml) runCatching { response.peekBody(96_000).string() }.getOrNull() else null
        return when (DomainPolicy.judge(request.url, finalUrl, plan, html)) {
            DomainPolicy.Verdict.FOREIGN -> {
                response.close()
                throw ForeignRedirectException(request.url.host, finalUrl.host)
            }
            DomainPolicy.Verdict.SAME -> response
            else -> {
                // المضيف الجديد صار النشط فقط إن كان الطلب لصفحة الموقع لا لسيرفر فيديو
                val base = active.get()
                if (base == null || request.url.host == base.host) {
                    active.set(finalUrl.newBuilder().encodedPath("/").query(null).fragment(null).build())
                    onDomain("${finalUrl.scheme}://${finalUrl.host}")
                }
                response
            }
        }
    }

    private fun swapHost(url: String): String {
        val parsed = url.toHttpUrlOrNull() ?: return url
        val target = active.get() ?: return url
        if (parsed.host !in plan.legacy.map(::bareHost)) return url
        return parsed.newBuilder().host(target.host).scheme(target.scheme).build().toString()
    }
}
