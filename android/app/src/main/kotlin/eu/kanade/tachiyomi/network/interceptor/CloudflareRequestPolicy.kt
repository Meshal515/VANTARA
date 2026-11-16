package eu.kanade.tachiyomi.network.interceptor

import okhttp3.HttpUrl

internal enum class CloudflareRequestKind { HUMAN_CHALLENGE, IMAGE_FINGERPRINT, NONE }

/** Explicit mitigation outranks status and Server; a WAF denial alone is not a human challenge. */
internal fun classifyCloudflareRequest(
    status: Int,
    server: String?,
    mitigated: String?,
    isImage: Boolean,
): CloudflareRequestKind {
    if (mitigated?.trim().equals("challenge", ignoreCase = true)) return CloudflareRequestKind.HUMAN_CHALLENGE
    val fromCloudflare = server?.trim().let {
        it.equals("cloudflare", ignoreCase = true) || it.equals("cloudflare-nginx", ignoreCase = true)
    }
    return if (isImage && status in listOf(403, 503) && fromCloudflare) CloudflareRequestKind.IMAGE_FINGERPRINT else CloudflareRequestKind.NONE
}

/**
 * تحدٍّ يطلب إنسانًا: هل يُجرَّب الحل الصامت؟ لا لصورة (غلاف أو صفحة: تُطلب بالعشرات، وWebView مخفي لكل واحدة
 * يجمّد السكرول)، ولا لمضيف فشل حله الصامت قبل أقل من SILENT_RETRY_MS.
 */
internal fun silentSolveAllowed(isImage: Boolean, lastFailedAt: Long?, now: Long): Boolean =
    !isImage && (lastFailedAt == null || now - lastFailedAt >= SILENT_RETRY_MS)

internal const val SILENT_RETRY_MS = 10 * 60_000L

/** Optional app-owned event sink. Shared probe code never launches an Activity. */
object SourceVerificationRequests {
    @Volatile var reporter: ((HttpUrl, String) -> Unit)? = null
    fun require(url: HttpUrl, userAgent: String) { reporter?.invoke(url, userAgent) }
}
