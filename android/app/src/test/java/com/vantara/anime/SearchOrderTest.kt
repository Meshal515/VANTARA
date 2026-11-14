package com.vantara.anime

import org.junit.Assert.assertEquals
import org.junit.Test

/** مصدر في التبريد بعد مهلات (CloudStream على جهاز بارد) يبقى في البحث العام، بعد السليمة لا قبلها. */
class SearchOrderTest {
    private data class S(val id: String, val cooling: Boolean = false, val blocked: Boolean = false)

    @Test fun coolingSourceIsStillSearchedAfterHealthyOnes() {
        val ordered = listOf(S("animerift", cooling = true), S("witanime"), S("akwam", cooling = true), S("anime4up"))
        val (skipped, asked) = AnimeEngine.searchOrder(ordered, { it.cooling }) { it.blocked }
        assertEquals(emptyList<S>(), skipped)
        assertEquals(listOf("witanime", "anime4up", "animerift", "akwam"), asked.map { it.id })
    }

    @Test fun onlyASiteThatBlockedUsIsSkipped() {
        val ordered = listOf(S("a", cooling = true, blocked = true), S("b", cooling = true), S("c"))
        val (skipped, asked) = AnimeEngine.searchOrder(ordered, { it.cooling }) { it.blocked }
        assertEquals(listOf("a"), skipped.map { it.id })
        assertEquals(listOf("c", "b"), asked.map { it.id })
    }
}
