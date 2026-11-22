package com.vantara.plugins

/**
 * قاعدة قبول تحديث إضافة فيديو (CloudStream وAniyomi معًا؛ تدقيق Stable 0.0.222: RH8 وAU1).
 *
 * كانت البوابة تشترط أن ينجح **كل** مصدر في الحزمة رحلة كاملة خلال 90 ثانية للحزمة كلها، فيُرفض للأبد التحديث في
 * الحالات التي جاء ليصلحها: مصدر بحث فقط، حزمة بعدة مصادر، موقع محجوب أو خلف Cloudflare، HLS مشفّر، روابط magnet.
 *
 * الآن:
 * - عدم توافق الكود نفسه (صنف/دالة مفقودة، تحويل نوع) = رفض: هذا عطل الإصدار لا الموقع.
 * - مصدر واحد أكمل الرحلة = قبول.
 * - كل الإخفاقات بسبب البيئة (شبكة، حجب، تحقق، حد طلبات، مهلة، بحث فقط، وسائط لا تُفحص بـHTTP) = قبول.
 * - كل المصادر فشلت وظيفيًا ولا ناجح = رفض.
 */
object UpdatePreflight {
    sealed interface Outcome {
        data object Passed : Outcome
        data class Failed(val error: Throwable) : Outcome
    }
    enum class Kind { INCOMPATIBLE, ENVIRONMENT, FUNCTIONAL }
    data class Verdict(val accept: Boolean, val code: String)

    private val INCOMPATIBLE = listOf(
        LinkageError::class.java, ClassCastException::class.java, ClassNotFoundException::class.java,
    )
    private val ENVIRONMENT_CODES = listOf(
        "VERIFICATION_REQUIRED", "RATE_LIMITED", "CANDIDATE_CATALOGUE_EMPTY", "TIMEOUT", "SITE_", "HTTP_4", "HTTP_5",
        "UNREACHABLE", "ENCRYPTED", "MAGNET", "TORRENT", "NO_PEERS", "ORIGIN_NOT_ALLOWED", "DNS", "TLS", "SSL",
    )

    fun classify(error: Throwable): Kind {
        val chain = generateSequence(error) { it.cause }.take(8).toList()
        if (chain.any { e -> INCOMPATIBLE.any { it.isInstance(e) } }) return Kind.INCOMPATIBLE
        val environment = chain.any { e ->
            e is java.io.IOException || e.javaClass.name.endsWith("TimeoutCancellationException") ||
                e.javaClass.name.endsWith("TimeoutException") ||
                ENVIRONMENT_CODES.any { code -> e.message.orEmpty().contains(code, ignoreCase = true) }
        }
        return if (environment) Kind.ENVIRONMENT else Kind.FUNCTIONAL
    }

    fun decide(outcomes: List<Outcome>): Verdict {
        val failures = outcomes.filterIsInstance<Outcome.Failed>().map { classify(it.error) }
        return when {
            failures.any { it == Kind.INCOMPATIBLE } -> Verdict(false, "RUNTIME_UPDATE_INCOMPATIBLE")
            outcomes.any { it is Outcome.Passed } -> Verdict(true, "RUNTIME_UPDATE_VERIFIED")
            outcomes.isNotEmpty() && failures.all { it == Kind.ENVIRONMENT } -> Verdict(true, "RUNTIME_UPDATE_UNVERIFIED_ENVIRONMENT")
            else -> Verdict(false, "RUNTIME_UPDATE_PREFLIGHT_FAILED")
        }
    }

    /** مهلة كل مصدر: لا يحبس مصدر بطيء البقية، ولا تُحسب حزمة بعدة مصادر كأنها مصدر واحد. */
    const val PER_SOURCE_MS = 75_000L
}
