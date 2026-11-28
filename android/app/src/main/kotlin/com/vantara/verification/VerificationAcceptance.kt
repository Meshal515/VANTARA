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

    /** لا يُنادى من الخيط الرئيسي ولا من خيط Capacitor. */
    fun check(client: OkHttpClient, url: String, userAgent: String): Verdict = try {
        client.newCall(Request.Builder().url(url).header("User-Agent", userAgent).get().build()).execute().use { r ->
            val head = runCatching { r.peekBody(64 * 1024).string() }.getOrNull()
            verdictOf(r.code, r.header("Server"), r.header("cf-mitigated"), head)
        }
    } catch (_: IOException) { Verdict.UNREACHABLE } catch (_: IllegalArgumentException) { Verdict.UNREACHABLE }
}
