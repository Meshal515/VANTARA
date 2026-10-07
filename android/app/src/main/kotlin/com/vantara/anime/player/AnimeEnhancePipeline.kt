package com.vantara.anime.player

import androidx.media3.common.Effect
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.LanczosResample

/**
 * Current live pipeline, kept intentionally small and stable:
 *
 * FAST      = safe Media3 Lanczos fallback.
 * BALANCED  = source restore -> adaptive Anime4K reconstruction/upscale.
 * STRONG    = same architecture, resolution-specific tuning uses more of the GPU budget.
 *
 * No export, no cached 1440p file, no temporal buffering. Everything remains frame-by-frame.
 */
@UnstableApi
object AnimeEnhancePipeline {
    fun effects(mode: Anime4kEffect.Mode): List<Effect> = when (mode) {
        Anime4kEffect.Mode.FAST -> listOf(
            LanczosResample.scaleToFit(2560, 1440),
        )

        Anime4kEffect.Mode.BALANCED,
        Anime4kEffect.Mode.STRONG -> listOf(
            AnimeRestoreEffect(mode),
            // PRIMARY keeps the full source-resolution tuning. For 720p/900p/1080p it reaches
            // 1440p directly; FINAL then becomes a no-op. For 320p-576p it stops at <=2x so the
            // second stage can refine to 1440p without one huge blurry jump.
            Anime4kEffect(mode, stage = Anime4kEffect.Stage.PRIMARY),
            Anime4kEffect(mode, stage = Anime4kEffect.Stage.FINAL),
        )
    }

    fun description(mode: Anime4kEffect.Mode): String = when (mode) {
        Anime4kEffect.Mode.FAST -> "Lanczos 1440p"
        Anime4kEffect.Mode.BALANCED -> "Restore + edge reconstruction + 1440p"
        Anime4kEffect.Mode.STRONG -> "Adaptive restore + line reconstruction + 1440p"
    }
}
