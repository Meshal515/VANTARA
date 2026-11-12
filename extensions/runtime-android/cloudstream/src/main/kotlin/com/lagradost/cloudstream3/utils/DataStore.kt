package com.lagradost.cloudstream3.utils

import android.content.Context
import android.content.SharedPreferences
import dev.vantara.runtime.cloudstream.WorkerState

/** Provider settings resolve to the worker's scoped store, never the host app's preferences. */
object DataStore {
    fun Context.getSharedPrefs():SharedPreferences=WorkerState.preferences
    fun <T> Context.setKey(path:String,value:T){WorkerState.setKey(path,value)}
    fun <T> Context.getKey(path:String):T?=WorkerState.getKey(path)
}
