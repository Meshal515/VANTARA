package com.vantara.runtime
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
class RuntimeOperationHealthTest {
    private val empty=buildJsonObject {put("items",buildJsonArray {})}
    private val blank=JsonObject(emptyMap())
    @Test fun emptySearchAndPaginationAndDeclaredUnsupportedCatalogueAreNeutral() {
        assertEquals(RuntimeOperationHealth.Result.NEUTRAL,RuntimeOperationHealth.assess("search",blank,empty,blank))
        assertEquals(RuntimeOperationHealth.Result.NEUTRAL,RuntimeOperationHealth.assess("catalogue",buildJsonObject {put("page",2)},empty,blank))
        assertEquals(RuntimeOperationHealth.Result.NEUTRAL,RuntimeOperationHealth.assess("catalogue",blank,empty,buildJsonObject {put("hasMainPage",false)}))
    }
    @Test fun emptyLinksWithMissingExtractorsAreNotSuccess() {
        val result=buildJsonObject {put("items",buildJsonArray {});put("missingExtractors",buildJsonArray {add("ExampleHost")})}
        assertEquals(RuntimeOperationHealth.Result.EMPTY,RuntimeOperationHealth.assess("videoLinks",blank,result,blank))
    }
    @Test fun validMediaLinksAndEpisodesAreProductiveButEmptyBaselineIsNot() {
        val result=buildJsonObject {put("items",buildJsonArray {add(buildJsonObject {put("data","episode-data")})})}
        assertEquals(RuntimeOperationHealth.Result.PRODUCTIVE,RuntimeOperationHealth.assess("episodes",blank,result,blank))
        assertEquals(RuntimeOperationHealth.Result.EMPTY,RuntimeOperationHealth.assess("episodes",blank,empty,blank))
    }
}
