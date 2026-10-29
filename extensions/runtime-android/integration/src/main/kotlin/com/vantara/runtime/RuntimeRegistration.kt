package com.vantara.runtime

import dev.vantara.runtime.android.AndroidRuntimeClient
import dev.vantara.runtime.http.HttpBroker
import kotlinx.serialization.json.*
import okhttp3.HttpUrl.Companion.toHttpUrl

internal object RuntimeRegistration {
    @JvmStatic fun validate(registration: JsonObject,pkg: String): JsonArray {
        val sources=registration["sources"] as? JsonArray ?: error("NO_REGISTERED_SOURCES")
        require(sources.size in 1..32) { "SOURCE_COUNT_LIMIT" }
        val ids=hashSetOf<String>()
        for(raw in sources) {
            val source=raw.jsonObject;val name=source.text("name")
            require(name.isNotBlank() && name.length<=160) { "INVALID_SOURCE_NAME" }
            require(ids.add(RuntimeHost.sourceId(pkg,name))) { "DUPLICATE_SOURCE_ID" }
            val url=source.text("mainUrl").toHttpUrl()
            require(url.isHttps && url.username.isEmpty() && url.password.isEmpty() && url.fragment==null) { "INVALID_ENDPOINT" }
            // Validate the actual worker-origin contract before any installed pointer is changed.
            AndroidRuntimeClient.Scope("cloudstream",pkg,RuntimeHost.sourceId(pkg,name),"registration",setOf(HttpBroker.origin(url)))
        }
        return sources
    }
}
