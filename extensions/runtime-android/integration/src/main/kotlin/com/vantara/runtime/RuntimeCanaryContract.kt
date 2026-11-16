package com.vantara.runtime

import kotlinx.serialization.json.*
import java.net.URI

/** Fail-closed, source-neutral published-plugin health contract for both anime and cinema.
 * This proves a real catalogue → details → episode → declared media-link chain.
 * A URL is not decoded-frame or media-byte evidence; separate PlayerActivity QA is required.
 */
internal object RuntimeCanaryContract {
    fun firstWorkUrl(catalogue: JsonObject): String {
        val sections=catalogue["items"] as? JsonArray
            ?: throw IllegalArgumentException("CANDIDATE_CATALOGUE_INVALID")
        val first=sections.asSequence()
            .mapNotNull { (it as? JsonObject)?.get("list") as? JsonArray }
            .flatMap { it.asSequence() }
            .mapNotNull { it as? JsonObject }
            .firstOrNull { it.text("name").isNotBlank() && it.text("url").isNotBlank() && it.text("url").length <= 8192 }
            ?: throw IllegalArgumentException("CANDIDATE_CATALOGUE_EMPTY")
        return first.text("url")
    }
    fun requireDetails(details: JsonObject) {
        val item=details["item"] as? JsonObject
            ?: throw IllegalArgumentException("CANDIDATE_DETAILS_INVALID")
        require(item.text("name").isNotBlank() || item.text("url").isNotBlank()) {
            "CANDIDATE_DETAILS_EMPTY"
        }
    }
    fun firstEpisodeData(episodes: JsonObject): String {
        val items=episodes["items"] as? JsonArray
            ?: throw IllegalArgumentException("CANDIDATE_EPISODES_INVALID")
        return items.asSequence().mapNotNull { it as? JsonObject }
            .map { it.text("data") }.firstOrNull { it.isNotBlank() }
            ?: throw IllegalArgumentException("CANDIDATE_EPISODES_EMPTY")
    }
    fun mediaUrls(videoLinks: JsonObject): List<String> {
        val items=videoLinks["items"] as? JsonArray
            ?: throw IllegalArgumentException("CANDIDATE_LINKS_INVALID")
        val urls=items.mapNotNull { (it as? JsonObject)?.text("url") }
            .filter { safeHttpUrl(it) }.distinct()
        require(urls.isNotEmpty()) { "CANDIDATE_LINKS_EMPTY" }
        return urls
    }
    private fun safeHttpUrl(value: String): Boolean = runCatching {
        if(value.length !in 1..8192)return@runCatching false
        val uri=URI(value)
        uri.scheme?.lowercase() in setOf("https","http") &&
            !uri.host.isNullOrBlank() && uri.userInfo==null
    }.getOrDefault(false)
}
