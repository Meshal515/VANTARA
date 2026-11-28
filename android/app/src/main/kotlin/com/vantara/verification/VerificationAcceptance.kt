package com.vantara.verification

/** Pure response classification; does not issue network requests. */
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
}
