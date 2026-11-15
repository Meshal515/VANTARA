package com.vantara.usage

import java.util.concurrent.Executor
import java.util.concurrent.ExecutorService
import java.util.concurrent.TimeUnit

/**
 * كتابة وقت القراءة في السجل على خيط خلفي واحد، بالترتيب.
 *
 * الكتابة تنتهي بـfsync، وكانت على الخيط الرئيسي كل 5 ثوانٍ أثناء القراءة: في الـWebView الخيط الرئيسي
 * يقود اللمس وزخم التمرير، فكان الزخم يقف جزءًا من الثانية ثم يكمل بقفزة. الحساب نفسه (من يُحسب له
 * الوقت) يبقى على الخيط الرئيسي كما هو؛ هنا الكتابة فقط. ما فشلت كتابته يبقى لصاحبه ويُكتب قبل الأحدث
 * مع المحاولة التالية: لا يضيع ولا يُنسب لعمل آخر.
 */
class UsageWriter(private val credit: (UsageOwner, Long, Long) -> Unit, private val io: Executor) {
    private class Entry(val owner: UsageOwner, val ms: Long, val wallNow: Long)
    /** يُلمس على خيط الكتابة وحده. */
    private val waiting = ArrayDeque<Entry>()

    fun write(owner: UsageOwner, ms: Long, wallNow: Long) {
        if (ms <= 0) return
        io.execute {
            waiting.addLast(Entry(owner, ms, wallNow))
            while (waiting.isNotEmpty()) {
                val next = waiting.first()
                try { credit(next.owner, next.ms, next.wallNow) } catch (_: Exception) { return@execute }
                waiting.removeFirst()
            }
        }
    }

    /** ينتظر (بحد) ما في الطابور: قبل أن يغادر التطبيق الواجهة أو يُغلق. */
    fun drain(timeoutMs: Long) {
        runCatching { (io as? ExecutorService)?.submit {}?.get(timeoutMs, TimeUnit.MILLISECONDS) }
    }
}
