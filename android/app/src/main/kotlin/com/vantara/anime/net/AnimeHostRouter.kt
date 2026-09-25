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
        byId.put(sourceId, route)?.let { old -> routes.entries.removeIf { it.value === old } }
        for (host in plan.knownHosts()) {
            routes[host] = route
            hiddenOnly += host
        }
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
            when (val root = generateSequence(t) { it.cause }.last()) {
                is javax.net.ssl.SSLException -> true
                is java.net.SocketException -> root.message?.contains("reset", ignoreCase = true) == true
                else -> false
            }
        }

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val route = routes[request.url.host] ?: return chain.proceed(request)
        val key = HealthStore.sourceKey(route.sourceId)
        val started = System.nanoTime()
        try {
            val response = route.domains.intercept(chain)
            val ms = (System.nanoTime() - started) / 1_000_000
            when {
                response.isSuccessful -> health?.ok(key, ms, route.domains.activeBase())
                response.code == 404 -> Unit // صفحة غير موجودة ليست عطل مصدر
                else -> health?.fail(key, "HTTP ${response.code}")
            }
            return response
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

            val fc = fragmentClient
            if (fc != null && looksLikeSniReset(e) && request.tag(FragmentRetryTag::class.java) == null) {
                // إعادة عبر عميل يجزّئ ClientHello؛ الوسم يمنع تكرارها داخل نفسها.
                // المحاولة المُعادة تمر بهذا الاعتراض نفسه فتُسجّل صحتها بنفسها
                // (نجاحًا أو فشلًا)، فلا تُسجَّل هنا مرتين.
                val tagged = request.newBuilder().tag(FragmentRetryTag::class.java, FragmentRetryTag).build()
                val retried = runCatching { fc.newCall(tagged).execute() }
                retried.getOrNull()?.let { return it }
                throw retried.exceptionOrNull() as? IOException ?: e
            }

            health?.fail(key, describe(e))
            throw e
        }
    }
}
