package com.vantara.anime.player

/** Ordinary THE ROCK startup stays unchanged; native torrent metadata/pieces have a finite budget. */
object PlaybackBudgets {
    fun startupMs(url: String?): Long = if (url?.startsWith("vantara-torrent:") == true) 90_000L else 15_000L
    fun stalledMs(url: String?): Long = if (url?.startsWith("vantara-torrent:") == true) 35_000L else 20_000L
}
