package com.vantara.anime.loader

/** Publisher version codes are authoritative; legacy saved records retain numeric-name fallback. */
internal object AnimeVersionPolicy {
    fun archive(declaredName: String?, declaredCode: Long, actualName: String?, actualCode: Long) {
        require(declaredCode >= 0 && actualCode >= 0 &&
            (declaredName == null || declaredName == actualName) &&
            (declaredCode == 0L || declaredCode == actualCode)) { "ANIYOMI_APK_VERSION_MISMATCH" }
    }
    fun update(previousName: String, previousCode: Long, candidateName: String, candidateCode: Long) {
        val older = if(previousCode > 0 && candidateCode > 0) candidateCode < previousCode else {
            val previous = parts(previousName)
            val candidate = parts(candidateName)
            if(previous == null || candidate == null) false else {
                (0 until maxOf(previous.size,candidate.size)).firstNotNullOfOrNull { i ->
                    (candidate.getOrElse(i) { 0L } - previous.getOrElse(i) { 0L }).takeIf { it != 0L }
                }?.let { it < 0L } ?: false
            }
        }
        require(!older) { "ANIYOMI_DOWNGRADE_REJECTED" }
    }
    private fun parts(value: String): List<Long>? = value.takeIf {
        it.length <= 40 && Regex("\\d{1,9}(?:\\.\\d{1,9}){1,3}").matches(it)
    }?.split('.')?.map { it.toLong() }
}
