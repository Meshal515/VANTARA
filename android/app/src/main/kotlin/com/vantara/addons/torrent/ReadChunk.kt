package com.vantara.addons.torrent

/**
 * مخزن القراءات الصغيرة لـ[TorrentDataSource] (جذر بطء فهرس Cues: مستخرج MKV يقرأه عنصرًا عنصرًا، ~350 ألف read لـ519KB،
 * وكل واحد في المحرك ~40µs: 14–16 ث على المحاكي ولو كان الملف على القرص، 2 ث بعد المخزن).
 *
 * شروط المالك (27 نوفمبر)، وكلها في TorrentReadChunkTest:
 * - لا انتظار لملء الكتلة: [fill] يطلب حتى [capacity] والمصدر يعيد ما هو متاح الآن؛ بايت واحد متاح = بايت واحد فورًا.
 * - الإبطال: [reset] مع كل فتح وإغلاق، ولا يُقدَّم إلا ما يقع داخل ما جُلب من الموضع نفسه، ولا يتجاوز نطاق الطلب ([fill]
 *   بحجم أقصاه المتبقي منه).
 * - سلامة الخطة B: ما جاء قبل التحقق يُعلَّم، ولا يُسلَّم من المخزن إلا إن بقي المحرك يثق بالقراءة المبكرة لهذا التورنت
 *   ([trusted]): فشل تحقق قطعة يرمي المخزن، وما بعده يُطلب من المحرك من جديد (موثقًا).
 */
internal class ReadChunk(private val capacity: Int) {
    private var data: ByteArray? = null
    private var at = 0L
    private var length = 0
    private var early = false

    fun reset() { length = 0; early = false }

    /** من المخزن إن غطى [position]؛ وإلا -1 (ومعه إن لم يعد موثوقًا يُرمى). */
    fun take(position: Long, target: ByteArray, offset: Int, want: Int, trusted: () -> Boolean): Int {
        val held = data ?: return -1
        if (length <= 0 || position < at || position >= at + length) return -1
        if (early && !trusted()) { reset(); return -1 }
        val n = minOf(want.toLong(), at + length - position).toInt()
        System.arraycopy(held, (position - at).toInt(), target, offset, n)
        return n
    }

    /**
     * يملأ المخزن من [position] بحد [size] (≤ [capacity]) من [source] (يعيد ما هو متاح الآن، أو ≤0)، و[wasEarly] بعده هل
     * كان قبل التحقق. يعيد ما جُلب (≤0 كما أعاده المصدر).
     */
    fun fill(position: Long, size: Int, source: (ByteArray, Int, Int) -> Int, wasEarly: () -> Boolean): Int {
        val buffer = data ?: ByteArray(capacity).also { data = it }
        reset()
        val got = source(buffer, 0, minOf(size, capacity))
        if (got <= 0) return got
        at = position; length = got; early = wasEarly()
        return got
    }
}
