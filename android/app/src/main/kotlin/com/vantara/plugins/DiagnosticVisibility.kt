package com.vantara.plugins

import android.content.Context
import com.vantara.app.BuildConfig

/** Build type is authoritative. An enabled preference never enables Stable tools. */
object DiagnosticVisibility {
    private const val STORE = "vantara.debug.ui"
    private const val KEY = "showDiagnostics"
    fun allowed(debugBuild: Boolean, preference: Boolean): Boolean = debugBuild && preference
    fun forBuild(preference: Boolean): Boolean = allowed(BuildConfig.DEBUG, preference)
    fun visible(context: Context): Boolean = forBuild(context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getBoolean(KEY, false))
    fun set(context: Context, visible: Boolean) {
        if (BuildConfig.DEBUG) context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putBoolean(KEY, visible).apply()
    }
}
