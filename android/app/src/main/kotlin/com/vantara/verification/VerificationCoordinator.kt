package com.vantara.verification

import android.os.SystemClock
import okhttp3.HttpUrl

/** Challenge detection only records work. Only the explicit bridge begin() opens UI. */
object VerificationCoordinator {
    private val ledger = VerificationLedger()
    private var listener: ((VerificationPending, String, String?) -> Unit)? = null

    private var listenerOwner: Any? = null
    @Synchronized fun attach(owner: Any, listener: (VerificationPending, String, String?) -> Unit) {
        listenerOwner = owner; this.listener = listener
    }
    @Synchronized fun detach(owner: Any) {
        if (listenerOwner === owner) { listenerOwner = null; listener = null }
    }
    @Synchronized fun pending(): List<VerificationPending> { expire(); return ledger.snapshot() }
    @JvmStatic @JvmOverloads @Synchronized fun require(url: HttpUrl, userAgent: String, kind: String = "cloudflare", sourceName: String? = null): VerificationPending? {
        expire()
        val endpoint = VerificationPolicy.endpoint(url.toString()) ?: return null
        val exists = ledger.snapshot().any { it.host == endpoint.host }
        val item = ledger.require(endpoint.host, endpoint.origin, url.toString(), userAgent, kind, sourceName ?: endpoint.host, SystemClock.elapsedRealtime())
        if (item != null && !exists) listener?.invoke(item, "required", null)
        return item
    }
    @Synchronized fun begin(host: String): VerificationPending? {
        expire()
        return ledger.begin(host, SystemClock.elapsedRealtime())?.also { listener?.invoke(it, "active", null) }
    }
    @Synchronized fun finish(host: String, token: String, state: String, reason: String? = null): VerificationPending? {
        val item = if (state == "verified") ledger.finish(host, token)
            else ledger.retry(host, token, SystemClock.elapsedRealtime())
        return item?.also { listener?.invoke(it, state, reason) }
    }
    private fun expire() { ledger.expire(SystemClock.elapsedRealtime()).forEach { listener?.invoke(it, "expired", "timeout") } }
}
