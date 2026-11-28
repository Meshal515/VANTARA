package com.vantara.verification

import android.os.SystemClock
import okhttp3.HttpUrl

/** Challenge detection only records work. Only the explicit bridge begin() opens UI. */
object VerificationCoordinator {
    private val ledger = VerificationLedger()
    private val interactiveHost = Regex("^Cloudflare wants a human check for ([^;]+);")
    fun challengeHost(message: String?): String? = message?.let {
        interactiveHost.find(it)?.groupValues?.get(1)?.let { host -> VerificationPolicy.endpoint("https://$host")?.host }
    }
    private var listener: ((VerificationPending, String, String?) -> Unit)? = null

    private var listenerOwner: Any? = null
    @Synchronized fun attach(owner: Any, listener: (VerificationPending, String, String?) -> Unit) {
        listenerOwner = owner; this.listener = listener
    }
    @Synchronized fun detach(owner: Any) {
        if (listenerOwner === owner) { listenerOwner = null; listener = null }
    }
    @Synchronized fun pending(): List<VerificationPending> { expire(); return ledger.snapshot() }
    @JvmStatic @JvmOverloads @Synchronized fun require(url: HttpUrl, userAgent: String, kind: String = "cloudflare", sourceName: String? = null, sourceId: String? = null): VerificationPending? {
        expire()
        val endpoint = VerificationPolicy.endpoint(url.toString()) ?: return null
        val exists = ledger.snapshot().any { it.host == endpoint.host }
        val item = ledger.require(endpoint.host, endpoint.origin, url.toString(), userAgent, kind, sourceName ?: endpoint.host, SystemClock.elapsedRealtime(), sourceId)
        if (item != null && !exists) listener?.invoke(item, "required", null)
        return item
    }
    @Synchronized fun annotate(host: String, sourceId: String, sourceName: String) {
        ledger.annotate(host, sourceId, sourceName)?.also { listener?.invoke(it, "required", null) }
    }
    @Synchronized fun discardSource(sourceId: String) {
        ledger.discardSource(sourceId).forEach { listener?.invoke(it, "discarded", null) }
    }
    @Synchronized fun begin(host: String, cloudstream: Boolean = false): VerificationPending? {
        expire()
        if (ledger.snapshot().none { it.host == host && (it.kind == "cloudstream") == cloudstream }) return null
        return ledger.begin(host, SystemClock.elapsedRealtime())?.also { listener?.invoke(it, "active", null) }
    }
    @Synchronized fun finish(host: String, token: String, state: String, reason: String? = null): VerificationPending? {
        val item = if (state == "verified") ledger.finish(host, token)
            else ledger.retry(host, token, SystemClock.elapsedRealtime())
        return item?.also { listener?.invoke(it, state, reason) }
    }
    // A request that aged out is still waiting for the user, not a failed attempt: it is announced as required again
    // («تحتاج تحقق»), never as «انتهت مهلة التحقق», which read as if the user's check had timed out.
    private fun expire() {
        val now = SystemClock.elapsedRealtime()
        ledger.discardStale(now).forEach { listener?.invoke(it, "discarded", null) }
        ledger.expire(now).forEach { listener?.invoke(it, "required", null) }
    }
}
