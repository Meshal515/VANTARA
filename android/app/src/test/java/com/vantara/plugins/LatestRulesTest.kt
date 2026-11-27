package com.vantara.plugins

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** قواعد مخزن «آخر التحديثات» في أندرويد تطابق الويب وويندوز (latest-store.test.js يغطي الخلفيتين الأخريين). */
class LatestRulesTest {
    private fun ev(id: String, at: Long, src: String, pinned: Boolean = false) = JSONObject()
        .put("id", id).put("work", "w").put("section", "manga").put("kind", "chapter").put("title", "t")
        .put("at", at).put("firstSeenAt", at).put("sources", JSONArray().put(JSONObject().put("s", src)))
        .put("pinned", pinned).put("origin", if (pinned) "migrated" else "local").put("updatedAt", at)

    @Test fun olderWinsSourcesUnionPinSticks() {
        val m = LatestRules.merge(ev("e", 500, "a", pinned = true), ev("e", 400, "b"))
        assertEquals(400L, m.getLong("at"))
        assertEquals(listOf("a", "b"), (0 until m.getJSONArray("sources").length()).map { m.getJSONArray("sources").getJSONObject(it).getString("s") })
        assertTrue(m.getBoolean("pinned"))
        assertEquals("migrated", m.getString("origin"))
        assertEquals(400L, LatestRules.merge(m, ev("e", 900, "a")).getLong("at"))
    }

    @Test fun newEventIsKeptAsIs() { assertEquals(7L, LatestRules.merge(null, ev("n", 7, "a")).getLong("at")) }

    @Test fun cursorMatchesServerFormat() {
        assertEquals(200L to "x3", LatestRules.cursor("200~x3"))
        assertEquals(5L to "a~b", LatestRules.cursor("5~a~b"))
        assertNull(LatestRules.cursor("bad")); assertNull(LatestRules.cursor("")); assertNull(LatestRules.cursor("12~"))
    }

    @Test fun noDeleteOperationExists() {
        for (m in LatestRules.METHODS) assertFalse(m, Regex("delete|prune|clear|drop|remove", RegexOption.IGNORE_CASE).containsMatchIn(m))
        assertFalse(Regex("DELETE|DROP", RegexOption.IGNORE_CASE).containsMatchIn(LatestRules.SCHEMA))
    }
}
