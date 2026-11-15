package com.vantara.runtime

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

/** One catalogue result alone cannot certify a plugin candidate update.
 * Applies unchanged to cinema MovieLoadResponse and anime episodes. */
class RuntimeCanaryContractTest {
    private val page=buildJsonObject { put("items",buildJsonArray { add(buildJsonObject {
        put("name","Popular");put("list",buildJsonArray { add(buildJsonObject {
            put("name","Example");put("url","https://source.example/work/1")
        }) })
    }) }) }
    private val episode=buildJsonObject { put("items",buildJsonArray {
        add(buildJsonObject {put("name","Watch");put("data","provider-media-data")})
    }) }
    @Test fun acceptsSourceNeutralCinemaAndAnimeFiveStepJourney() {
        assertEquals("https://source.example/work/1",RuntimeCanaryContract.firstWorkUrl(page))
        RuntimeCanaryContract.requireDetails(buildJsonObject {put("item",buildJsonObject {put("name","Example");put("url","https://source.example/work/1")})})
        assertEquals("provider-media-data",RuntimeCanaryContract.firstEpisodeData(episode))
        assertEquals(1,RuntimeCanaryContract.mediaUrls(buildJsonObject { put("items",buildJsonArray {
            add(buildJsonObject {put("url","https://cdn.example/segment.mp4")})
        }) }).size)
    }
    @Test fun missingTitleOrWorkCannotPromoteCandidate() {
        try {RuntimeCanaryContract.firstWorkUrl(buildJsonObject {put("items",buildJsonArray {
            add(buildJsonObject {put("name","Home");put("list",buildJsonArray {})})
        })});fail("Accepted empty home")}catch(expected:IllegalArgumentException){}
    }
    @Test fun missingEpisodesOrBrokenMediaUrlsCannotPromoteCandidate() {
        try {RuntimeCanaryContract.firstEpisodeData(buildJsonObject {put("items",buildJsonArray {})});fail("Accepted zero episodes")}catch(expected:IllegalArgumentException){}
        try {RuntimeCanaryContract.mediaUrls(buildJsonObject {put("items",buildJsonArray {
            add(buildJsonObject { put("url","javascript:alert(1)") })
        })});fail("Accepted non-http media")}catch(expected:IllegalArgumentException){}
        try {RuntimeCanaryContract.mediaUrls(buildJsonObject {put("items",buildJsonArray {})});fail("Accepted no playable links")}catch(expected:IllegalArgumentException){}
    }
}
