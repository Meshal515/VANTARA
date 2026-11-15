package com.vantara.runtime

import kotlinx.serialization.json.*

/**
 * Package revisions must preserve published source names: VANTARA source IDs include
 * their exact names. Removing or renaming one silently orphans saved works, reading
 * progress, bookmarks and playback history. Additional source names are allowed.
 */
internal object RuntimeUpdateAdmission {
    fun preserveIds(previousMetadata: JsonObject?, candidateRegistration: JsonObject) {
        if (previousMetadata == null) return
        val oldRegistration = previousMetadata["registration"] as? JsonObject
            ?: throw IllegalArgumentException("RUNTIME_PREVIOUS_REGISTRATION_UNREADABLE")
        val oldSources = oldRegistration["sources"] as? JsonArray
            ?: throw IllegalArgumentException("RUNTIME_PREVIOUS_REGISTRATION_UNREADABLE")
        val newSources = candidateRegistration["sources"] as? JsonArray
            ?: throw IllegalArgumentException("RUNTIME_CANDIDATE_REGISTRATION_UNREADABLE")
        val oldNames = oldSources.map { (it as? JsonObject)?.text("name").orEmpty() }
        val newNames = newSources.map { (it as? JsonObject)?.text("name").orEmpty() }.toSet()
        require(oldNames.all { it.isNotBlank() && it in newNames }) {
            "RUNTIME_SOURCE_REMOVED: update would orphan existing VANTARA stable source IDs"
        }
    }
}
