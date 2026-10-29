package com.lagradost.cloudstream3

import android.content.Context
import dev.vantara.runtime.cloudstream.WorkerState

/**
 * Process-wide handles a provider may read. In VANTARA's isolated worker the context is the worker's
 * own wrapper (no host Activity, no app stores) and keys live in that worker's scoped preferences.
 */
class CloudStreamApp {
    companion object {
        val context:Context? get()=WorkerState.context
        fun <T> setKey(path:String,value:T){WorkerState.setKey(path,value)}
        fun <T> getKey(path:String):T?=WorkerState.getKey(path)
    }
}
