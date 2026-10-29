package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.utils.ExtractorLink
import kotlinx.coroutines.runBlocking
import java.util.Collections
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Collects what a provider's loadLinks reports within a time budget.
 *
 * Providers try their servers one after another and report each link as soon as it is found. A slow or dead
 * server must not erase the links already found, so loadLinks runs on its own thread and whatever arrived by
 * the budget is returned. A provider failure after some links still returns those links.
 */
internal object LinkCollector {
    class Result(val links:List<ExtractorLink>,val subtitles:List<SubtitleFile>,val complete:Boolean,val failure:Throwable?)

    fun collect(budgetMs:Long,load:suspend ((SubtitleFile)->Unit,(ExtractorLink)->Unit)->Unit):Result {
        val links=Collections.synchronizedList(mutableListOf<ExtractorLink>())
        val subtitles=Collections.synchronizedList(mutableListOf<SubtitleFile>())
        val finished=CompletableFuture<Unit>()
        Thread({
            try { runBlocking { load({file->if(subtitles.size<64)subtitles.add(file)},{link->check(links.size<128){"LINK_RESULT_LIMIT"};links.add(link)}) };finished.complete(Unit) }
            catch(failure:Throwable){finished.completeExceptionally(failure)}
        },"vantara-video-links").apply{isDaemon=true;start()}
        var failure:Throwable?=null
        try { finished.get(budgetMs,TimeUnit.MILLISECONDS) }
        catch(_:TimeoutException){}
        catch(error:ExecutionException){failure=error.cause ?: error}
        return Result(synchronized(links){links.toList()},synchronized(subtitles){subtitles.toList()},finished.isDone,failure)
    }
}
