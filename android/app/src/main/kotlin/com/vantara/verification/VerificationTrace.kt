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

/**
 * Debug وحده: آخر انهيار غير ملتقط في أي عملية للتطبيق (الرئيسية أو :verification)، ليُنسخ من زر «نسخ تشخيص التحقق».
 * بلاغ المالك (Debug 3513): «يستمر في التوقف» بعد التحقق، ولا سجل انهيار في التطبيق. الروابط وقيم cf_clearance تُحذف.
 */
object DebugCrashLog {
    private const val NAME = "debug-last-crash.txt"
    @Volatile private var installed = false

    @JvmStatic @Synchronized fun install(context: android.content.Context) {
        if (installed) return
        installed = true
        val file = java.io.File(context.applicationContext.filesDir, NAME)
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                val trace = java.io.StringWriter().also { error.printStackTrace(java.io.PrintWriter(it)) }.toString()
                val process = if (android.os.Build.VERSION.SDK_INT >= 28) android.app.Application.getProcessName() else "?"
                file.writeText("process=$process thread=${thread.name} at=${System.currentTimeMillis()}\n${scrub(trace).take(16_000)}")
            }
            previous?.uncaughtException(thread, error)
        }
    }

    fun read(context: android.content.Context): String? =
        runCatching { java.io.File(context.applicationContext.filesDir, NAME).takeIf { it.isFile }?.readText() }.getOrNull()

    internal fun scrub(text: String): String = text
        .replace(Regex("https?://[^\\s\"']+"), "<url>")
        .replace(Regex("cf_clearance=[^;\\s\"']+"), "cf_clearance=<value>")
}
