package com.vantara.anime

import com.vantara.anime.registry.Domains
import com.vantara.anime.registry.ExtensionRef
import com.vantara.anime.registry.Manifest
import com.vantara.anime.registry.SourceEntry
import com.vantara.anime.registry.UserAnimeExtension
import com.vantara.anime.registry.mergeUserSources
import org.junit.Assert.assertEquals
import org.junit.Test

class UserAnimeMergeTest {
    private fun user(pkg: String, content: String = "cinema") = UserAnimeExtension(
        repoUrl = "https://raw.githubusercontent.com/yuzono/anime-repo/repo", name = "Egy Dead", pkg = pkg,
        apkUrl = "https://raw.githubusercontent.com/yuzono/anime-repo/repo/apk/x.apk", sha256 = "a".repeat(64),
        version = "14.30", content = content, baseUrl = "https://egydead.space",
    )

    @Test fun installedExtensionBecomesAnEngineSourceInItsSection() {
        val e = user("eu.kanade.tachiyomi.animeextension.ar.egydead").entry()
        assertEquals("user-egydead", e.id)
        assertEquals("cinema", e.content)
        assertEquals("eu.kanade.tachiyomi.animeextension.ar.egydead", e.extension?.pkg)
        assertEquals("https://egydead.space", e.domains.current)
    }

    @Test fun shippedSourcesWinOverAUserCopyOfTheSamePackage() {
        val shipped = SourceEntry(
            id = "faselhd", name = "FaselHD", content = "cinema",
            extension = ExtensionRef(pkg = "eu.kanade.tachiyomi.animeextension.ar.faselhd", apk = "x", sha256 = "b".repeat(64)),
            domains = Domains(current = "https://www.faselhds.biz"),
        )
        val merged = mergeUserSources(
            Manifest(sources = listOf(shipped)),
            listOf(user("eu.kanade.tachiyomi.animeextension.ar.faselhd").entry(), user("eu.kanade.tachiyomi.animeextension.ar.egydead").entry()),
        )
        assertEquals(listOf("faselhd", "user-egydead"), merged.sources.map { it.id })
    }
}
