package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.MainAPI
import com.lagradost.cloudstream3.utils.ExtractorApi

object Registration {
    data class Snapshot(val sources:List<MainAPI>,val extractors:List<ExtractorApi>)
    private class Stage {val sources=mutableListOf<MainAPI>();val extractors=mutableListOf<ExtractorApi>()}
    private val active=ThreadLocal<Stage>()
    fun collect(load:()->Unit):Snapshot {
        check(active.get()==null){"REGISTRATION_ALREADY_ACTIVE"}
        val stage=Stage();active.set(stage)
        try {load();return Snapshot(stage.sources.toList(),stage.extractors.toList())}
        finally {active.remove()}
    }
    fun source(api:MainAPI){val stage=checkNotNull(active.get()){"REGISTRATION_OUTSIDE_INITIALIZATION"};check(stage.sources.size<32){"SOURCE_REGISTRATION_LIMIT"};stage.sources.add(api)}
    fun extractor(api:ExtractorApi){val stage=checkNotNull(active.get()){"REGISTRATION_OUTSIDE_INITIALIZATION"};check(stage.extractors.size<64){"EXTRACTOR_REGISTRATION_LIMIT"};stage.extractors.add(api)}
}
