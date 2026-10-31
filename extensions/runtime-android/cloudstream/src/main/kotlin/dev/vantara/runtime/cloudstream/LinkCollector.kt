package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.utils.ExtractorLink
import kotlinx.coroutines.runBlocking
import java.io.IOException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Collects links found before a server deadline. Timed-out provider jobs are interrupted and their
 * late callbacks are discarded. A malicious/non-cooperative plugin can ignore interruption, so the
 * number of outstanding provider threads is capped; further requests fail explicitly rather than
 * leaking an unbounded number of threads into the isolated CloudStream worker.
 */
internal object LinkCollector {
    private val activeWorkers = Semaphore(2, true)
    class Result(val links:List<ExtractorLink>,val subtitles:List<SubtitleFile>,val complete:Boolean,val failure:Throwable?)

    fun collect(budgetMs:Long,load:suspend ((SubtitleFile)->Unit,(ExtractorLink)->Unit)->Unit):Result {
        require(budgetMs>0){"INVALID_LINK_BUDGET"}
        if(!activeWorkers.tryAcquire())
            return Result(emptyList(),emptyList(),false,IOException("VIDEO_LINK_WORKER_BUSY"))

        val lock=Any()
        val accepting=AtomicBoolean(true)
        val links=mutableListOf<ExtractorLink>()
        val subtitles=mutableListOf<SubtitleFile>()
        val finished=CompletableFuture<Unit>()
        val thread=Thread({
            try {
                runBlocking {
                    load(
                        {file-> synchronized(lock) {if(accepting.get()&&subtitles.size<64)subtitles.add(file)}},
                        {link-> synchronized(lock) {
                            if(accepting.get()) {
                                check(links.size<128){"LINK_RESULT_LIMIT"}
                                links.add(link)
                            }
                        }},
                    )
                }
                finished.complete(Unit)
            } catch(failure:Throwable) {
                finished.completeExceptionally(failure)
            } finally {
                activeWorkers.release()
            }
        },"vantara-video-links").apply{isDaemon=true}
        try {thread.start()} catch(failure:Throwable) {activeWorkers.release();throw failure}

        var failure:Throwable?=null
        var complete=false
        try {
            finished.get(budgetMs,TimeUnit.MILLISECONDS)
            complete=true
        } catch(_:TimeoutException) {
            // A hung provider cannot extend the bounded operation.
        } catch(error:ExecutionException) {
            complete=true
            failure=error.cause?:error
        } catch(error:InterruptedException) {
            Thread.currentThread().interrupt()
            failure=error
        } finally {
            // Close the result window before cancelling: even an uncooperative callback cannot
            // mutate a finished request after its timeout (or after the caller was interrupted).
            synchronized(lock) {accepting.set(false)}
            if(!complete)thread.interrupt()
        }
        return synchronized(lock) {Result(links.toList(),subtitles.toList(),complete,failure)}
    }
}
