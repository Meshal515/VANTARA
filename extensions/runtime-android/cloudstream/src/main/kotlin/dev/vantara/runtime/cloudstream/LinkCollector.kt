package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.utils.ExtractorLink
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlin.coroutines.coroutineContext
import java.io.IOException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Collects links found before a server deadline. Timed-out provider jobs are interrupted and their
 * late callbacks are discarded. A malicious/non-cooperative plugin can ignore interruption, so the
 * number of outstanding provider threads is capped; further requests fail explicitly rather than
 * leaking an unbounded number of threads into the isolated CloudStream worker.
 *
 * [start] gives the same collection in stages ([Live.next]): CloudStream's loadLinks calls back once per server as
 * each extractor finishes, and returning only at the end made every ready server wait for the slowest one (up to the
 * whole budget). The deadline is enforced by the collection itself, so a host that stops asking cannot extend it.
 */
internal object LinkCollector {
    private val activeWorkers = Semaphore(2, true)
    class Result(val links:List<ExtractorLink>,val subtitles:List<SubtitleFile>,val complete:Boolean,val failure:Throwable?)
    /** What arrived since the previous stage. [ended]: nothing more will come (finished, failed or out of budget). */
    class Stage(val links:List<ExtractorLink>,val subtitles:List<SubtitleFile>,val ended:Boolean,val complete:Boolean,val failure:Throwable?,val total:Int)

    private val deadlines=java.util.concurrent.Executors.newSingleThreadScheduledExecutor { r -> Thread(r,"vantara-link-deadline").apply { isDaemon=true } }

    fun collect(budgetMs:Long,load:suspend ((SubtitleFile)->Unit,(ExtractorLink)->Unit)->Unit):Result =
        collectWithLimiter(budgetMs,activeWorkers,load)

    /** Separate limiter lets fault-injection tests isolate their deliberately non-cooperative workers. */
    internal fun collectWithLimiter(budgetMs:Long,limiter:Semaphore,load:suspend ((SubtitleFile)->Unit,(ExtractorLink)->Unit)->Unit):Result {
        val live=startWithLimiter(budgetMs,limiter,load) ?: return Result(emptyList(),emptyList(),false,IOException("VIDEO_LINK_WORKER_BUSY"))
        return live.awaitEnd()
    }

    fun start(budgetMs:Long,load:suspend ((SubtitleFile)->Unit,(ExtractorLink)->Unit)->Unit):Live? =
        startWithLimiter(budgetMs,activeWorkers,load)

    /** null when the bounded number of provider threads is already running. */
    internal fun startWithLimiter(budgetMs:Long,limiter:Semaphore,load:suspend ((SubtitleFile)->Unit,(ExtractorLink)->Unit)->Unit):Live? {
        require(budgetMs>0){"INVALID_LINK_BUDGET"}
        if(!limiter.tryAcquire()) return null
        return Live(budgetMs,limiter,load)
    }

    class Live internal constructor(budgetMs:Long,private val limiter:Semaphore,load:suspend ((SubtitleFile)->Unit,(ExtractorLink)->Unit)->Unit) {
        private val lock=Any()
        private val accepting=AtomicBoolean(true)
        private val job=AtomicReference<Job?>()
        private val links=mutableListOf<ExtractorLink>()
        private val subtitles=mutableListOf<SubtitleFile>()
        private val finished=CompletableFuture<Unit>()
        private val deadline=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(budgetMs)
        private val thread:Thread
        @Volatile private var closed:Result?=null
        private var linkCursor=0
        private var subtitleCursor=0

        init {
            thread=Thread({
                try {
                    runBlocking {
                        job.set(coroutineContext[Job])
                        try { load(
                            {file-> synchronized(lock) {if(accepting.get()&&subtitles.size<64)subtitles.add(file)}},
                            {link-> synchronized(lock) {
                                if(accepting.get()) {
                                    check(links.size<128){"LINK_RESULT_LIMIT"}
                                    links.add(link)
                                }
                            }},
                        ) } finally { job.set(null) }
                    }
                    finished.complete(Unit)
                } catch(failure:Throwable) {
                    finished.completeExceptionally(failure)
                } finally {
                    limiter.release()
                }
            },"vantara-video-links").apply{isDaemon=true}
            try {thread.start()} catch(failure:Throwable) {limiter.release();throw failure}
            // Nobody waiting (the host stopped asking, or crashed) never keeps the provider running past its budget.
            runCatching { deadlines.schedule({ close(false) },budgetMs,TimeUnit.MILLISECONDS) }
        }

        private fun remainingMs()=TimeUnit.NANOSECONDS.toMillis(deadline-System.nanoTime())

        /** Closes the result window once; links after it are discarded even from a callback that ignores cancellation. */
        private fun close(interrupted:Boolean):Result {
            closed?.let { return it }
            var complete=false
            var failure:Throwable?=null
            if(finished.isDone) {
                complete=true
                try { finished.get() } catch(error:ExecutionException) { failure=error.cause?:error } catch(_:Exception) {}
            } else if(interrupted) failure=InterruptedException()
            return synchronized(lock) {
                closed?.let { return@synchronized it }
                accepting.set(false)
                if(!complete) {
                    job.get()?.cancel(CancellationException("VIDEO_LINK_TIMEOUT"))
                    thread.interrupt()
                }
                Result(links.toList(),subtitles.toList(),complete,failure).also { closed=it }
            }
        }

        /** The whole collection at its end (finished, failed, or the budget ran out). */
        fun awaitEnd():Result {
            try {
                finished.get(remainingMs().coerceAtLeast(0),TimeUnit.MILLISECONDS)
            } catch(_:TimeoutException) {
                // A hung provider cannot extend the bounded operation.
            } catch(_:ExecutionException) {
            } catch(_:InterruptedException) {
                Thread.currentThread().interrupt()
                return close(true)
            }
            return close(false)
        }

        /**
         * Waits for something new: returns [coalesceMs] after the first fresh link or [extra] signal (servers that
         * finish together arrive together), or at the end. Each link is handed out once, in arrival order.
         */
        fun next(coalesceMs:Long,extra:()->Boolean={false}):Stage {
            var freshAt=0L
            while(true) {
                if(finished.isDone || remainingMs()<=0) break
                val fresh=synchronized(lock) { links.size>linkCursor || subtitles.size>subtitleCursor } || extra()
                val now=System.nanoTime()
                if(fresh) {
                    if(freshAt==0L) freshAt=now
                    else if(TimeUnit.NANOSECONDS.toMillis(now-freshAt)>=coalesceMs) return take(null)
                }
                try { finished.get(minOf(25L,remainingMs().coerceAtLeast(1)),TimeUnit.MILLISECONDS) }
                catch(_:TimeoutException) {} catch(_:ExecutionException) {}
                catch(_:InterruptedException) { Thread.currentThread().interrupt();return take(close(true)) }
            }
            return take(close(false))
        }

        private fun take(end:Result?):Stage = synchronized(lock) {
            val all=end?.links ?: links
            val subs=end?.subtitles ?: subtitles
            val newLinks=all.subList(linkCursor.coerceAtMost(all.size),all.size).toList()
            val newSubs=subs.subList(subtitleCursor.coerceAtMost(subs.size),subs.size).toList()
            linkCursor=all.size;subtitleCursor=subs.size
            Stage(newLinks,newSubs,end!=null,end?.complete ?: false,end?.failure,all.size)
        }

        /** The host moved on (a new episode, a closed worker): stop the provider now. */
        fun cancel() { close(false) }
    }
}
