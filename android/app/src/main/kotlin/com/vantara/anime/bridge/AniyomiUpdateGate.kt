package com.vantara.anime.bridge

/**
 * Aniyomi publisher updates cannot replace a working content-addressed APK based
 * only on signature, DexClassLoader, or factory registration. Every source in the
 * candidate must pass a bounded actual catalogue request before saving the new
 * metadata. On failure the old source IDs, user library and APK pointer remain.
 */
internal object AniyomiUpdateGate {
    suspend fun verify(
        previousSha: String?,
        candidateSha: String,
        sourceIds: List<String>,
        probe: suspend (String) -> Boolean,
    ) {
        if (previousSha == null || previousSha.equals(candidateSha, ignoreCase = true)) return
        require(sourceIds.isNotEmpty() && sourceIds.toSet().size == sourceIds.size) {
            "ANIYOMI_UPDATE_SOURCE_ID_INVALID"
        }
        for (id in sourceIds) {
            require(probe(id)) {
                "ANIYOMI_UPDATE_PREFLIGHT_FAILED: candidate source $id is not usable"
            }
        }
    }
}
