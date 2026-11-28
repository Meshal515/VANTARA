package com.vantara.verification

import eu.kanade.tachiyomi.network.interceptor.BrowserVerificationInterceptor
import eu.kanade.tachiyomi.network.interceptor.CloudflareInterceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * التحقق لا يُعلن ناجحًا حتى يقبل الموقع الطلب الأصلي فعلًا (قرار المالك). صفحة التحقق قد تُغلق والكوكي صحيح ولا
 * يقبله الموقع من المحرك (بصمة، عنوان شبكة آخر، كوكي ناقص)، فكان التطبيق يقول «تم» ثم يعود «يحتاج تحققًا».
 *
 * الفحص طلب GET واحد للرابط الذي رُفض، من عميل المحرك نفسه (مخزن الكوكيز نفسه AndroidCookieJar، والتوجيه والـUser-Agent
 * نفسيهما) بلا معترضَي التحقق: الفحص لا يفتح حلًا صامتًا ولا يسجّل طلب تحقق جديدًا. لا يُعاد ولا يُخزّن جسمه.
 */
object VerificationAcceptance {
    enum class Verdict { ACCEPTED, CHALLENGED, UNREACHABLE }

    /** حكم الرد وحده (يُختبر بلا شبكة): تحدٍّ صريح، أو رفض من Cloudflare بصفحة تحدٍّ، أو قبول. */
    fun verdictOf(code: Int, server: String?, mitigated: String?, bodyHead: String?): Verdict {
        if (mitigated?.trim().equals("challenge", ignoreCase = true)) return Verdict.CHALLENGED
        val body = bodyHead?.lowercase().orEmpty()
        // Cloudflare يحقن challenge-platform في صفحات عادية أيضًا (كشف البوتات): الرد الناجح تحدٍّ بعنوانه وحده
        val challengeTitle = Regex("<title>\\s*(just a moment|attention required|ddos-guard|checking your browser)").containsMatchIn(body)
        return when {
            code in 200..399 && challengeTitle -> Verdict.CHALLENGED
            code in 200..399 -> Verdict.ACCEPTED
            code in listOf(403, 429, 503) && challengeTitle -> Verdict.CHALLENGED
            // A denial or service error is neither proof of a human challenge nor acceptance.
            code in listOf(401, 403, 429) -> Verdict.UNREACHABLE
            code in 400..499 -> Verdict.ACCEPTED // صفحة الموقع نفسها (404 مثلًا): الجلسة مقبولة، والمسار شأن المصدر
            else -> Verdict.UNREACHABLE
        }
    }

    /** عميل الفحص: عميل المحرك بلا معترضَي التحقق، ومهلة قصيرة. */
    fun client(engine: OkHttpClient): OkHttpClient = engine.newBuilder().apply {
        interceptors().removeAll { it is CloudflareInterceptor || it is BrowserVerificationInterceptor }
    }.callTimeout(20, TimeUnit.SECONDS).build()

    /** Debug: الحكم مع رمز الرد وترويسة cf-mitigated وعدد cf_clearance المرسلة فعلًا، بلا قيم ولا جسم. */
    fun probe(client: OkHttpClient, url: String, userAgent: String): String = try {
        // من الشبكة لا من ذاكرة المحرك المؤقتة: الحكم على الجلسة المنقولة الآن
        client.newCall(Request.Builder().url(url).header("User-Agent", userAgent).cacheControl(okhttp3.CacheControl.FORCE_NETWORK).get().build()).execute().use { r ->
            val head = runCatching { r.peekBody(64 * 1024).string() }.getOrNull()
            val sent = r.request.headers("Cookie").joinToString("; ").split(';').count { it.trim().startsWith("cf_clearance=") }
            val sentNet = r.networkResponse?.request?.headers("Cookie")?.joinToString("; ")?.split(';')?.count { it.trim().startsWith("cf_clearance=") }
            "${verdictOf(r.code, r.header("Server"), r.header("cf-mitigated"), head)} code=${r.code} mitigated=${r.header("cf-mitigated") ?: "-"} " +
                "server=${r.header("Server") ?: "-"} cfClearanceSent=${sentNet ?: sent} protocol=${r.protocol}"
        }
    } catch (e: IOException) { "UNREACHABLE ${e.javaClass.simpleName}" } catch (e: IllegalArgumentException) { "UNREACHABLE ${e.javaClass.simpleName}" }

    /**
     * Debug (تجربة توافق Mihon): هوية المتصفح بشكل Mihon الافتراضي (NetworkPreferences.defaultUserAgent): Chrome المختصر
     * «Android 10; K» ورقم Chrome الرئيسي فقط، بالرقم الرئيسي لـWebView الجهاز نفسه. هويتنا الحالية مشتقة من WebView
     * (طراز الجهاز وBuild/ ورقم Chrome كاملًا بلا «wv»)، ولا يرسلها Chrome حقيقي.
     */
    fun mihonUserAgent(base: String): String {
        val major = Regex("Chrome/(\\d+)").find(base)?.groupValues?.get(1) ?: "149"
        return "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$major.0.0.0 Mobile Safari/537.36"
    }

    /** Debug: عميل عارٍ كعميل Mihon الافتراضي: DNS النظام، بلا معترضات VANTARA، بلا كوكيز (زائر جديد كأول طلب في Mihon). */
    fun bareClient(): OkHttpClient = OkHttpClient.Builder().cookieJar(okhttp3.CookieJar.NO_COOKIES)
        .callTimeout(20, TimeUnit.SECONDS).build()

    /** Debug: عميل المحرك (DNS ومعترضات VANTARA) بلا معترضَي التحقق وبلا كوكيز: الطريق نفسه بلا جلسة. */
    fun engineNoCookies(engine: OkHttpClient): OkHttpClient = client(engine).newBuilder().cookieJar(okhttp3.CookieJar.NO_COOKIES).build()

    /**
     * Debug: مصفوفة 2×2 (الطريق: محركنا/عارٍ كـMihon) × (الهوية: هويتنا/هوية Mihon)، بلا كوكيز، أربعة طلبات GET مرة واحدة
     * بعد كل تحقق. لا تجاوز ولا إعادة عند الرفض: الرفض نفسه هو النتيجة. تجيب: ما الذي يجعل Cloudflare يتحدّانا ويُدخل Mihon؟
     */
    fun matrix(engine: OkHttpClient, url: String, ourUserAgent: String): List<String> {
        val mihon = mihonUserAgent(ourUserAgent)
        return listOf(
            "engine+ourUA" to { probe(engineNoCookies(engine), url, ourUserAgent) },
            "engine+mihonUA" to { probe(engineNoCookies(engine), url, mihon) },
            "bare+ourUA" to { probe(bareClient(), url, ourUserAgent) },
            "bare+mihonUA" to { probe(bareClient(), url, mihon) },
        ).map { (name, run) -> "$name: ${runCatching(run).getOrElse { "error ${it.javaClass.simpleName}" }}" }
    }

    /** لا يُنادى من الخيط الرئيسي ولا من خيط Capacitor. */
    fun check(client: OkHttpClient, url: String, userAgent: String): Verdict = try {
        client.newCall(Request.Builder().url(url).header("User-Agent", userAgent).get().build()).execute().use { r ->
            val head = runCatching { r.peekBody(64 * 1024).string() }.getOrNull()
            verdictOf(r.code, r.header("Server"), r.header("cf-mitigated"), head)
        }
    } catch (_: IOException) { Verdict.UNREACHABLE } catch (_: IllegalArgumentException) { Verdict.UNREACHABLE }
}
