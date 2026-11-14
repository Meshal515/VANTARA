package com.vantara.runtime

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred

/**
 * دخول عمليات CloudStream إلى العامل المعزول: عادل بين المصادر، والتشغيل قبل البحث.
 *
 * كان قفلًا واحدًا بخانتين لكل المصادر وكل العمليات. البحث العام يسأل كل مصدر بعدة أسماء وصفحات في وقت واحد،
 * فيصطف أكثر من عشرة طلبات أمام خانتين وكل طلب يشغّل عاملًا معزولًا جديدًا. المصدر الذي يجد العمل من صفحته في
 * لحظة يصل البطاقة العامة بعد عشرات الثواني أو لا يصل، وحلقات ورقة السيرفرات وروابطها تنتظر خلف البحث.
 *
 * - [total] عمليات (عمال معزولون) معًا كحد أقصى: حد الذاكرة باقٍ.
 * - [perSource] لكل مصدر: اسم ثانٍ أو صفحة ثانية لمصدر لا يسبق الطلب الأول لمصدر آخر.
 * - العاجل (ما ينتظره المستخدم الآن: التفاصيل والحلقات وروابط الفيديو) يُقدَّم على البحث والكتالوج.
 */
class RuntimeGate(private val total: Int, private val perSource: Int = 1) {
    private class Waiter(val key: String, val urgent: Boolean, val order: Long) { val turn = CompletableDeferred<Unit>() }
    private val lock = Any()
    private val queue = ArrayList<Waiter>()
    private val running = HashMap<String, Int>()
    private var active = 0
    private var order = 0L

    suspend fun <T> run(key: String, urgent: Boolean, block: suspend () -> T): T {
        val me = synchronized(lock) { Waiter(key, urgent, order++).also { queue.add(it); pump() } }
        try { me.turn.await() } catch (cancelled: CancellationException) {
            // دوره وصل ثم أُلغي قبل أن يبدأ: يعيده لغيره
            synchronized(lock) { if (!queue.remove(me)) finish(key) }
            throw cancelled
        }
        try { return block() } finally { synchronized(lock) { finish(key) } }
    }

    /** للاختبار والتشخيص: العمليات الجارية الآن. */
    fun active(): Int = synchronized(lock) { active }

    private fun finish(key: String) {
        active--
        val left = (running[key] ?: 1) - 1
        if (left > 0) running[key] = left else running.remove(key)
        pump()
    }

    private fun pump() {
        while (active < total) {
            val next = queue.filter { (running[it.key] ?: 0) < perSource }
                .minWithOrNull(compareBy<Waiter>({ !it.urgent }, { it.order })) ?: return
            queue.remove(next)
            active++
            running[next.key] = (running[next.key] ?: 0) + 1
            next.turn.complete(Unit)
        }
    }

    companion object {
        /** ما ينتظره المستخدم في الورقة أو صفحة العمل الآن. */
        val URGENT = setOf("details", "episodes", "videoLinks")
    }
}
