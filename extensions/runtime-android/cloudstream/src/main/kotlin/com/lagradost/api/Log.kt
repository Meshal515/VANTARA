package com.lagradost.api

/** Provider log lines are recorded by tag only; message text may carry URLs or tokens and is dropped. */
object Log {
    fun d(tag:String,message:String){dev.vantara.runtime.cloudstream.ProfileDiagnostics.record("log.d:"+tag.take(40))}
    fun i(tag:String,message:String){dev.vantara.runtime.cloudstream.ProfileDiagnostics.record("log.i:"+tag.take(40))}
    fun w(tag:String,message:String){dev.vantara.runtime.cloudstream.ProfileDiagnostics.record("log.w:"+tag.take(40))}
    fun e(tag:String,message:String){dev.vantara.runtime.cloudstream.ProfileDiagnostics.record("log.e:"+tag.take(40))}
}
