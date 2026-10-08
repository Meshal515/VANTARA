package com.vantara.anime.player

import androidx.media3.common.Effect
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.LanczosResample

/**
 * Stable live enhancement graph.
 *
 * IMPORTANT:
 * The hand-written Anime4kEffect shader is NOT used by the active player path anymore. On the
 * S23/Adreno path it repeatedly triggered VIDEO_FRAME_PROCESSING_FAILED and forced Strong back
 * to FAST. Strong is now an all-Media3 graph so it can actually stay enabled.
 *
 * Source-tier reconstruction policy:
 * - <=360p   : restore -> 720p -> restore -> 1440p -> polish
 * - 480-576p : restore -> 1080p -> restore -> 1440p -> polish
 * - 720p     : restore -> 1440p -> restore/polish
 * - 900/1080p: restore -> 1440p -> polish
 *
 * This is not the upstream Anime4K CNN model. It is a stable staged reconstruction path using
 * Media3-owned GPU programs while the true Anime4K shader backend remains disabled.
 */
@UnstableApi
object AnimeEnhancePipeline {
    fun effects(mode: Anime4kEffect.Mode, sourceHeightHint: Int?): List<Effect> {
        if (mode == Anime4kEffect.Mode.FAST) {
            return listOf(
                LanczosResample.scaleToFit(2560, 1440),
            )
        }

        val h = sourceHeightHint?.takeIf { it > 0 } ?: 1080

        if (mode == Anime4kEffect.Mode.BALANCED) {
            return when {
                h <= 576 -> listOf(
                    AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.SOURCE_RESTORE),
                    LanczosResample.scaleToFit(1920, 1080),
                    AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.MID_RESTORE),
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

        return when {
            h <= 360 -> listOf(
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.SOURCE_RESTORE),
                LanczosResample.scaleToFit(1280, 720),
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.MID_RESTORE),
                LanczosResample.scaleToFit(2560, 1440),
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.FINAL_POLISH),
            )
            h <= 576 -> listOf(
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.SOURCE_RESTORE),
                LanczosResample.scaleToFit(1920, 1080),
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.MID_RESTORE),
                LanczosResample.scaleToFit(2560, 1440),
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.FINAL_POLISH),
            )
            h <= 720 -> listOf(
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.SOURCE_RESTORE),
                LanczosResample.scaleToFit(2560, 1440),
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.MID_RESTORE),
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
        Anime4kEffect.Mode.FAST -> "Lanczos 1440p"
        Anime4kEffect.Mode.BALANCED -> "Staged native restore + 1440p"
        Anime4kEffect.Mode.STRONG -> "Strong staged native reconstruction"
    }
}
