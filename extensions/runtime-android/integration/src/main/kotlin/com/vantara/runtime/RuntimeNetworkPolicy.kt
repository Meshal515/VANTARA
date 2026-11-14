package com.vantara.runtime

import dev.vantara.runtime.http.HttpBroker
import okhttp3.HttpUrl.Companion.toHttpUrl
import dev.vantara.runtime.api.RuntimeHttpAccess
import kotlinx.serialization.json.*

/**
 * Network grant for a CloudStream package. Every package may reach the public internet, like the same
 * provider does inside CloudStream, Mihon or Aniyomi: providers depend on CDNs, APIs and video hosts they
 * cannot list in advance. A per-package allowlist turned working providers into empty pages.
 *
 * What still holds: the host broker resolves DNS itself and refuses private, loopback and link-local
 * answers; cookies are kept per account and source; the worker runs in its own UID without host data.
 */
internal object RuntimeNetworkPolicy {
    const val PUBLIC_INTERNET="*"
    private const val WITCHER="4c639f9392d46e45f4ee84e8799c810cc1d11fba2f13ff7e32865c71987c2fb4"
    @JvmStatic fun sourceOrigins(hash:String,mainUrl:String):Set<String> {
        val url=mainUrl.toHttpUrl()
        require(url.username.isEmpty() && url.password.isEmpty()) { "INVALID_ENDPOINT" }
        return setOf(PUBLIC_INTERNET)
    }
    @Suppress("UNUSED_PARAMETER") fun sourceOrigins(hash:String,mainUrl:String,attested:String?):Set<String> =sourceOrigins(hash,mainUrl)
    @Suppress("UNUSED_PARAMETER") fun sourceOrigins(hash:String,mainUrl:String,attested:Set<String>):Set<String> =sourceOrigins(hash,mainUrl)
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
