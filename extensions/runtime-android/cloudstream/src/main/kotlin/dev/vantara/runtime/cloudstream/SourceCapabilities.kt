package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.MainAPI
import kotlinx.serialization.json.*

/** Host-owned metadata has a fixed schema; it needs neither reflective DTO binding nor a coroutine. */
object SourceCapabilities {
    @JvmStatic fun encode(sources: List<MainAPI>): String = buildJsonObject {
        put("profile","cloudstream-original-v1")
        put("sources",JsonArray(sources.map { source -> buildJsonObject {
            put("name",source.name);put("mainUrl",source.mainUrl);put("lang",source.lang);put("hasMainPage",source.hasMainPage)
            put("vpnStatus",source.vpnStatus.name)
            put("supportedTypes",JsonArray(source.supportedTypes.map{JsonPrimitive(it.name)}))
            put("mainPages",JsonArray(source.mainPage.map { section -> buildJsonObject {
                put("name",section.name);put("data",section.data);put("horizontalImages",section.horizontalImages)
            } }))
        } }))
        put("executed",true);put("sourceFunctionsTested",false)
    }.toString()
}
