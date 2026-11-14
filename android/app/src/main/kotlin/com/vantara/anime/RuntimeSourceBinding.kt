package com.vantara.anime

import com.vantara.anime.adapters.AnimeAdapter
import com.vantara.anime.registry.SourceEntry

/** Optional host adapter; no APK/DEX format is represented as another family's package. */
data class RuntimeSourceBinding(
    val entry: SourceEntry,
    val adapter: AnimeAdapter,
    val packageId: String,
    val version: String,
    val repository: String,
    val repositoryUrl: String,
    val iconUrl: String? = null,
)
