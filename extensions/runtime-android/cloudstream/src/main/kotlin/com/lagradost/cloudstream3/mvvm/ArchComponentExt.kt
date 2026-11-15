package com.lagradost.cloudstream3.mvvm
/** Keep diagnostics without exposing arbitrary provider error messages or credentials. */
fun logError(error:Throwable){dev.vantara.runtime.cloudstream.ProfileDiagnostics.record(error.javaClass.name)}
