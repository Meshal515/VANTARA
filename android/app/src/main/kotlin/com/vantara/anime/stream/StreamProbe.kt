package com.vantara.anime.stream

import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * فحص رابط فيديو جاهز بطلب واحد قصير: هل يرد فعلًا بفيديو أو قائمة HLS؟
 *
 * «جاهز» من المحوّل يعني أن رابطًا استُخرج، لا أن الرابط يعمل: كثير من
 * المضيفات يرد بصفحة خطأ أو بحجب. الفحص يطلب أول كيلوبايتين فقط (Range)
 * بترويسات المرشّح نفسها، والحكم في [verdict] بلا شبكة فيُختبر.
 */
object StreamProbe {

    fun check(client: OkHttpClient, c: Candidate): Boolean {
        val request = Request.Builder().url(c.url).apply {
            for ((k, v) in c.headers) runCatching { header(k, v) }
            header("Range", "bytes=0-2047")
        }.build()
        return client.newCall(request).execute().use { r ->
            if (r.code !in 200..299) return@use false
            val head = runCatching { r.peekBody(256).string() }.getOrDefault("")
            verdict(c.container, r.header("Content-Type"), head)
        }
    }

    /**
     * الحكم من نوع المحتوى وأول بايتات الجسم:
     *   - قائمة HLS تبدأ بـ`#EXTM3U` دائمًا؛ مرشّح HLS بغيرها ميت.
     *   - صفحة HTML مكان الفيديو = خطأ أو حجب.
     *   - غير ذلك (فيديو، octet-stream، بايتات MP4) يُقبل.
     */
    fun verdict(container: Container, contentType: String?, head: String): Boolean {
        val text = head.trimStart('﻿', ' ', '\n', '\r', '\t')
        if (text.startsWith("#EXTM3U")) return true
        if (container == Container.HLS) return false
        val type = contentType.orEmpty().lowercase()
        if (type.startsWith("text/html") || text.startsWith("<!doctype", ignoreCase = true) || text.startsWith("<html", ignoreCase = true)) return false
        if (type.startsWith("application/json")) return false
        return true
    }
}
