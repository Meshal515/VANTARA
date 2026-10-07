package com.vantara.anime.player

import androidx.media3.common.Effect
import androidx.media3.common.util.UnstableApi

/**
 * Single-pass wrapper for the live anime enhancer.
 *
 * Previous debug builds chained cleanup -> upscale -> finish as separate GL effects. On some
 * devices that forced several large intermediate frame buffers and could stall the video graph.
 * This build intentionally uses one fused pass, so a server is never penalized for an effect issue.
 */
@UnstableApi
object AnimeEnhancePipeline {
    fun effects(mode: Anime4kEffect.Mode): List<Effect> = listOf(Anime4kEffect(mode))

    fun description(mode: Anime4kEffect.Mode): String = when (mode) {
        Anime4kEffect.Mode.FAST -> "1440p + حواف أوضح"
        Anime4kEffect.Mode.BALANCED -> "تنظيف + Restore + وضوح + 1440p"
        Anime4kEffect.Mode.STRONG -> "تنظيف + Restore قوي + وضوح مرتفع + 1440p"
    }
}
