package com.vantara.anime.player

import org.junit.Assert.*
import org.junit.Test

class ExternalAudioFallbackPolicyTest {
    private val audio = setOf("https://cdn.example/voice.m4a?sig=1")
    @Test fun sourceFailureBeforeOutputGetsOneRetryWithoutBlamingEitherRequest() {
        assertEquals(ExternalAudioFallbackReason.BEFORE_OUTPUT_SOURCE_ERROR,
            ExternalAudioFallbackPolicy.decision(audio, false, false, true))
        assertNull(ExternalAudioFallbackPolicy.decision(audio, true, false, true))
    }
    @Test fun sourceFailureAfterOutputNeedsEvidenceOfASidecarFailure() {
        assertNull(ExternalAudioFallbackPolicy.decision(audio, false, true, true))
        assertNull(ExternalAudioFallbackPolicy.decision(audio, false, true, true, setOf("https://cdn.example/primary.mp4")))
        assertEquals(ExternalAudioFallbackReason.EXTERNAL_AUDIO_REQUEST_FAILED,
            ExternalAudioFallbackPolicy.decision(audio, false, true, true, audio))
    }
    @Test fun mergeAndExplicitNoAudioErrorsAllowFallbackAfterOutput() {
        assertEquals(ExternalAudioFallbackReason.EXTERNAL_AUDIO_MERGE_FAILED,
            ExternalAudioFallbackPolicy.decision(audio, false, true, true, isAudioMergeFailure = true))
    }
    @Test fun decoderErrorsAndCandidatesWithoutSidecarsNeverFallback() {
        assertNull(ExternalAudioFallbackPolicy.decision(audio, false, false, false, audio, true))
        assertNull(ExternalAudioFallbackPolicy.decision(emptySet(), false, false, true, isAudioMergeFailure = true))
    }
    @Test fun retryIsOneShotEvenForAnAttributedFailure() {
        assertNull(ExternalAudioFallbackPolicy.decision(audio, true, true, true, audio, true))
    }
    @Test fun signedUrlAttributionDoesNotMatchAnotherSignatureOrJustTheHost() {
        assertNull(ExternalAudioFallbackPolicy.decision(audio, false, true, true, setOf("https://cdn.example/voice.m4a?sig=2")))
    }
    @Test fun explicitlyIdentifiedExternalAudioDecoderCanRecoverWithoutHidingPrimaryDecoderErrors() {
        assertEquals(ExternalAudioFallbackReason.EXTERNAL_AUDIO_DECODE_FAILED,
            ExternalAudioFallbackPolicy.decision(audio, false, true, false, isAudioRendererFailure = true))
        assertNull(ExternalAudioFallbackPolicy.decision(audio, true, true, false, isAudioRendererFailure = true))
        assertNull(ExternalAudioFallbackPolicy.decision(emptySet(), false, true, false, isAudioRendererFailure = true))
        assertNull(ExternalAudioFallbackPolicy.decision(audio, false, true, false))
    }

    @Test fun optionalAudioStartupTimeoutGetsOnePrimaryOnlyTrialWithoutBlamingTheSidecar() {
        assertEquals(ExternalAudioFallbackReason.BEFORE_OUTPUT_TIMEOUT,
            ExternalAudioFallbackPolicy.decision(audio, false, false, false, isStartupTimeout = true))
        assertNull(ExternalAudioFallbackPolicy.decision(audio, true, false, false, isStartupTimeout = true))
        assertNull(ExternalAudioFallbackPolicy.decision(audio, false, true, false, isStartupTimeout = true))
        assertNull(ExternalAudioFallbackPolicy.decision(emptySet(), false, false, false, isStartupTimeout = true))
    }

}
