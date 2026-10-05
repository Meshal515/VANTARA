package com.vantara.plugins.translation

/** Same closed enums as the worker; model strings never become asset paths. */
data class LetteringStyle(val role: String = "neutral", val ink: String = "auto", val intensity: String = "normal", val emphasis: List<String> = emptyList()) {
    companion object {
        val roles = listOf("neutral","soft","whisper","thought","narration","formal","regal","ancient","comic","child","rough","threat","villain","shout","scream","impact","mechanical","sign","title","blood")
        val inks = setOf("auto","black","white","crimson","blood","gold","blue","violet","gray")
        val intensities = setOf("quiet","normal","strong","extreme")
        fun normalize(role: String?, ink: String?, intensity: String?, emphasis: List<String>, text: String): LetteringStyle {
            val word = Regex("[\\p{L}\\p{M}\\p{N}_]")
            val spans = emphasis.distinct().filter { part ->
                part.isNotBlank() && part.length <= 120 && Regex(Regex.escape(part)).findAll(text).any { match ->
                    !word.matches(text.getOrNull(match.range.first-1)?.toString() ?: "") && !word.matches(text.getOrNull(match.range.last+1)?.toString() ?: "")
                }
            }.take(3)
            return LetteringStyle(role.takeIf { it in roles } ?: "neutral", ink.takeIf { it in inks } ?: "auto", intensity.takeIf { it in intensities } ?: "normal", spans)
        }
    }
    val bold get() = intensity in setOf("strong","extreme") || emphasis.isNotEmpty()
    fun color(light: Boolean): Int {
        val auto = if (light) 0xFFFFFFFF.toInt() else 0xFF101010.toInt()
        val color = when (ink) {
            "black" -> 0xFF101010; "white" -> 0xFFFFFFFF; "crimson" -> 0xFF9E1635
            "blood" -> 0xFF790F1F; "gold" -> 0xFFE3BB65; "blue" -> 0xFF2758AC
            "violet" -> 0xFF7435A3; "gray" -> 0xFF707070; else -> return auto
        }.toInt()
        val luminance = (299 * ((color shr 16) and 255) + 587 * ((color shr 8) and 255) + 114 * (color and 255)) / 1000
        // Ink must remain visible; source-ink contrast takes precedence over decoration.
        return if (light && luminance < 145 || !light && luminance > 220) auto else color
    }
}
