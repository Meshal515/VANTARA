package com.vantara.anime.player

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import okhttp3.OkHttpClient
import java.io.File

/**
 * كاش البايتات التي نزلها المشغّل أثناء المشاهدة (مقاطع HLS / أجزاء MP4).
 *
 * سببه الوحيد: «حفظ/مشاركة» المقطع يقرأ نفس البايتات من هنا بدل تنزيلها من
 * السيرفر مرة ثانية. مسقوف ([MAX_BYTES]، الأقدم يُطرد أولًا)، في `cacheDir`،
 * ويُمسح كاملًا حين يُغلق المشغّل — لا أثر دائم على مساحة الجهاز.
 */
@OptIn(UnstableApi::class)
object MediaCache {
    private const val MAX_BYTES = 300L * 1024 * 1024
    private var cache: SimpleCache? = null
    private var db: StandaloneDatabaseProvider? = null
    private var users = 0

    private fun dir(context: Context) = File(context.cacheDir, "anime-media")

    @Synchronized
    fun acquire(context: Context): SimpleCache {
        users++
        cache?.let { return it }
        val provider = db ?: StandaloneDatabaseProvider(context.applicationContext).also { db = it }
        val d = dir(context)
        // بقايا جلسة انتهت بتعطّل: تُمسح قبل البدء
        if (d.exists() && !SimpleCache.isCacheFolderLocked(d)) runCatching { SimpleCache.delete(d, provider) }
        return SimpleCache(d, LeastRecentlyUsedCacheEvictor(MAX_BYTES), provider).also { cache = it }
    }

    /** آخر مستخدم يغلق: الكاش يُحرَّر ويُحذف من القرص. */
    @Synchronized
    fun release(context: Context) {
        users = (users - 1).coerceAtLeast(0)
        if (users > 0) return
        val c = cache ?: return
        cache = null
        runCatching { c.release() }
        db?.let { p -> runCatching { SimpleCache.delete(dir(context), p) } }
        dir(context).deleteRecursively()
    }

    /** مصدر بيانات يقرأ من الكاش أولًا ويكتب فيه ما ينزل من السيرفر. */
    fun factory(context: Context, client: OkHttpClient, headers: Map<String, String>): DataSource.Factory {
        val upstream = OkHttpDataSource.Factory(client).setDefaultRequestProperties(headers)
        val c = synchronized(this) { cache } ?: return upstream
        return CacheDataSource.Factory()
            .setCache(c)
            .setUpstreamDataSourceFactory(upstream)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
    }

    /** ملفات المقاطع المؤقتة (للمشاركة): تُحذف عند إغلاق المحرّر والمشغّل. */
    fun purgeClips(context: Context) {
        File(context.cacheDir, "clips").deleteRecursively()
    }
}
