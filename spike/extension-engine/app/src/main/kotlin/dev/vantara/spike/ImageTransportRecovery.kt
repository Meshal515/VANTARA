package dev.vantara.spike

import java.io.EOFException
import java.io.IOException

/**
 * Retries only transport failures that can happen after HTTP headers were
 * already received while the image body is still being read.
 *
 * Parser errors, HTTP errors, Cloudflare errors and payload-limit rejections
 * are deliberately not retried here.
 */
suspend fun <T> retryImageTransport(
    maxAttempts: Int = 3,
    block: suspend () -> T,
): T {
    require(maxAttempts > 0) { "maxAttempts must be positive" }

    var attempt = 1
    while (true) {
        try {
            return block()
        } catch (t: Throwable) {
            if (attempt >= maxAttempts || !isRetryableImageTransport(t)) throw t
            attempt += 1
        }
    }
}

internal fun isRetryableImageTransport(t: Throwable): Boolean {
    if (generateSequence(t) { it.cause }.any { it is PayloadTooLargeException }) return false

    return generateSequence(t) { it.cause }.any { cause ->
        when (cause) {
            is EOFException -> true
            is IOException -> {
                val message = cause.message.orEmpty().lowercase()
                cause.javaClass.simpleName == "StreamResetException" ||
                    "stream was reset" in message ||
                    "unexpected end of stream" in message ||
                    "connection reset" in message
            }
            else -> false
        }
    }
}
