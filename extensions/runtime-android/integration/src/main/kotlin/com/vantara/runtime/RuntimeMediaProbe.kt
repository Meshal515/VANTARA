package com.vantara.runtime

import com.vantara.anime.stream.MediaEvidenceProbe
import dev.vantara.runtime.http.HttpBroker
import kotlinx.serialization.json.*
import okhttp3.Headers

/** Runtime JSON boundary; media inspection is shared with the existing Aniyomi host. */
internal class RuntimeMediaProbe(private val fetch:(String,Headers)->HttpBroker.Output) {
    fun requirePlayable(links:JsonObject) {
        RuntimeCanaryContract.mediaUrls(links)
        val candidates=(links["items"] as JsonArray).map { raw ->
            val link=raw.jsonObject
            val headers=Headers.Builder()
            (link["headers"] as? JsonObject)?.forEach { (key,value) ->
                (value as? JsonPrimitive)?.contentOrNull?.let { headers.add(key,it) }
            }
            if(link.text("referer").isNotBlank() && headers.get("Referer")==null)headers.set("Referer",link.text("referer"))
            MediaEvidenceProbe.Link(runtimeMediaUrl(link.text("url")),headers.build())
        }
        MediaEvidenceProbe { url,headers ->
            val result=fetch(url,headers)
            MediaEvidenceProbe.Response(result.url(),result.status(),result.headers(),result.body())
        }.requirePlayable(candidates)
    }
}
