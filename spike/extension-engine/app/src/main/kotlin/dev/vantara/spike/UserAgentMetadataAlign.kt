package dev.vantara.spike

import android.util.Log
import android.webkit.WebView
import androidx.webkit.UserAgentMetadata
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature

/**
 * Sec-CH-UA مطابق للـUser-Agent المرسل للمحلّل الصامت (CloudflareInterceptor) ولصفحة التحقق الظاهرة (VerificationActivity) معًا، بلا نسخة ثانية. صفحة التحقق الظاهرة ترسل User-Agent الطلب الذي
 * رُفض، وبلا هذا تعلن Sec-CH-UA «Android WebView»: Cloudflare يرى التناقض بين البصمتين.
 */
fun alignUserAgentMetadata(view: WebView, userAgent: String) {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) return
    val chrome = ChromeUserAgent.parse(userAgent) ?: return
    try {
        val current = WebSettingsCompat.getUserAgentMetadata(view.settings)
        val brands = current.brandVersionList.map { item ->
            val brand = when (item.brand) {
                "Android WebView" -> "Google Chrome"
                "Chromium" -> "Chromium"
                else -> return@map item
            }
            UserAgentMetadata.BrandVersion.Builder()
                .setBrand(brand)
                .setMajorVersion(chrome.major)
                .setFullVersion(chrome.full)
                .build()
        }
        WebSettingsCompat.setUserAgentMetadata(
            view.settings,
            UserAgentMetadata.Builder(current)
                .setBrandVersionList(brands)
                .setFullVersion(chrome.full)
                .build(),
        )
    } catch (t: Throwable) {
        Log.w("CloudflareInterceptor", "Failed to align WebView user-agent metadata", t)
    }
}
