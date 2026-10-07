package com.vantara.anime.player

import androidx.media3.common.Effect
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.LanczosResample

/**
 * Stable live enhancement path using only Media3-owned GPU programs.
 *
 * STRONG is genuinely resolution-aware:
 * - <=576p: restore -> 720p -> restore -> 1080p -> restore -> 1440p -> polish
 * - 720p:   restore -> 1080p -> restore -> 1440p -> polish
 * - 900p:   restore -> 1440p -> polish
 * - 1080p:  light restore -> 1440p -> polish
 *
 * This avoids the failing custom GLSL path while still using the S23 GPU budget for staged
 * reconstruction instead of one soft 720p->1440p jump.
 */
@UnstableApi
object AnimeEnhancePipeline {
    fun effects(mode: Anime4kEffect.Mode, sourceHeightHint: Int?): List<Effect> {
        if (mode == Anime4kEffect.Mode.FAST) {
            return listOf(LanczosResample.scaleToFit(2560, 1440))
        }

        val h = sourceHeightHint?.takeIf { it > 0 } ?: 1080
        if (mode == Anime4kEffect.Mode.BALANCED) {
            return listOf(
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.SOURCE_RESTORE),
                LanczosResample.scaleToFit(2560, 1440),
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.FINAL_POLISH),
            )
        }

        return when {
            h <= 576 -> listOf(
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.SOURCE_RESTORE),
                LanczosResample.scaleToFit(1280, 720),
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.MID_RESTORE),
                LanczosResample.scaleToFit(1920, 1080),
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.MID_RESTORE),
                LanczosResample.scaleToFit(2560, 1440),
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.FINAL_POLISH),
            )
            h <= 720 -> listOf(
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.SOURCE_RESTORE),
                LanczosResample.scaleToFit(1920, 1080),
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.MID_RESTORE),
                LanczosResample.scaleToFit(2560, 1440),
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.FINAL_POLISH),
            )
            h <= 900 -> listOf(
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.SOURCE_RESTORE),
                LanczosResample.scaleToFit(2560, 1440),
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.FINAL_POLISH),
            )
            else -> listOf(
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.SOURCE_RESTORE),
                LanczosResample.scaleToFit(2560, 1440),
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.FINAL_POLISH),
            )
        }
    }

    fun description(mode: Anime4kEffect.Mode): String = when (mode) {
        Anime4kEffect.Mode.FAST -> "Media3 Lanczos 1440p"
        Anime4kEffect.Mode.BALANCED -> "Native restore + Lanczos + polish"
        Anime4kEffect.Mode.STRONG -> "Staged native reconstruction + 1440p"
    }
}
