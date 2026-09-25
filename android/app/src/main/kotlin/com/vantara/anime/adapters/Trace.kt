package com.vantara.anime.adapters

import eu.kanade.tachiyomi.network.await
import okhttp3.Call
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * أين انكسرت السلسلة: المصدر ← الحلقة ← السيرفر ← المستخرج. الواجهة تبقى نظيفة
 * («لا سيرفرات»)، والتشخيص يُري السبب لكل سيرفر بدل قائمة فارغة صامتة.
 */
class ResolveTrace {
    private val notes = ConcurrentLinkedQueue<String>()

    fun note(stage: String, reason: String) {
        if (notes.size < MAX) notes += "$stage: $reason"
    }

    fun notes(): List<String> = notes.toList()

    private companion object {
        const val MAX = 40
    }
}

/** خطأ HTTP يسمّي المسار الذي فشل، لا «HTTP error 429» مجردًا. */
class SourceHttpException(val code: Int, val path: String) : IOException("HTTP $code ← $path")

internal suspend fun Call.awaitOk(): Response {
    val r = await()
    if (r.isSuccessful) return r
    val path = r.request.url.encodedPath
    r.close()
    throw SourceHttpException(r.code, path)
}

/** سبب مختصر لسطر تشخيص: الرسالة إن وُجدت، وإلا نوع الخطأ. */
internal fun Throwable.brief(): String = message?.take(160)?.ifBlank { null } ?: javaClass.simpleName
