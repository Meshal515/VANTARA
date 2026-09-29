package com.vantara.usage

import android.content.Context
import java.io.File

object UsageStore {
    @Volatile private var journal: UsageJournal? = null
    fun get(context: Context): UsageJournal = journal ?: synchronized(this) {
        journal ?: UsageJournal(File(context.applicationContext.filesDir, "follow-time.json")).also { journal = it }
    }
}
