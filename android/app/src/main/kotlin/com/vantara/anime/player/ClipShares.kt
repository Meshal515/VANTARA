package com.vantara.anime.player

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID

object ClipShares {
    fun share(activity: Activity, file: File, text: String) {
        val shared = File(activity.cacheDir, "shared-clips").apply { mkdirs() }
        shared.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 24 * 60 * 60 * 1000L }?.forEach { it.delete() }
        val attachment = file.copyTo(File(shared, "vantara-${UUID.randomUUID()}.mp4"))
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", attachment)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "video/mp4"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TEXT, text)
            clipData = ClipData.newRawUri("VANTARA", uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        activity.startActivity(Intent.createChooser(send, "شارك المقطع"))
    }
}
