package com.vantara.anime.player

/**
 * متى يكتمل شعار التحميل ويختفي. قبل أول إطار: عند الإطار الحقيقي وحده (READY قد يسبقه والشاشة
 * سوداء)، إلا ملفًا بلا مسار فيديو فلا إطار سيأتي. بعد بدء المشاهدة (تقطيع/قفز): عند READY كالمعتاد.
 */
internal object StartupReveal {
    fun hideOnReady(firstFrameShown: Boolean, hasVideo: Boolean): Boolean = firstFrameShown || !hasVideo
    /**
     * أول إطار في بدء التشغيل يكشف الصورة فورًا ولو لم يصل READY. الحدث نفسه يأتي بعد كل قفزة:
     * هناك يبقى سلوك التحميل المعتاد (يُخفى عند READY) حتى لا يختفي مؤشر الانتظار قبل الجاهزية.
     */
    fun hideOnFirstFrame(startup: Boolean, ready: Boolean): Boolean = startup || ready
}
