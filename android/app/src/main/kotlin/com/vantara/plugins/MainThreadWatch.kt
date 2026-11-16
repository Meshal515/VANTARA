package com.vantara.plugins

import android.os.Looper
import android.os.SystemClock

/**
 * رصد الخيط الرئيسي (Debug مع «إظهار التشخيص» فقط): في الـWebView اللمس وزخم التمرير يمرّان من هذا
 * الخيط، فأي رسالة طويلة عليه توقف الزخم لحظتها. يُوقَّت كل ما يُنفَّذ عليه (Looper message logging)،
 * وما طال أكثر من [SLOW_MS] يُحفظ مع ما كان ينفّذه (عيّنة مكدّس أثناءه). تقرير القارئ يعرضه بجانب كل وقفة.
 * Stable لا يركّبه أبدًا: البناء نفسه يمنعه (DiagnosticVisibility).
 */
class MainThreadBlocks(private val now: () -> Long, private val keep: Int = 60) {
    data class Block(val endedAt: Long, val ms: Long, val what: String, val stack: List<String>)

    private val blocks = ArrayDeque<Block>()
    @Volatile private var startedAt = 0L
    @Volatile private var what = ""
    @Volatile var sample: List<String> = emptyList()

    /** سطر من Looper: «>>>>> Dispatching to …» عند البدء و«<<<<< Finished to …» عند الانتهاء. */
    fun line(text: String) {
        if (text.startsWith(">>>>>")) {
            what = text.removePrefix(">>>>> Dispatching to ").take(160)
            sample = emptyList()
            startedAt = now()
        } else if (text.startsWith("<<<<<") && startedAt != 0L) {
            val end = now()
            val ms = end - startedAt
            startedAt = 0L
            if (ms >= SLOW_MS) synchronized(blocks) {
                blocks.addLast(Block(end, ms, what, sample))
                while (blocks.size > keep) blocks.removeFirst()
            }
        }
    }

    /** منذ كم تعمل الرسالة الحالية (0 إن لا شيء)، ليأخذ الراصد عيّنة من مكدّسها وهي طويلة. */
    fun runningFor(): Long = startedAt.let { if (it == 0L) 0L else now() - it }

    fun snapshot(): List<Block> = synchronized(blocks) { blocks.toList() }

    /** حدث لا يأتي من رسائل الخيط (توقف جمع الذاكرة الذي يوقف كل الخيوط مثلًا). */
    fun add(ms: Long, what: String) = synchronized(blocks) {
        blocks.addLast(Block(now(), ms, what, emptyList()))
        while (blocks.size > keep) blocks.removeFirst()
    }

    /** عدّاد ART لجمع الذاكرة الحاجب: يُسجَّل كل جمع جديد بمدته. */
    private var gcCount = -1L
    private var gcTime = 0L
    fun gc(count: Long?, timeMs: Long?) {
        if (count == null || timeMs == null) return
        if (gcCount >= 0 && count > gcCount) add(timeMs - gcTime, "ART blocking GC ×${count - gcCount}")
        gcCount = count
        gcTime = timeMs
    }

    companion object {
        const val SLOW_MS = 32L

        /** أعلى المكدّس بلا إطارات الحلقة نفسها: ما كان الخيط ينفّذه فعلًا. */
        fun stackTop(frames: Array<StackTraceElement>, max: Int = 8): List<String> = frames
            .dropWhile { it.className.startsWith("android.os.Looper") || it.className.startsWith("android.os.MessageQueue") }
            .take(max)
            .map { "${it.className.substringAfterLast('.')}.${it.methodName}:${it.lineNumber}" }
    }
}

object MainThreadWatch {
    @Volatile private var blocks: MainThreadBlocks? = null
    private var sampler: Thread? = null

    @Synchronized fun start() {
        if (blocks != null) return
        val watch = MainThreadBlocks(SystemClock::uptimeMillis)
        blocks = watch
        val main = Looper.getMainLooper()
        main.setMessageLogging { watch.line(it) }
        sampler = Thread({
            try {
                while (!Thread.currentThread().isInterrupted) {
                    Thread.sleep(10)
                    if (watch.runningFor() >= MainThreadBlocks.SLOW_MS && watch.sample.isEmpty()) {
                        watch.sample = MainThreadBlocks.stackTop(main.thread.stackTrace)
                    }
                    watch.gc(
                        android.os.Debug.getRuntimeStat("art.gc.blocking-gc-count")?.toLongOrNull(),
                        android.os.Debug.getRuntimeStat("art.gc.blocking-gc-time")?.toLongOrNull(),
                    )
                }
            } catch (_: InterruptedException) { /* stopped */ }
        }, "vantara-main-watch").apply { isDaemon = true; start() }
    }

    @Synchronized fun stop() {
        Looper.getMainLooper().setMessageLogging(null)
        sampler?.interrupt()
        sampler = null
        blocks = null
    }

    /** الكتل الطويلة مع عمرها (منذ كم انتهت) ليطابقها القارئ بساعته. */
    fun recent(): List<Pair<Long, MainThreadBlocks.Block>> {
        val now = SystemClock.uptimeMillis()
        return blocks?.snapshot()?.map { (now - it.endedAt) to it } ?: emptyList()
    }
}
