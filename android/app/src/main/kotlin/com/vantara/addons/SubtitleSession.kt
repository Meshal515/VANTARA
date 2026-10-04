package com.vantara.addons

/** وصول ترجمة لا يملك أمر تشغيل؛ الجيل يمنع نتائج السيرفر/الحلقة السابقة. */
class SubtitleSession {
    var generation: Int = 0
        private set
    var tracks: List<AddonSubtitle> = emptyList()
        private set
    var selection: Int = 0
        private set
    fun select(): Int { selection++; return selection }
    fun current(generation: Int, selection: Int): Boolean = this.generation == generation && this.selection == selection
    fun begin(): Int { generation++; selection++; tracks = emptyList(); return generation }
    fun accept(generation: Int, result: List<AddonSubtitle>): Boolean {
        if (generation != this.generation) return false
        tracks = (tracks + result).distinctBy { it.url }.sortedBy { if (it.lang == "ar") 0 else 1 }
        return true
    }
}
