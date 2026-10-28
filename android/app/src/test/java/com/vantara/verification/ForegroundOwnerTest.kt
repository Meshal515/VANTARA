package com.vantara.verification

import org.junit.Assert.*
import org.junit.Test

class ForegroundOwnerTest {
    private class Owner(var valid: Boolean = true, var resumed: Boolean = true)
    @Test fun oldActivityCannotPauseOrClearNewWindow() {
        val holder = ForegroundOwner<Owner>({ it.valid }, { it.resumed })
        val old = Owner(); val current = Owner()
        holder.resumed(old); holder.resumed(current)
        holder.paused(old); holder.clear(old)
        assertSame(current, holder.get())
    }
    @Test fun pausedOrDestroyedActivityIsNeverReturned() {
        val holder = ForegroundOwner<Owner>({ it.valid }, { it.resumed })
        val activity = Owner()
        holder.set(activity); assertSame(activity, holder.get())
        holder.paused(activity); assertNull(holder.get())
        holder.set(activity); assertNull(holder.get())
        holder.resumed(activity); assertSame(activity, holder.get())
        activity.valid = false; assertNull(holder.get())
    }
    @Test fun setCompatibilityStillRequiresResumedLifecycle() {
        val holder = ForegroundOwner<Owner>({ it.valid }, { it.resumed })
        val activity = Owner(resumed = false)
        holder.set(activity); assertNull(holder.get())
        activity.resumed = true; assertSame(activity, holder.get())
        holder.clear(activity); assertNull(holder.get())
    }
}
