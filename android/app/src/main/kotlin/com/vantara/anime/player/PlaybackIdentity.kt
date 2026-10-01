package com.vantara.anime.player

/** The same native player serves both sections; coverage never crosses seasons. */
data class PlaybackIdentity(
    val content: String = "anime",
    val contentId: String,
    val mediaType: String? = null,
    val season: Int = 1,
) {
    val isCinema: Boolean get() = content == "cinema"
    val section: String get() = if (isCinema) "cinema" else "anime"
    val seriesRef: String get() = if (isCinema) "cinema:${if (mediaType == "movie") "movie" else "series"}:$contentId" else "anime:$contentId"

    fun unit(episode: Float): String {
        if (!isCinema) return "anime:$contentId:$episode"
        if (mediaType == "movie") return "cinema:$contentId:movie"
        val number = if (episode == episode.toInt().toFloat()) episode.toInt().toString() else episode.toString()
        return "cinema:$contentId:s${season.coerceAtLeast(1)}:e$number"
    }
    fun coverageKey(user: String?, episode: Float): String =
        if (isCinema) "coverage:${user.orEmpty()}:${unit(episode)}"
        else "coverage:${user.orEmpty()}:$contentId:$episode"
}
