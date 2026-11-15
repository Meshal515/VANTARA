package com.vantara.anime.player.together

/**
 * زر «البدء» في غرفة المشاهدة معًا: قرار واحد قابل للاختبار، ورسالة لكل حالة لا يبدأ فيها.
 *
 * خلل «الزر لا يستجيب» (15 نوفمبر): كل رفض كان يمر بلا أثر مرئي — رسالة «نجهّز فيديوك/اختر سيرفرك» تُرسم تحت
 * طبقة الغرفة المعتمة، وفشل إرسال الأمر (اتصال ساقط) يُتجاهل، ورفض الخادم (denied) لا يُعالج، وغرفة لا تردّ لا يُقال
 * عنها شيء. هنا: كل حالة لها نتيجة صريحة، والمشغّل يعرض رسالتها فوق كل الطبقات.
 */
object TogetherStart {
    enum class Gate { SEND, PICK_SERVER, PREPARING, OFFLINE }

    /** ترتيب الأسباب: السيرفر أولًا (لا فيديو بلا سيرفر)، ثم الاتصال، ثم التجهيز. */
    fun gate(ready: Boolean, connected: Boolean, awaitingPick: Boolean): Gate = when {
        awaitingPick -> Gate.PICK_SERVER
        !connected -> Gate.OFFLINE
        !ready -> Gate.PREPARING
        else -> Gate.SEND
    }

    fun message(gate: Gate): String? = when (gate) {
        Gate.PICK_SERVER -> "اختر سيرفرك أول"
        Gate.OFFLINE -> "الاتصال بالغرفة انقطع — نعيد الاتصال…"
        Gate.PREPARING -> "نجهّز فيديوك… «البدء» يتفعّل لحظة جاهزيته"
        Gate.SEND -> null
    }

    /** الأمر لم يُرسل (المقبس مغلق) رغم أن الحالة قالت متصل: سباق انقطاع. */
    const val SEND_FAILED = "ما وصل أمر البدء — الاتصال انقطع، جرّب بعد لحظة"
    /** الخادم رفض: لست المضيف عنده (انتقلت الاستضافة) أو لا تملك التحكم. */
    const val DENIED = "الغرفة رفضت الأمر: التحكم بالتشغيل للمضيف"
    /** أُرسل ولم تصل حالة البدء خلال المهلة. */
    const val NO_REPLY = "الغرفة ما ردّت على «البدء» — جرّب مرة ثانية"
    const val REPLY_TIMEOUT_MS = 5_000L
    /** العدّ التنازلي المشترك المرسل مع أول «البدء». */
    const val COUNTDOWN_MS = 3_000L
}
