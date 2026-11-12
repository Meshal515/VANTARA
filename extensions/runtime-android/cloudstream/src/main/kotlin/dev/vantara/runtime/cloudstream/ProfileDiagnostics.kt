package dev.vantara.runtime.cloudstream
object ProfileDiagnostics {
    @Volatile var lastErrorType:String?=null;private set
    fun record(type:String){lastErrorType=type.take(200)}
}
