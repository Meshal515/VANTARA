package dev.vantara.spike

/**
 * ما تعرضه الشاشة عن الزحف، من إشارتين لا واحدة.
 *
 * الحالة الدائمة تقول ما **كان**؛ حياة الخدمة في هذه العملية تقول ما **يحدث**.
 * والإشارتان تفترقان بعد «إيقاف إجباري» من إعدادات أندرويد: الملف يبقى «يجري»
 * ولا خدمة تجري. وزرٌّ يثق بالملف وحده يعلّق المستخدم أمام «يجري…» إلى الأبد،
 * بلا طريق إلى الاستئناف.
 *
 * فالاسترجاع من هذه الحالة ليس استثناءً يُعالَج: «ابدأ» هو نفسه «استأنف»، لأن
 * نقاط الحفظ صفحةً بصفحة تجعل البدء من جديد يكمل من حيث وقف.
 */
object CatalogueCrawlUiPolicy {
    enum class StartAction { START, ATTACH }

    fun isStale(state: CatalogueCrawlState, liveService: Boolean): Boolean = state.active && !liveService

    fun startAction(state: CatalogueCrawlState, liveService: Boolean): StartAction =
        if (state.active && liveService) StartAction.ATTACH else StartAction.START

    fun buttonText(
        state: CatalogueCrawlState,
        liveService: Boolean,
        sourceCount: Int,
        hasProgress: Boolean,
    ): String = when {
        state.active && liveService -> "أوقف الإحصاء"
        hasProgress || isStale(state, liveService) -> "استأنف إحصاء كل المصادر ($sourceCount)"
        else -> "احصِ كتالوج كل المصادر ($sourceCount) — يطول"
    }

    fun statusText(state: CatalogueCrawlState, liveService: Boolean): String? = when {
        isStale(state, liveService) ->
            "توقّف الإحصاء قبل أن يكمل (أُغلق التطبيق). ما جُمع محفوظ — اضغط استأنف."
        state.active -> buildString {
            append("يجري في الخلفية · ")
            append(state.sourceLabel.ifBlank { "يحضّر المصادر" })
            if (state.page > 0) append(" · صفحة ").append(state.page)
            append(" · ").append(state.uniqueWorks).append(" عملًا")
            if (state.totalSources > 0) {
                append(" · مكتمل ").append(state.completedSources).append('/').append(state.totalSources)
            }
            // الجولة الأولى لا تُذكر: الرقم يعني شيئًا حين يبدأ الرجوع إلى المصادر
            if (state.pass > 1) append(" · الجولة ").append(state.pass)
        }
        state.finished -> state.lastEvent.ifBlank { "اكتمل الإحصاء." }
        state.lastEvent.isNotBlank() -> state.lastEvent
        else -> null
    }
}
