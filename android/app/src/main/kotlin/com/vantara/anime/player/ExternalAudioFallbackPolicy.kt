package com.vantara.anime.player

enum class ExternalAudioFallbackReason {
    BEFORE_OUTPUT_SOURCE_ERROR,
    BEFORE_OUTPUT_TIMEOUT,
    EXTERNAL_AUDIO_REQUEST_FAILED,
    EXTERNAL_AUDIO_MERGE_FAILED,
    EXTERNAL_AUDIO_DECODE_FAILED,
}

/** Caller retains retry state for the candidate attempt and resumes at its existing position. */
object ExternalAudioFallbackPolicy {
    fun decision(externalAudioUrls: Set<String>, alreadyRetried: Boolean, hasOutput: Boolean, isSourceError: Boolean,
        failingUris: Set<String> = emptySet(), isAudioMergeFailure: Boolean = false, isAudioRendererFailure: Boolean = false, isStartupTimeout: Boolean = false): ExternalAudioFallbackReason? {
        if (externalAudioUrls.isEmpty() || alreadyRetried) return null
        if (isStartupTimeout) return if (!hasOutput) ExternalAudioFallbackReason.BEFORE_OUTPUT_TIMEOUT else null
        if (!isSourceError && !isAudioRendererFailure) return null
        return when {
            isAudioRendererFailure -> ExternalAudioFallbackReason.EXTERNAL_AUDIO_DECODE_FAILED
            isAudioMergeFailure -> ExternalAudioFallbackReason.EXTERNAL_AUDIO_MERGE_FAILED
            failingUris.any { it in externalAudioUrls } -> ExternalAudioFallbackReason.EXTERNAL_AUDIO_REQUEST_FAILED
            !hasOutput -> ExternalAudioFallbackReason.BEFORE_OUTPUT_SOURCE_ERROR
            else -> null
        }
    }
}
