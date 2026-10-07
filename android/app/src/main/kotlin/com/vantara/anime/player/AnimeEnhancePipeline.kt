package com.vantara.anime.player

import androidx.media3.common.Effect
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.LanczosResample

/**
 * Stable live enhancement path.
 *
 * IMPORTANT:
 * Hand-written GlEffect shaders are intentionally NOT used in the active player path. They were
 * the source of ERROR_CODE_VIDEO_FRAME_PROCESSING_FAILED on the S23/Adreno path. Restoration and
 * final polish now run through Media3's own SeparableConvolutionShaderProgram, while scaling uses
 * Media3's LanczosResample.
 *
 * FAST      = Lanczos 1440p only.
 * BALANCED  = adaptive source restore -> Lanczos 1440p -> light final polish.
 * STRONG    = stronger resolution-aware restore -> Lanczos 1440p -> stronger final polish.
 */
@UnstableApi
object AnimeEnhancePipeline {
    fun effects(mode: Anime4kEffect.Mode): List<Effect> = when (mode) {
        Anime4kEffect.Mode.FAST -> listOf(
            LanczosResample.scaleToFit(2560, 1440),
        )

        Anime4kEffect.Mode.BALANCED,
        Anime4kEffect.Mode.STRONG -> listOf(
            AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.SOURCE_RESTORE),
            LanczosResample.scaleToFit(2560, 1440),
            AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.FINAL_POLISH),
        )
    }

    fun description(mode: Anime4kEffect.Mode): String = when (mode) {
        Anime4kEffect.Mode.FAST -> "Media3 Lanczos 1440p"
        Anime4kEffect.Mode.BALANCED -> "Native restore + Lanczos + polish"
        Anime4kEffect.Mode.STRONG -> "Adaptive native restore + Lanczos + polish"
    }
}
