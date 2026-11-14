package com.lagradost.cloudstream3.plugins

import com.lagradost.cloudstream3.MainAPI
import com.lagradost.cloudstream3.utils.ExtractorApi
import dev.vantara.runtime.cloudstream.Registration

/** Original staged registration contract; no global live provider list is mutated. */
abstract class BasePlugin {
    var filename:String=""
    var __filename:String=""
    open fun load(){}
    open fun beforeUnload(){}
    fun registerMainAPI(api:MainAPI){Registration.source(api)}
    fun registerExtractorAPI(api:ExtractorApi){Registration.extractor(api)}
}
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
annotation class CloudstreamPlugin
