package com.lagradost.cloudstream3.utils

import com.lagradost.cloudstream3.app

/** Reads an HLS master playlist once and offers each variant as its own quality. */
class M3u8Helper {
    companion object {
        suspend fun generateM3u8(source:String,streamUrl:String,referer:String,quality:Int?=null,headers:Map<String,String> = mapOf(),name:String=source):List<ExtractorLink> {
            val single={listOf(ExtractorLink(source,name,streamUrl,ExtractorLinkType.M3U8).also{it.referer=referer;it.headers=headers;it.quality=quality?:Qualities.Unknown.value})}
            val text=runCatching{app.get(streamUrl,headers=headers,referer=referer.ifBlank{null}).text}.getOrNull()?:return single()
            if(!text.contains("#EXT-X-STREAM-INF"))return single()
            val base=java.net.URI(streamUrl)
            val lines=text.lines()
            val out=mutableListOf<ExtractorLink>()
            for((i,line) in lines.withIndex()) {
                if(!line.startsWith("#EXT-X-STREAM-INF"))continue
                val uri=lines.drop(i+1).firstOrNull{it.isNotBlank()&&!it.startsWith("#")}?.trim()?:continue
                val height=Regex("""RESOLUTION=\d+x(\d+)""").find(line)?.groupValues?.get(1)?.toIntOrNull()
                val url=runCatching{base.resolve(uri).toString()}.getOrNull()?:continue
                out+=ExtractorLink(source,name,url,ExtractorLinkType.M3U8).also{it.referer=referer;it.headers=headers;it.quality=height?:quality?:Qualities.Unknown.value}
            }
            return out.ifEmpty{single()}
        }
    }
}
