package com.vantara.anime.player

import androidx.media3.common.Effect
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Contrast
import androidx.media3.effect.HslAdjustment
import androidx.media3.effect.LanczosResample

/**
 * Safe live anime enhancement path.
 *
 * IMPORTANT:
 * The previous custom Anime4K GlShaderProgram proved unstable on the target phone during
 * ExoPlayer preview and could stall the video graph. Until that shader path is debugged with
 * device GL logs, production playback uses Media3's own GPU effects only.
 *
 * This is still frame-by-frame and still renders a true 2560x1440 processing surface for
 * 16:9 sources. No download, export or pre-generated 1440p file is involved.
 */
@UnstableApi
object AnimeEnhancePipeline {
    fun effects(mode: Anime4kEffect.Mode): List<Effect> {
        val out = ArrayList<Effect>(3)

        // Media3's native GPU Lanczos path is substantially safer than our custom shader and gives
        // a visibly crisper 1080p -> 1440p resample than the normal display scaler.
        out += LanczosResample.scaleToFit(2560, 1440)

        when (mode) {
            Anime4kEffect.Mode.FAST -> Unit
            Anime4kEffect.Mode.BALANCED -> {
                out += Contrast(0.018f)
                out += HslAdjustment.Builder().adjustSaturation(2.5f).build()
            }
            Anime4kEffect.Mode.STRONG -> {
                out += Contrast(0.035f)
                out += HslAdjustment.Builder().adjustSaturation(4.5f).build()
            }
        }
        return out
    }

    fun description(mode: Anime4kEffect.Mode): String = when (mode) {
        Anime4kEffect.Mode.FAST -> "Lanczos 1440p"
        Anime4kEffect.Mode.BALANCED -> "Lanczos 1440p + وضوح لوني خفيف"
        Anime4kEffect.Mode.STRONG -> "Lanczos 1440p + وضوح أعلى"
    }
}
