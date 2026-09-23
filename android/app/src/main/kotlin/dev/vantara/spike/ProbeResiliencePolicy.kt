package dev.vantara.spike

import java.io.EOFException
import java.io.IOException
import java.net.ConnectException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlinx.coroutines.delay
import kotlin.coroutines.cancellation.CancellationException

data class CandidateSelection<T, U>(
    val candidate: T,
    val items: List<U>,
)

class NoUsableCandidateException(
    val attempted: Int,
    message: String,
    cause: Throwable? = null,
) : IllegalStateException(message, cause)

/**
 * A health probe must not condemn a whole source because the first search hit
 * happens to be an empty/placeholder series. Sample a bounded number of real
 * candidates and accept the first one that actually exposes chapters/content.
 */
suspend fun <T, U> selectFirstNonEmptyCandidate(
    candidates: List<T>,
    maxCandidates: Int,
    load: suspend (T) -> List<U>,
): CandidateSelection<T, U> {
    require(maxCandidates > 0) { "maxCandidates must be positive" }
    var attempted = 0
    var lastError: Throwable? = null

    for (candidate in candidates.take(maxCandidates)) {
        attempted += 1
        try {
            val items = load(candidate)
            if (items.isNotEmpty()) return CandidateSelection(candidate, items)
        } catch (t: Throwable) {
            if (t is CancellationException) throw t
            lastError = t
        }
    }

    throw NoUsableCandidateException(
        attempted = attempted,
        message = "no readable candidate among $attempted sampled titles",
        cause = lastError,
    )
}

/** Retry only transport failures that are plausibly transient. */
suspend fun <T> retryTransientNetwork(
    maxAttempts: Int = 3,
    delayMs: Long = 750,
    block: suspend () -> T,
): T {
    require(maxAttempts > 0) { "maxAttempts must be positive" }
    var attempt = 1
    while (true) {
        try {
            return block()
        } catch (t: Throwable) {
            if (t is CancellationException) throw t
            if (attempt >= maxAttempts || !isTransientNetworkFailure(t)) throw t
            if (delayMs > 0) delay(delayMs * attempt)
            attempt += 1
        }
    }
}

internal fun isTransientNetworkFailure(t: Throwable): Boolean =
    generateSequence(t) { it.cause }.any { cause ->
        when (cause) {
            is UnknownHostException,
            is SocketTimeoutException,
            is ConnectException,
            is EOFException -> true
            is SocketException -> {
                val message = cause.message.orEmpty().lowercase()
                "reset" in message || "closed" in message || "broken pipe" in message
            }
            is IOException -> false
            else -> false
        }
    }
