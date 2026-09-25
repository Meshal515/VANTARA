package com.vantara.anime.net

import com.vantara.anime.health.HealthStore
import eu.kanade.tachiyomi.network.interceptor.CloudflareBypassException
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

/**
 * موجّه مضيفات الأنمي — أول اعتراض في عميل الشبكة المشترك.
 *
 * لماذا في الجذر لا في عميل كل مصدر؟ لأن الإضافة حرّة: قد تبني عميلها بـ
 * `network.client.newBuilder()…` في مُهيّئ خاصيتها، فيفوتها أي اعتراض نضيفه
 * لاحقًا. والعميل المشتق يرث اعتراضات الجذر دائمًا.
 *
 * لا يعرف إلا المضيفات المسجّلة لمصادر الأنمي؛ طلبات المانجا تمر بلا لمس.
 * لكل طلب إلى موقع مصدر:
 *   1. [DomainInterceptor] يعيد كتابة الدومين ويحكم على التحويلات.
 *   2. يُقاس الزمن والنتيجة في [HealthStore] باسم المصدر، مع الدومين النشط.
 *   3. تحدّي Cloudflare الذي يحتاج إنسانًا لا يُعرض أبدًا: يُسجَّل المصدر
 *      «محجوبًا» ويُترك للتبديل إلى مصدر آخر.
 */
object AnimeHostRouter : Interceptor {

    private class Route(val sourceId: String, val domains: DomainInterceptor)

    private val routes = ConcurrentHashMap<String, Route>()
    private val byId = ConcurrentHashMap<String, Route>()
    private val hiddenOnly: MutableSet<String> = ConcurrentHashMap.newKeySet()

    @Volatile var health: HealthStore? = null

    /** عميل مطابق للجذر إلا مصنع مقبسه (تجزئة SNI)؛ يُهيَّأ من [com.vantara.anime.AnimeEngine]. */
    @Volatile var fragmentClient: OkHttpClient? = null

    /** يمنع تكرار محاولة التجزئة داخل محاولة التجزئة نفسها. */
    private object FragmentRetryTag

    /** مضيفات نجحت بالتجزئة: طلباتها التالية تذهب إليها مباشرة بلا مصافحة فاشلة أولًا. */
    private val fragmentHosts: MutableSet<String> = ConcurrentHashMap.newKeySet()

    private fun viaFragment(fc: OkHttpClient, request: okhttp3.Request): Response =
        fc.newCall(request.newBuilder().tag(FragmentRetryTag::class.java, FragmentRetryTag).build()).execute()

    /** بوابة حدود الطلبات لكل مصدر؛ تبقى نوافذها ما دامت قواعدها لم تتغيّر. */
    private val gates = ConcurrentHashMap<String, RateGate>()

    /** يسجّل مصدرًا: كل مضيفاته (الحالي، القديمة، المرايا) تمر من هنا. */
    fun register(sourceId: String, plan: DomainPlan) {
        lateinit var route: Route
        route = Route(
            sourceId,
            DomainInterceptor(plan) { domain ->
                // الدومين الجديد المقبول يرث الحماية والقياس فورًا
                val host = bareHost(domain)
                routes[host] = route
                hiddenOnly += host
                health?.ok(HealthStore.sourceKey(sourceId), 0, domain)
            },
        )
        val hosts = plan.knownHosts()
        byId.put(sourceId, route)?.let { old ->
            val stale = routes.filterValues { it === old }.keys - hosts
            routes.entries.removeIf { it.value === old }
            // مضيف لم يعد للمصدر لا يرث سلوكه القديم (إخفاء التحدي، التجزئة)
            hiddenOnly -= stale
            fragmentHosts -= stale
        }
        for (host in hosts) {
            routes[host] = route
            hiddenOnly += host
        }
        val rules = plan.limits.mapNotNull { l -> runCatching { RateGate.Rule(Regex(l.path), l.perMinute) }.getOrNull() }
        gates.compute(sourceId) { _, old -> if (old != null && old.rules == rules) old else RateGate(rules) }
    }

    /** الدومين النشط الآن لمصدر (بعد أي تحويل مقبول). */
    fun activeBase(sourceId: String): String? = byId[sourceId]?.domains?.activeBase()

    /** سبب مقروء: نوع الخطأ الأعمق ورسالته (UnknownHost = حجب DNS غالبًا). */
    fun describe(t: Throwable): String {
        // OkHttp يرمي فشل أول عنوان ويعلّق الباقي كـsuppressed (IPv6 ثم IPv4…)
        val all = listOf(t) + t.suppressed
        return all.map(::one).distinct().joinToString(" | ")
    }

    private fun one(t: Throwable): String {
        val root = generateSequence(t) { it.cause }.last()
        val kind = when (root) {
            is java.net.UnknownHostException -> "الدومين لا يُحلّ (حجب DNS؟)"
            is java.net.SocketTimeoutException -> "انتهت مهلة الاتصال"
            is java.net.ConnectException -> "رُفض الاتصال"
            is javax.net.ssl.SSLException -> "خطأ شهادة/اتصال آمن"
            else -> root.javaClass.simpleName
        }
        return listOfNotNull(kind, root.message?.take(120)).joinToString(": ")
    }

    /** Cloudflare يسأل: هل يُمنع إظهار التحدي لهذا المضيف؟ */
    fun isHiddenOnly(host: String): Boolean = host in hiddenOnly

    /**
     * نمط حجب SNI الشائع: TCP يتصل، ومصافحة TLS تنقطع فورًا بإعادة تصفير —
     * لا مهلة ولا رفض عادي. مصافحة فاشلة لأي سبب آخر (شهادة، مهلة) لا تُطابق.
     */
    internal fun looksLikeSniReset(e: IOException): Boolean =
        (listOf(e) + e.suppressed).any { t ->
            val chain = generateSequence(t) { it.cause }.toList()
            // شهادة غير موثوقة أو اسم لا يطابق: مشكلة TLS حقيقية، لا حجب
            if (chain.any { c -> c is java.security.cert.CertificateException || c is javax.net.ssl.SSLPeerUnverifiedException }) return@any false
            chain.any { c ->
                (c is java.net.SocketException || c is javax.net.ssl.SSLException || c is java.io.EOFException) &&
                    RESET.containsMatchIn(c.message.orEmpty())
            }
        }

    private val RESET = Regex("reset|connection (closed|abort)|unexpected end of stream|handshake (aborted|terminated)|EOF", RegexOption.IGNORE_CASE)

    /** أقصى انتظار داخل الطلب لدور المصدر أو لـ`Retry-After`؛ أطول منه يُرمى بسببه. */
    private const val MAX_WAIT_MS = 20_000L

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val route = routes[request.url.host] ?: return chain.proceed(request)
        val retried = request.tag(FragmentRetryTag::class.java) != null
        val fc = fragmentClient
        if (fc != null && !retried && request.url.host in fragmentHosts) return viaFragment(fc, request)
        val key = HealthStore.sourceKey(route.sourceId)
        val gate = gates[route.sourceId]
        val path = request.url.encodedPath
        val canceled = { chain.call().isCanceled() }
        gate?.acquire(path, MAX_WAIT_MS, canceled)
        val started = System.nanoTime()
        try {
            var response = route.domains.intercept(chain)
            if (response.code == 429 && gate != null) {
                // المصدر كله يُغلق حتى Retry-After، فلا يكرّر طالبٌ آخر الخطأ نفسه
                val after = RateGate.parseRetryAfter(response.header("Retry-After"))
                gate.onRateLimited(after)
                health?.fail(key, "حد الطلبات (429) على $path — بعد ${after / 1000} ثانية")
                if (after <= MAX_WAIT_MS && !canceled()) {
                    response.close()
                    gate.acquire(path, MAX_WAIT_MS, canceled)
                    response = route.domains.intercept(chain)
                }
                if (response.code == 429) {
                    gate.onRateLimited(RateGate.parseRetryAfter(response.header("Retry-After")))
                    response.close()
                    throw RateLimitedException(path, gate.cooldownLeft().coerceAtLeast(after))
                }
            }
            val ms = (System.nanoTime() - started) / 1_000_000
            when {
                response.isSuccessful -> health?.ok(key, ms, route.domains.activeBase())
                response.code == 404 -> Unit // صفحة غير موجودة ليست عطل مصدر
                else -> health?.fail(key, "HTTP ${response.code} على $path")
            }
            return response
        } catch (e: RateLimitedException) {
            throw e
        } catch (e: ForeignRedirectException) {
            health?.fail(key, e.message ?: "foreign redirect", blocked = "foreign_redirect:${e.to}")
            throw e
        } catch (e: CloudflareBypassException) {
            health?.fail(key, e.message ?: "cloudflare", blocked = if (e.interactive) "cloudflare_interactive" else null)
            throw e
        } catch (e: IOException) {
            // إلغاؤنا نحن (مهلة البحث، مغادرة الصفحة) ليس عطل المصدر: لا يُسجَّل.
            // المهلة تُسجَّل في المحرك بسببها الحقيقي («لم يرد خلال …»)
            if (chain.call().isCanceled()) throw e

            if (fc != null && looksLikeSniReset(e) && !retried) {
                // إعادة عبر عميل يجزّئ ClientHello؛ الوسم يمنع تكرارها داخل نفسها.
                // المحاولة المُعادة تمر بهذا الاعتراض نفسه فتُسجّل صحتها بنفسها
                // (نجاحًا أو فشلًا)، فلا تُسجَّل هنا مرتين.
                val again = runCatching { viaFragment(fc, request) }
                again.getOrNull()?.let {
                    fragmentHosts += request.url.host
                    return it
                }
                throw again.exceptionOrNull() as? IOException ?: e
            }

            health?.fail(key, describe(e))
            throw e
        }
    }
}
