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
    fun sourceOrigins(hash:String,mainUrl:String,attested:Set<String>):Set<String> {
        val search=attested.singleOrNull { it.matches(Regex("https://[a-z0-9]{10}-dsn\\.algolia\\.net")) }
        val base=sourceOrigins(hash,mainUrl,search)
        return if(hash==WITCHER && HttpBroker.origin(mainUrl.toHttpUrl())=="https://animewitcher.com" && "https://pixeldrain.com" in attested)
            base+"https://pixeldrain.com" else base
    }
    /** Only a successful TLS response from this reviewed source's own settings
     * document can attest its replacement Algolia application. No wildcard. */
    @JvmStatic fun trustedSettingsOrigin(hash:String,mainUrl:String,request:RuntimeHttpAccess.Request,response:RuntimeHttpAccess.Response):String? {
        if(hash!=WITCHER || HttpBroker.origin(mainUrl.toHttpUrl())!="https://animewitcher.com" || request.method()!="GET" || response.status()!=200)return null
        val requestPath=runCatching { request.url().toHttpUrl().encodedPath }.getOrNull() ?: return null
        val serverDocument=requestPath.matches(Regex("/v1/projects/animewitcher-1c66d/databases/\\(default\\)/documents/anime_list/[^/]+/episodes/[^/]+/servers2/all_servers"))
        if(!serverDocument && requestPath!="/v1/projects/animewitcher-1c66d/databases/(default)/documents/Settings/constants")return null
        fun settings(url:String):Boolean = runCatching {
            val parsed=url.toHttpUrl()
            parsed.isHttps && parsed.host=="firestore.googleapis.com" && parsed.port==443 && parsed.username.isEmpty() && parsed.password.isEmpty() && parsed.fragment==null &&
                parsed.encodedPath==requestPath
        }.getOrDefault(false)
        if(!settings(request.url()) || !settings(response.url()))return null
        val bytes=response.body();if(bytes.size>65536)return null
        return runCatching {
            val document=RuntimeJson.parse(bytes.decodeToString()).jsonObject.getValue("fields").jsonObject
            if(serverDocument) {
                val servers=document.getValue("servers").jsonObject.getValue("arrayValue").jsonObject.getValue("values").jsonArray
                if(servers.size>128)return null
                val supported=servers.any { item ->
                    val values=item.jsonObject.getValue("mapValue").jsonObject.getValue("fields").jsonObject
                    val name=values["name"]?.jsonObject?.get("stringValue")?.jsonPrimitive?.content
                    val link=values["link"]?.jsonObject?.get("stringValue")?.jsonPrimitive?.content?.toHttpUrl()
                    name=="PD" && link!=null && link.isHttps && link.host=="pixeldrain.com" && link.port==443 && link.username.isEmpty() && link.password.isEmpty() && link.query==null && link.fragment==null &&
                        link.encodedPath.matches(Regex("/u/[A-Za-z0-9_-]{8}"))
                }
                return if(supported)"https://pixeldrain.com" else null
            }
            val fields=document.getValue("search_settings").jsonObject.getValue("mapValue").jsonObject.getValue("fields").jsonObject
            val id=listOf("app_id_v3","app_id","app_id_v2").firstNotNullOfOrNull { key ->
                (fields[key] as? JsonObject)?.get("stringValue")?.let { it as? JsonPrimitive }?.takeIf { it.isString }?.content
            } ?: return null
            if(!id.matches(Regex("[A-Za-z0-9]{10}")))return null
            "https://${id.lowercase(java.util.Locale.ROOT)}-dsn.algolia.net"
        }.getOrNull()
    }
}
