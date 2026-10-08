package com.vantara.anime.player

import androidx.media3.common.Effect
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.LanczosResample

/**
 * Strong now means reconstruction, not cosmetic sharpening.
 *
 * Reconstruction tier:
 * - <=360p      -> Anime4K-style reconstruct to 720p, then display-fit to 1440p
 * - 480-576p    -> reconstruct to 1080p, then display-fit to 1440p
 * - 720p        -> reconstruct directly to 1440p
 * - 900/1080p   -> reconstruct/refine directly to the 1440p device cap
 *
 * The last Lanczos pass for 720/1080 intermediate surfaces is only display fitting. The visible
 * structure/line recovery is done in Anime4kEffect, not by the scaler.
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
                Anime4kEffect(mode, stage = Anime4kEffect.Stage.PRIMARY),
                LanczosResample.scaleToFit(2560, 1440),
            )
        }

        // STRONG: actual line/detail reconstruction is the scale-changing stage.
        // Low-resolution cleanup happens before it; no "0.1% final polish" is used as the result.
        return when {
            h <= 360 -> listOf(
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.SOURCE_RESTORE),
                Anime4kEffect(mode, stage = Anime4kEffect.Stage.PRIMARY), // -> 720p
                LanczosResample.scaleToFit(2560, 1440),
            )
            h <= 576 -> listOf(
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.SOURCE_RESTORE),
                Anime4kEffect(mode, stage = Anime4kEffect.Stage.PRIMARY), // -> 1080p
                LanczosResample.scaleToFit(2560, 1440),
            )
            else -> listOf(
                AnimeNativeDetailEffect(mode, AnimeNativeDetailEffect.Stage.SOURCE_RESTORE),
                Anime4kEffect(mode, stage = Anime4kEffect.Stage.PRIMARY), // -> 1440p cap
            )
        }
    }

    fun description(mode: Anime4kEffect.Mode): String = when (mode) {
        Anime4kEffect.Mode.FAST -> "Lanczos display upscale"
        Anime4kEffect.Mode.BALANCED -> "Anime reconstruction + 1440p display"
        Anime4kEffect.Mode.STRONG -> "Source-tier Anime4K reconstruction"
    }
}
