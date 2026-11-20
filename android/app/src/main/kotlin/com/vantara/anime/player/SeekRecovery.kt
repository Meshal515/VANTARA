package com.vantara.anime.player

/**
 * TS1 (بلاغ المالك: تورنت 4K يعمل، قفزة 20 دقيقة، «تم التبديل إلى سيرفر آخر» ولا يرجع يشتغل): عطل بعد تشغيل ناجح وبعد
 * قفزة قريبة يعني غالبًا أن الموضع الجديد لم يصل بعد (قطع التورنت، نطاق HTTP)، لا أن السيرفر مات. فيُعاد فتح المصدر نفسه
 * عند الموضع حتى [MAX_RETRIES] مرات لكل مصدر، ثم التبديل كما كان. عطل بلا قفزة أو قبل أي تشغيل: التبديل كما كان.
 */
class SeekRecovery {
    private var lastSeekAt = Long.MIN_VALUE / 2
    private val retries = mutableMapOf<String, Int>()

    fun seeked(now: Long) { lastSeekAt = now }

    /** يُحسب كإعادة إن كانت مسموحة، فلا تتكرر بلا حد. */
    fun shouldRetry(candidateId: String, startedBefore: Boolean, now: Long): Boolean {
        if (!startedBefore || now - lastSeekAt > WINDOW_MS) return false
        val n = retries[candidateId] ?: 0
        if (n >= MAX_RETRIES) return false
        retries[candidateId] = n + 1
        return true
    }

    companion object {
        const val WINDOW_MS = 3 * 60_000L
        const val MAX_RETRIES = 2
    }
}
