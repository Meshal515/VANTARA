package dev.vantara.spike

import eu.kanade.tachiyomi.source.model.MangasPage
import kotlin.coroutines.cancellation.CancellationException

/** The extension surface used to enumerate titles, pinned for the whole crawl. */
enum class CatalogueListingKind {
    SEARCH_ALL,
    POPULAR,
    LATEST,
}

/** Bump whenever saved page numbers/keys would mean something different. */
const val CATALOGUE_LISTING_SCHEMA = "search-all-v1"

data class ResolvedCatalogueListing(
    val kind: CatalogueListingKind,
    val firstPage: MangasPage,
)

/**
 * Resolve the extension method that actually represents the complete catalogue.
 *
 * `popular` is not a catalogue contract: Dilar deliberately returns its ten-item
 * rankings list with `hasNextPage = false`, while MangaDex limits popular titles
 * to recently-created works. An empty search with default filters is the common
 * Keiyoushi contract for "browse all". Older/unusual extensions can still fall
 * back to their popular or latest listing when empty search is unsupported.
 */
internal suspend fun resolveFullCatalogueListing(
    fetchFirstPage: suspend (CatalogueListingKind) -> MangasPage,
): ResolvedCatalogueListing {
    var firstFailure: Throwable? = null
    var firstEmpty: ResolvedCatalogueListing? = null
    var finiteFallback: ResolvedCatalogueListing? = null

    for (kind in CatalogueListingKind.entries) {
        val page = try {
            fetchFirstPage(kind)
        } catch (t: Throwable) {
            if (t is CancellationException) throw t
            // رفضٌ عابر (429/5xx) لا يعني أن المسار غير مدعوم. الرجوع منه إلى
            // POPULAR كان يحوّل Dilar إلى قائمة ترتيبه (10 أعمال بلا صفحة
            // تالية) فيُعلن «اكتمل بعشرة». يصعد ليُعاد على نفس المسار
            if (HttpStopPolicy.isTemporary(t)) throw t
            if (firstFailure == null) firstFailure = t
            continue
        }

        val resolved = ResolvedCatalogueListing(kind, page)
        if (page.hasNextPage) return resolved
        // SEARCH_ALL is the catalogue contract even when every title fits on
        // one page. A finite POPULAR result may only be a ranking (Dilar = 10),
        // so keep it as a last resort and still inspect LATEST.
        if (kind == CatalogueListingKind.SEARCH_ALL && page.mangas.isNotEmpty()) return resolved
        if (page.mangas.isNotEmpty() && finiteFallback == null) finiteFallback = resolved
        if (firstEmpty == null) firstEmpty = resolved
    }

    return finiteFallback
        ?: firstEmpty
        ?: throw firstFailure
        ?: IllegalStateException("no catalogue listing is available")
}
