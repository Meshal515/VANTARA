package dev.vantara.spike

import eu.kanade.tachiyomi.source.model.MangasPage
import eu.kanade.tachiyomi.source.model.SManga
import kotlinx.coroutines.runBlocking
import eu.kanade.tachiyomi.network.HttpException
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
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
    fun `finite popularity ranking does not hide a paginated latest catalogue`() = runBlocking {
        val resolved = resolveFullCatalogueListing { kind ->
            when (kind) {
                CatalogueListingKind.SEARCH_ALL -> throw UnsupportedOperationException("empty query")
                CatalogueListingKind.POPULAR -> page(size = 10, hasNext = false)
                CatalogueListingKind.LATEST -> page(size = 20, hasNext = true)
            }
        }

        assertEquals(CatalogueListingKind.LATEST, resolved.kind)
        assertEquals(true, resolved.firstPage.hasNextPage)
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

    @Test
    fun `a temporary refusal on search is retried, never answered with the ranking`() = runBlocking {
        // Dilar: POPULAR = ترتيب من عشرة بلا صفحة تالية. الرجوع إليه عند 429
        // على البحث يعلن «اكتمل بعشرة» والكتالوج 8998
        val asked = mutableListOf<CatalogueListingKind>()
        try {
            resolveFullCatalogueListing { kind ->
                asked += kind
                when (kind) {
                    CatalogueListingKind.SEARCH_ALL -> throw HttpException(429)
                    else -> MangasPage(listOf(SManga.create().apply { url = "/r"; title = "r" }), false)
                }
            }
            fail("a temporary refusal must surface")
        } catch (expected: HttpException) {
            assertEquals(429, expected.code)
        }
        assertEquals(listOf(CatalogueListingKind.SEARCH_ALL), asked)
    }
}
