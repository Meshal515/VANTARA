package com.vantara.plugins.translation

/**
 * Cost-aware selective router for one translation ROI.
 *
 * Safety is gate-based: the score is telemetry, never permission to cross an
 * existing production safety floor. Costs are S23 Ultra service-demand
 * estimates from the current benchmark and only order fallbacks; they do not
 * relax whitening or OCR rules.
 */
object FastRoiRouter {
    enum class Lane { FAST, CTD, BUBBLE, RESCUE }

    data class Features(
        val detectorConfidence: Float,
        val ocrConfidence: Float,
        val holderContainment: Float,
        val backgroundSpread: Float,
        val edgeDensity: Float,
        val maskConfidence: Float,
        val overlap: Float,
        val glyphCoverage: Float,
        val speechLike: Boolean,
    )

    data class Verdict(
        val lane: Lane,
        val confidence: Float,
        val estimatedServiceMs: Int,
        val rejectionReasons: List<String>,
    )

    // Existing production safety floors, centralized so tests pin them.
    const val OCR_MIN = 0.62f
    const val HOLDER_CONTAINMENT_MIN = 0.88f // existing production holder-containment gate
    const val BACKGROUND_SPREAD_MAX = 7.5f
    const val MASK_CONFIDENCE_MIN = 0.84f
    const val GLYPH_COVERAGE_MIN = 0.25f // same retention floor used by refineGlyph
    const val MAJORITY_OVERLAP = 0.50f
    const val MAJORITY_EDGE_DENSITY = 0.50f

    // S23 Ultra observed service-demand midpoints: Fast ~0.13s, CTD 1.7–3.8s,
    // BubbleSeg 5.2–10.7s. Bubble/Rescue include upstream CTD work; coverage rescue
    // must not invent another model call when it reuses already-computed masks.
    private const val FAST_COST_MS = 130
    private const val CTD_COST_MS = 2_750
    private const val BUBBLE_COST_MS = 10_700
    private const val RESCUE_COST_MS = 10_700

    fun classifyAll(features: List<Features>): List<Verdict> = features.map(::classify)

    fun classify(f: Features): Verdict {
        val reasons = ArrayList<String>(6)
        if (f.detectorConfidence < Regions.MIN_SCORE) reasons += "detector"
        if (f.ocrConfidence < OCR_MIN) reasons += "ocr"
        if (f.glyphCoverage < GLYPH_COVERAGE_MIN) reasons += "glyph_coverage"
        if (f.backgroundSpread > BACKGROUND_SPREAD_MAX) reasons += "background"
        if (f.maskConfidence < MASK_CONFIDENCE_MIN) reasons += "mask"
        if (f.edgeDensity >= MAJORITY_EDGE_DENSITY) reasons += "edges"
        if (f.speechLike && f.holderContainment < HOLDER_CONTAINMENT_MIN) reasons += "holder"
        if (f.overlap >= MAJORITY_OVERLAP) reasons += "overlap"

        val lane = when {
            "detector" in reasons || "overlap" in reasons -> Lane.RESCUE
            reasons.isEmpty() -> Lane.FAST
            f.speechLike && reasons.any { it == "holder" || it == "background" || it == "mask" || it == "edges" } -> Lane.BUBBLE
            else -> Lane.CTD
        }
        val cost = when (lane) {
            Lane.FAST -> FAST_COST_MS
            Lane.CTD -> CTD_COST_MS
            Lane.BUBBLE -> BUBBLE_COST_MS
            Lane.RESCUE -> RESCUE_COST_MS
        }
        return Verdict(lane, confidence(f), cost, reasons)
    }

    /**
     * Confidence is a monotone margin summary for telemetry/risk-coverage plots.
     * It is intentionally NOT thresholded to grant Fast; hard gates above decide.
     */
    private fun confidence(f: Features): Float {
        fun up(value: Float, floor: Float): Float =
            ((value - floor) / (1f - floor)).coerceIn(0f, 1f)
        fun down(value: Float, ceiling: Float): Float =
            (1f - value / ceiling).coerceIn(0f, 1f)

        val terms = floatArrayOf(
            up(f.detectorConfidence, Regions.MIN_SCORE),
            up(f.ocrConfidence, OCR_MIN),
            if (f.speechLike) up(f.holderContainment, HOLDER_CONTAINMENT_MIN) else 1f,
            down(f.backgroundSpread, BACKGROUND_SPREAD_MAX),
            (1f - f.edgeDensity).coerceIn(0f, 1f),
            up(f.maskConfidence, MASK_CONFIDENCE_MIN),
            down(f.overlap, MAJORITY_OVERLAP),
            up(f.glyphCoverage, GLYPH_COVERAGE_MIN),
        )
        return (terms.sum() / terms.size).coerceIn(0f, 1f)
    }
}
