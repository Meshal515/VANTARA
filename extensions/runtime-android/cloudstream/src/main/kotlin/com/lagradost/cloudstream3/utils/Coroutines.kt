package com.lagradost.cloudstream3.utils

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

object Coroutines {
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    /** Background work whose failure stays inside the provider (recorded, never thrown to the caller). */
    fun <T> T.ioSafe(work:suspend CoroutineScope.(T)->Unit):Job=scope.launch {
        try{work(this@ioSafe)}catch(error:Throwable){com.lagradost.cloudstream3.mvvm.logError(error)}
    }
}
