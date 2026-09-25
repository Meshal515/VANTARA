package com.vantara.anime.adapters

import com.vantara.anime.stream.Candidate
import eu.kanade.tachiyomi.network.await
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import okhttp3.Call
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * أين انكسرت السلسلة: المصدر ← الحلقة ← السيرفر ← المستخرج. الواجهة تبقى نظيفة
 * («لا سيرفرات»)، والتشخيص يُري السبب لكل سيرفر بدل قائمة فارغة صامتة.
 */
class ResolveTrace(
    /** حالة كل سيرفر لحظة تتغيّر: ورقة السيرفرات تُرسم منها وهي تتجهّز. */
    private val onRoute: ((com.vantara.anime.stream.RouteReport) -> Unit)? = null,
) {
    private val notes = ConcurrentLinkedQueue<String>()

    fun note(stage: String, reason: String) {
        if (notes.size < MAX) notes += "$stage: $reason"
    }

    fun route(report: com.vantara.anime.stream.RouteReport) {
        runCatching { onRoute?.invoke(report) }
        if (report.state == com.vantara.anime.stream.RouteState.UNAVAILABLE && report.reason != null) note(report.server, report.reason)
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

/**
 * يحل مهامّ بالتوازي ويتوقف مبكرًا حين تكفي: روابط من [enough] مضيفات مختلفة.
 * التشغيل يبدأ بأول سيرفرين سليمين بدل انتظار أبطأ سيرفر؛ والبقية تُطلب لاحقًا
 * إن فشلا ([com.vantara.anime.AnimeEngine.more]).
 */
internal suspend fun gatherUntil(tasks: List<suspend () -> List<Candidate>>, enough: Int): List<Candidate> =
    coroutineScope {
        val results = Channel<List<Candidate>>(Channel.UNLIMITED)
        val jobs = tasks.map { t -> launch { results.send(t()) } }
        val out = mutableListOf<Candidate>()
        for (i in tasks.indices) {
            out += results.receive()
            if (out.map { it.host }.distinct().size >= enough) {
                jobs.forEach { it.cancel() }
                break
            }
        }
        out.distinctBy { it.url }
    }

/** سبب مختصر لسطر تشخيص: الرسالة إن وُجدت، وإلا نوع الخطأ. */
internal fun Throwable.brief(): String = message?.take(160)?.ifBlank { null } ?: javaClass.simpleName

