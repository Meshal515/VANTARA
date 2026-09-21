package dev.vantara.spike

import eu.kanade.tachiyomi.source.model.MangasPage
import eu.kanade.tachiyomi.source.model.SManga
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class CatalogueListingResolverTest {

    @Test
    fun `full catalogue uses unfiltered search instead of a ten item ranking`() = runBlocking {
        val attempted = mutableListOf<CatalogueListingKind>()

        val resolved = resolveFullCatalogueListing { kind ->
            attempted += kind
            when (kind) {
                CatalogueListingKind.SEARCH_ALL -> page(size = 20, hasNext = true)
                CatalogueListingKind.POPULAR -> page(size = 10, hasNext = false)
                CatalogueListingKind.LATEST -> page(size = 20, hasNext = true)
            }
        }

        assertEquals(CatalogueListingKind.SEARCH_ALL, resolved.kind)
        assertEquals(20, resolved.firstPage.mangas.size)
        assertEquals(true, resolved.firstPage.hasNextPage)
        assertEquals(listOf(CatalogueListingKind.SEARCH_ALL), attempted)
    }

    @Test
    fun `unsupported empty search falls back to a browsable listing`() = runBlocking {
        val resolved = resolveFullCatalogueListing { kind ->
            when (kind) {
                CatalogueListingKind.SEARCH_ALL -> throw UnsupportedOperationException("empty query")
                CatalogueListingKind.POPULAR -> page(size = 25, hasNext = true)
                CatalogueListingKind.LATEST -> error("latest must not be needed")
            }
        }

        assertEquals(CatalogueListingKind.POPULAR, resolved.kind)
        assertEquals(25, resolved.firstPage.mangas.size)
    }

    @Test
    fun `empty search and empty popular fall back to latest catalogue`() = runBlocking {
        val resolved = resolveFullCatalogueListing { kind ->
            when (kind) {
                CatalogueListingKind.SEARCH_ALL -> page(size = 0, hasNext = false)
                CatalogueListingKind.POPULAR -> page(size = 0, hasNext = false)
                CatalogueListingKind.LATEST -> page(size = 20, hasNext = true)
            }
        }

        assertEquals(CatalogueListingKind.LATEST, resolved.kind)
        assertEquals(20, resolved.firstPage.mangas.size)
    }

    private fun page(size: Int, hasNext: Boolean): MangasPage = MangasPage(
        mangas = (1..size).map { index ->
            SManga.create().apply {
                url = "/title/$index"
                title = "Title $index"
            }
        },
        hasNextPage = hasNext,
    )
}
