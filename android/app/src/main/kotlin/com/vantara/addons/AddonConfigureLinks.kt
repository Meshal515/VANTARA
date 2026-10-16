package com.vantara.addons

import java.net.URI
import java.net.URLDecoder

/**
 * صفحات إعداد إضافات Stremio تنتهي بزر «Install» يفتح `stremio://…/manifest.json`، أو
 * «Install on web» يفتح `web.stremio.com/#/addons?addon=<رابط>`. على الجوال كان هذا
 * يرمي المستخدم إلى تطبيق Stremio. هنا نلتقط الرابطين ونحوّلهما إلى رابط manifest
 * آمن تثبّته VANTARA نفسها (نفس قواعد security.cjs في الويندوز).
 */
object AddonConfigureLinks {
    private val HOST = Regex("^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z][a-z0-9-]*$", RegexOption.IGNORE_CASE)
    private val LOCAL = Regex("(?:^|\\.)(localhost|local|internal|lan|home)$", RegexOption.IGNORE_CASE)
    private val MANIFEST = Regex("/manifest\\.json/?$")
    private val STREMIO_WEB = setOf("web.stremio.com", "app.strem.io", "www.stremio.com", "web.strem.io")

    /** رابط manifest صالح للتثبيت، أو null إن لم يكن الرابط تثبيت إضافة. */
    fun manifestFrom(raw: String): String? {
        if (raw.length > 16_000) return null
        val candidate = when {
            raw.startsWith("stremio://", ignoreCase = true) -> "https://" + raw.substring("stremio://".length)
            else -> stremioWebAddon(raw) ?: return null
        }.substringBefore('#')
        val uri = runCatching { URI(candidate) }.getOrNull() ?: return null
        if (!uri.scheme.equals("https", ignoreCase = true) || uri.rawUserInfo != null || uri.port != -1) return null
        val host = uri.host ?: return null
        if (!HOST.matches(host) || LOCAL.containsMatchIn(host)) return null
        if (!MANIFEST.containsMatchIn(uri.rawPath ?: "")) return null
        return candidate
    }

    /** `https://web.stremio.com/#/addons?addon=https%3A%2F%2F…%2Fmanifest.json` → الرابط المفكوك. */
    private fun stremioWebAddon(raw: String): String? {
        val uri = runCatching { URI(raw) }.getOrNull() ?: return null
        if (!uri.scheme.equals("https", ignoreCase = true) || uri.host?.lowercase() !in STREMIO_WEB) return null
        val query = (uri.rawFragment ?: "").substringAfter('?', "").ifEmpty { uri.rawQuery ?: "" }
        val value = query.split('&').firstOrNull { it.startsWith("addon=") }?.substringAfter('=') ?: return null
        return runCatching { URLDecoder.decode(value, "UTF-8") }.getOrNull()
    }

    /** الروابط التي تبقى داخل نافذة الإعداد: صفحات HTTPS فقط (لا intent:// ولا متاجر). */
    fun staysInside(raw: String): Boolean =
        raw.startsWith("https://", ignoreCase = true) || raw.startsWith("http://", ignoreCase = true)
}
