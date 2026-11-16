package com.vantara.runtime

import kotlinx.serialization.json.*
import okhttp3.HttpUrl.Companion.toHttpUrl

/** Index metadata is separate from the SHA-derived package storage identifier. */
internal object RuntimeRepositoryEntry {
    @JvmStatic fun decode(value:JsonObject,repository:String,repositoryName:String):JsonObject {
        val name=value.text("internalName")
        // CloudStream internalName is an opaque label, not a Java namespace or
        // filesystem path. Keep its exact bytes for existing package identities.
        require(name.length in 1..160 && name.isNotBlank() && name==name.trim() &&
            name.none { it.isISOControl() || it=='/' || it=='\\' }) { "INVALID_PACKAGE_ID" }
        val raw=value.text("url")
        // HttpUrl encodes legal path/query spaces before the existing strict
        // fetch/broker policy sees this URL; controls remain forbidden.
        require(raw.length in 1..8192 && raw==raw.trim() && raw.none { it.isISOControl() }) { "INVALID_ENDPOINT" }
        val url=runCatching { raw.toHttpUrl() }.getOrElse { throw IllegalArgumentException("INVALID_ENDPOINT") }
        require(url.isHttps && url.username.isEmpty() && url.password.isEmpty() && url.fragment==null) { "INVALID_ENDPOINT" }
        return JsonObject(value+mapOf("pkg" to JsonPrimitive(RuntimeHost.packageId(repository,name)),
            "repoName" to JsonPrimitive(repositoryName),"repoUrl" to JsonPrimitive(repository),"url" to JsonPrimitive(url.toString())))
    }
}
