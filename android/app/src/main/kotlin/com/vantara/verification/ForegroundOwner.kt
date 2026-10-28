package com.vantara.verification

import java.lang.ref.WeakReference

/** Identity-aware ownership prevents an old Activity's teardown clearing a new one. */
class ForegroundOwner<T : Any>(private val valid: (T) -> Boolean, private val lifecycleResumed: (T) -> Boolean) {
    private var reference: WeakReference<T>? = null
    private var explicitlyPaused = false
    @Synchronized fun set(owner: T?) {
        if (reference?.get() === owner) return
        reference = owner?.let(::WeakReference)
        explicitlyPaused = false
    }
    @Synchronized fun resumed(owner: T) { set(owner); explicitlyPaused = false }
    @Synchronized fun paused(owner: T) { if (reference?.get() === owner) explicitlyPaused = true }
    @Synchronized fun clear(owner: T?) { if (reference?.get() === owner) { reference = null; explicitlyPaused = false } }
    @Synchronized fun get(): T? = reference?.get()?.takeIf { !explicitlyPaused && valid(it) && lifecycleResumed(it) }
}
