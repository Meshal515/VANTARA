package com.vantara.anime.player

import kotlin.math.roundToInt

/**
 * Resolution-aware tuning for the live anime enhancer.
 *
 * Every common source tier has its own reconstruction budget. Values are deliberately strongest
 * below 720p, while 1080p is treated as polishing rather than reconstruction.
 */
data class AnimeEnhanceTuning(
    val cleanup: Float,
    val deblur: Float,
    val lineRestore: Float,
    val antiAlias: Float,
    val detail: Float,
    val dither: Float,
    val secondRing: Float,
)

object AnimeQualityTuning {
    private data class Knot(
        val h: Int,
        val cleanup: Float,
        val deblur: Float,
        val line: Float,
        val aa: Float,
        val detail: Float,
        val dither: Float,
        val secondRing: Float,
    )

    private val knots = listOf(
        //      h    clean deblur line   aa     detail dither ring2
        // Strong is intentionally reconstruction-first now. Anti-ringing is enforced in shader,
        // so 1080p no longer receives an almost invisible "polish" preset.
        Knot( 320, 0.78f, 0.95f, 1.00f, 0.88f, 0.76f, 0.34f, 0.86f),
        Knot( 360, 0.74f, 0.90f, 0.99f, 0.84f, 0.72f, 0.31f, 0.82f),
        Knot( 480, 0.64f, 0.82f, 0.96f, 0.76f, 0.66f, 0.27f, 0.76f),
        Knot( 540, 0.58f, 0.76f, 0.93f, 0.70f, 0.62f, 0.24f, 0.70f),
        Knot( 576, 0.54f, 0.71f, 0.90f, 0.66f, 0.60f, 0.22f, 0.66f),
        Knot( 720, 0.38f, 0.56f, 0.88f, 0.58f, 0.54f, 0.17f, 0.56f),
        Knot( 900, 0.24f, 0.39f, 0.78f, 0.44f, 0.44f, 0.12f, 0.42f),
        Knot(1080, 0.15f, 0.29f, 0.70f, 0.34f, 0.36f, 0.08f, 0.34f),
    )

    fun forSourceHeight(height: Int, mode: Anime4kEffect.Mode): AnimeEnhanceTuning {
        val h = height.coerceAtLeast(1)
        val base = interpolate(h)
        val multiplier = when (mode) {
            Anime4kEffect.Mode.FAST -> 0.55f
            Anime4kEffect.Mode.BALANCED -> 0.82f
            Anime4kEffect.Mode.STRONG -> 1.00f
        }
        return AnimeEnhanceTuning(
            cleanup = (base.cleanup * multiplier).coerceAtMost(0.82f),
            deblur = (base.deblur * multiplier).coerceAtMost(0.95f),
            lineRestore = (base.lineRestore * multiplier).coerceAtMost(1.00f),
            antiAlias = (base.antiAlias * multiplier).coerceAtMost(0.82f),
            detail = (base.detail * multiplier).coerceAtMost(0.72f),
            // Dither should not disappear in balanced mode because gradient protection is structural.
            dither = (base.dither * (0.75f + 0.25f * multiplier)).coerceAtMost(0.38f),
            secondRing = (base.secondRing * multiplier).coerceAtMost(0.85f),
        )
    }

    fun profileName(height: Int): String = when {
        height <= 320 -> "320p reconstruction"
        height <= 360 -> "360p reconstruction"
        height <= 480 -> "480p reconstruction"
        height <= 540 -> "540p reconstruction"
        height <= 576 -> "576p reconstruction"
        height <= 720 -> "720p restore"
        height <= 900 -> "900p refine"
        else -> "1080p → 1440p reconstruction"
    }

    /** Human-readable percentage of the reconstruction aggressiveness for debug telemetry. */
    fun reconstructionPercent(height: Int, mode: Anime4kEffect.Mode): Int =
        (forSourceHeight(height, mode).lineRestore * 100f).roundToInt()

    private fun interpolate(height: Int): AnimeEnhanceTuning {
        if (height <= knots.first().h) return knots.first().toTuning()
        if (height >= knots.last().h) return knots.last().toTuning()

        val upperIndex = knots.indexOfFirst { height <= it.h }
        val a = knots[upperIndex - 1]
        val b = knots[upperIndex]
        val t = (height - a.h).toFloat() / (b.h - a.h).toFloat()
        fun lerp(x: Float, y: Float) = x + (y - x) * t
        return AnimeEnhanceTuning(
            cleanup = lerp(a.cleanup, b.cleanup),
            deblur = lerp(a.deblur, b.deblur),
            lineRestore = lerp(a.line, b.line),
            antiAlias = lerp(a.aa, b.aa),
            detail = lerp(a.detail, b.detail),
            dither = lerp(a.dither, b.dither),
            secondRing = lerp(a.secondRing, b.secondRing),
        )
    }

    private fun Knot.toTuning() = AnimeEnhanceTuning(
        cleanup = cleanup,
        deblur = deblur,
        lineRestore = line,
        antiAlias = aa,
        detail = detail,
        dither = dither,
        secondRing = secondRing,
    )
}
