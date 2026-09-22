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
}
