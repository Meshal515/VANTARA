package com.vantara.verification

import java.util.ArrayDeque

/** Debug-only lifecycle evidence. No URLs, cookie values, tokens, HTML or request headers. */
internal class VerificationTrace(private val clock: () -> Long, private val capacity: Int = 120) {
    enum class Event {
        ACTIVITY_CREATE, ACTIVITY_RECREATED, ACTIVITY_RESUME, ACTIVITY_PAUSE, ACTIVITY_DESTROY,
        WEBVIEW_CREATE, APP_LOAD_URL, WEBVIEW_DESTROY, NAVIGATION, NAVIGATION_BLOCKED,
        PAGE_START, PAGE_FINISH, HISTORY_RELOAD, HISTORY_NAVIGATION,
        BLOCKED_MAIN_ENDPOINT, BLOCKED_RESOURCE_ENDPOINT, BLOCKED_MAIN_DNS, BLOCKED_RESOURCE_DNS,
        HTTP_MAIN_ERROR, HTTP_RESOURCE_ERROR, HTTP_MAIN_CHALLENGE, HTTP_RESOURCE_CHALLENGE,
        NETWORK_MAIN_ERROR, NETWORK_RESOURCE_ERROR, TLS_ERROR, RENDERER_GONE,
        PAGE_READY, PAGE_NOT_READY, COMPLETE_VERIFIED, COMPLETE_FAILED, COMPLETE_CANCELLED
    }
    private val started = clock()
    private val counts = linkedMapOf<Event, Int>()
    private val entries = ArrayDeque<String>()
    init { require(capacity > 0) }
    @Synchronized fun record(event: Event, code: Int? = null) {
        counts[event] = (counts[event] ?: 0) + 1
        if (entries.size >= capacity) entries.removeFirst()
        entries.addLast("+${(clock() - started).coerceAtLeast(0)}ms ${event.name}" +
            (code?.let { " code=$it" } ?: ""))
    }
    @Synchronized fun report(): String = buildString {
        appendLine("VANTARA verification lifecycle (debug)")
        for ((event, count) in counts) appendLine("${event.name}=$count")
        appendLine("Recent events:")
        for (entry in entries) appendLine(entry)
    }
}
