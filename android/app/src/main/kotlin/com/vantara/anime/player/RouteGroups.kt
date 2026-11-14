package com.vantara.anime.player

import com.vantara.anime.stream.Route
import com.vantara.anime.stream.RouteState

/** تجميع السيرفرات للورقة (المشغّل والواجهة بنفس القاعدة). */
object RouteGroups {
    /** المصدر وMedia3 يحددان الارتفاع؛ لا نغيّره إلى درجة مفترضة. */
    fun bucket(q: Int?): Int? = q?.takeIf { it > 0 }

    /** [(«1080p»، سيرفرات)…] من الأعلى، ثم غير المحددة، وغير المتاحة في الآخر. */
    fun group(routes: List<Route>): List<Pair<String, List<Route>>> {
        val usable = routes.filter { it.state != RouteState.UNAVAILABLE }
        val out = mutableListOf<Pair<String, List<Route>>>()
        usable.groupBy { bucket(it.quality) }
            .toSortedMap(compareByDescending<Int?> { it ?: -1 })
            .forEach { (b, list) -> out += (b?.let { "${it}p" } ?: "جودة غير محددة") to list.sortedBy { order(it.state) } }
        val dead = routes.filter { it.state == RouteState.UNAVAILABLE }
        if (dead.isNotEmpty()) out += "غير متاح" to dead
        return out
    }

    private fun order(s: RouteState) = when (s) {
        RouteState.READY -> 0
        RouteState.RESOLVING -> 1
        RouteState.FAILED -> 2
        RouteState.UNAVAILABLE -> 3
    }
}
