package com.vantara.anime.player

object PlaybackWork {
    fun isMovie(section: String, format: String?, total: Int): Boolean =
        if (!format.isNullOrBlank()) format == "MOVIE" else section == "cinema" && total <= 1
}
