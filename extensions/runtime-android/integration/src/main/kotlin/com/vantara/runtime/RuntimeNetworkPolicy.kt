package com.vantara.runtime

import dev.vantara.runtime.http.HttpBroker
import okhttp3.HttpUrl.Companion.toHttpUrl
import dev.vantara.runtime.api.RuntimeHttpAccess
import kotlinx.serialization.json.*

/** Reviewed dependency origins belong to exact archive bytes, never a display name.
 * Updated/unreviewed packages retain their declared origin; no wildcard grants. */
internal object RuntimeNetworkPolicy {
    private const val WITCHER="4c639f9392d46e45f4ee84e8799c810cc1d11fba2f13ff7e32865c71987c2fb4"
    @JvmStatic fun sourceOrigins(hash:String,mainUrl:String):Set<String> {
        val url=mainUrl.toHttpUrl()
        require(url.isHttps && url.username.isEmpty() && url.password.isEmpty()) { "INVALID_ENDPOINT" }
        val own=HttpBroker.origin(url)
        return if(hash==WITCHER && own=="https://animewitcher.com")
            setOf(own,"https://d8lh9i7zl7-dsn.algolia.net","https://firestore.googleapis.com")
        else setOf(own)
    }
    fun sourceOrigins(hash:String,mainUrl:String,attested:String?):Set<String> {
        val base=sourceOrigins(hash,mainUrl)
        if(hash!=WITCHER || HttpBroker.origin(mainUrl.toHttpUrl())!="https://animewitcher.com" || attested==null ||
            !attested.matches(Regex("https://[a-z0-9]{10}-dsn\\.algolia\\.net")))return base
        // Retire the bootstrap application instead of repeatedly sending its
        // stale key after the source has published replacement settings.
        return (base-"https://d8lh9i7zl7-dsn.algolia.net")+attested
    }
    /** Only a successful TLS response from this reviewed source's own settings
     * document can attest its replacement Algolia application. No wildcard. */
    @JvmStatic fun trustedSettingsOrigin(hash:String,mainUrl:String,request:RuntimeHttpAccess.Request,response:RuntimeHttpAccess.Response):String? {
        if(hash!=WITCHER || HttpBroker.origin(mainUrl.toHttpUrl())!="https://animewitcher.com" || request.method()!="GET" || response.status()!=200)return null
        fun settings(url:String):Boolean = runCatching {
            val parsed=url.toHttpUrl()
            parsed.isHttps && parsed.host=="firestore.googleapis.com" && parsed.port==443 && parsed.username.isEmpty() && parsed.password.isEmpty() && parsed.fragment==null &&
                parsed.encodedPath=="/v1/projects/animewitcher-1c66d/databases/(default)/documents/Settings/constants"
        }.getOrDefault(false)
        if(!settings(request.url()) || !settings(response.url()))return null
        val bytes=response.body();if(bytes.size>65536)return null
        return runCatching {
            val fields=RuntimeJson.parse(bytes.decodeToString()).jsonObject.getValue("fields").jsonObject.getValue("search_settings").jsonObject.getValue("mapValue").jsonObject.getValue("fields").jsonObject
            val id=listOf("app_id_v3","app_id","app_id_v2").firstNotNullOfOrNull { key ->
                (fields[key] as? JsonObject)?.get("stringValue")?.let { it as? JsonPrimitive }?.takeIf { it.isString }?.content
            } ?: return null
            if(!id.matches(Regex("[A-Za-z0-9]{10}")))return null
            "https://${id.lowercase(java.util.Locale.ROOT)}-dsn.algolia.net"
        }.getOrNull()
    }
}
