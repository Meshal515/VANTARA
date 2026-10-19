package com.vantara.anime.player

object MomentRecipients {
    fun <T> faces(friends: List<T>): List<T> = friends.take(3)
    fun remaining(count: Int): Int = (count - 3).coerceAtLeast(0)
}
