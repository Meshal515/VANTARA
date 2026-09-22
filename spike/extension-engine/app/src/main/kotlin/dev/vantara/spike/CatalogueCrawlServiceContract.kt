package dev.vantara.spike

import java.util.concurrent.atomic.AtomicBoolean

/**
 * زحفٌ واحد في العملية، مهما ضُغط الزر.
 *
 * الشاشة قد تُعاد إنشاؤها وسط زحف، والمستخدم قد يضغط «ابدأ» مرّتين قبل أن تتحدّث
 * الحالة. وزحفان على نفس المصادر يكتبان نفس نقاط الحفظ في وقت واحد، فيتقدّم
 * أحدهما فوق صفحةٍ حفظها الآخر. فالبوابة ذرّية: `compareAndSet` واحد يفوز.
 *
 * وهي على مستوى **العملية** لا الخدمة: أندرويد قد يُنشئ نسخة جديدة من الخدمة
 * بينما القديمة لم تُفرج بعد، والبوابة المشتركة تمنع الاثنين معًا.
 */
object CatalogueCrawlExecutionGate {
    private val running = AtomicBoolean(false)

    fun tryAcquire(): Boolean = running.compareAndSet(false, true)

    fun release() {
        running.set(false)
    }

    fun isRunning(): Boolean = running.get()
}

/** ما لا يحتاج أندرويد من عقد الخدمة: الأفعال، وقرار إعادة الإنشاء. */
object CatalogueCrawlServiceContract {
    const val ACTION_START = "dev.vantara.spike.action.START_CATALOGUE_CRAWL"
    const val ACTION_STOP = "dev.vantara.spike.action.STOP_CATALOGUE_CRAWL"

    enum class Recreated { RESUME, STOP_SELF }

    /**
     * أندرويد أعاد إنشاء الخدمة بعد موت العملية (`START_STICKY` بلا نيّة).
     *
     * البوابة في الذاكرة فارغة بعد الموت، فلا تُخبر بشيء. الحالة الدائمة وحدها
     * تعرف أن زحفًا كان جاريًا — فتُستأنف من نقاط الحفظ. وخدمةٌ بلا زحف جارٍ
     * تُنهي نفسها بدل أن تبقى تُظهر إشعارًا فارغًا.
     */
    fun onRecreated(durableActive: Boolean): Recreated =
        if (durableActive) Recreated.RESUME else Recreated.STOP_SELF

    enum class StopReason {
        USER,

        /**
         * أندرويد ١٥ يعطي `dataSync` ست ساعات في كل ٢٤ ساعة، ثم يستدعي
         * `onTimeout` وأمام الخدمة ثوانٍ لتنهي نفسها وإلا انهار التطبيق.
         * فتحُ التطبيق يصفّر العدّاد — لذلك الرسالة تقول «افتح».
         */
        SYSTEM_TIME_LIMIT,

        /** أندرويد رفض بدء الخدمة من الخلفية، أو الحدّ اليومي نفد قبل البدء. */
        START_NOT_ALLOWED,

        /** الخدمة أُنهيت ولم يطلب أحدٌ الإيقاف (أنهاها النظام مثلًا). */
        INTERRUPTED,
    }

    fun stopMessage(reason: StopReason): String = when (reason) {
        StopReason.USER -> "أوقفته أنت. ما جُمع محفوظ صفحة بصفحة."
        StopReason.SYSTEM_TIME_LIMIT ->
            "أوقفه أندرويد بعد حدّ الست ساعات. ما جُمع محفوظ — افتح التطبيق واضغط استأنف."
        StopReason.START_NOT_ALLOWED ->
            "أندرويد ما سمح يبدأ من الخلفية. ما جُمع محفوظ — اضغط استأنف والتطبيق مفتوح."
        StopReason.INTERRUPTED -> "توقّف الإحصاء قبل أن يكمل. ما جُمع محفوظ — اضغط استأنف."
    }
}
