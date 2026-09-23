package dev.vantara.spike

import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.model.Filter
import eu.kanade.tachiyomi.source.model.FilterList
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * «الكتالوج كاملًا» لكل مصدر، لا ما تعرضه فلاتره الافتراضية.
 *
 * أدلّة حيّة (٢٠٢٦‑٠٩‑٢٣):
 *  - Azora بترتيبه الافتراضي «نزول الفصل» يرجع 1921 عملًا فريدًا من 2421:
 *    الترتيب غير ثابت أثناء التصفّح. «الإضافة» تصاعديًّا يرجع 2421 بلا تكرار.
 *  - MangaDex بلا «Has available chapters» يتصفّح 85,664 عملًا بكل اللغات؛
 *    العربي منها 990.
 */
class CatalogueFilterPolicyTest {

    private class Sel(name: String, values: Array<String>) : Filter.Select<String>(name, values)
    private class Box(name: String) : Filter.CheckBox(name)
    private class Grp(name: String, state: List<Filter<*>>) : Filter.Group<Filter<*>>(name, state)

    private class Src(
        override val name: String,
        override val lang: String = "ar",
        private val filters: () -> FilterList,
    ) : CatalogueSource {
        override val id: Long = 1L
        override fun getFilterList(): FilterList = filters()
    }

    private fun azoraFilters() = FilterList(
        Sel("الحالة", arrayOf("الكل", "مستمر")),
        Sel("النوع", arrayOf("الكل", "مانهوا")),
        Sel("ترتيب حسب", arrayOf("نزول الفصل", "الشعبية", "الإضافة", "عدد الفصول", "أ-ي")),
        Sel("فرز الترتيب", arrayOf("تنازليا", "تصاعديا")),
    )

    @Test
    fun `azora is walked by date added, oldest first`() {
        val filters = CatalogueFilterPolicy.catalogueFilters(Src("Azora", filters = ::azoraFilters))
        val sort = filters.filterIsInstance<Filter.Select<*>>().first { it.name == "ترتيب حسب" }
        val direction = filters.filterIsInstance<Filter.Select<*>>().first { it.name == "فرز الترتيب" }
        assertEquals("الإضافة", sort.values[sort.state])
        assertEquals("تصاعديا", direction.values[direction.state])
    }

    @Test
    fun `azora in english labels gets the same order`() {
        val filters = CatalogueFilterPolicy.catalogueFilters(
            Src("Azora") {
                FilterList(
                    Sel("Sort", arrayOf("Latest Update", "Popularity", "Date Added", "Chapter Count", "A-Z")),
                    Sel("Sort direction", arrayOf("Descending", "Ascending")),
                )
            },
        )
        val selects = filters.filterIsInstance<Filter.Select<*>>()
        assertEquals("Date Added", selects[0].values[selects[0].state])
        assertEquals("Ascending", selects[1].values[selects[1].state])
    }

    @Test
    fun `mangadex arabic browses only works with arabic chapters, even inside a group`() {
        val box = Box("Has available chapters")
        CatalogueFilterPolicy.catalogueFilters(
            Src("MangaDex") { FilterList(Grp("Other", listOf(Box("Something else"), box))) },
        )
        assertTrue(box.state)
    }

    @Test
    fun `a missing filter fails loudly instead of counting the wrong catalogue`() {
        // عدّ 85 ألف عمل بكل اللغات على أنه «كتالوج عربي» أسوأ من فشل واضح
        try {
            CatalogueFilterPolicy.catalogueFilters(Src("MangaDex") { FilterList(Box("Renamed")) })
            fail("expected the policy to refuse")
        } catch (expected: IllegalStateException) {
            assertTrue(expected.message!!.contains("MangaDex"))
        }
    }

    @Test
    fun `other sources keep their defaults untouched`() {
        val sort = Sel("ترتيب حسب", arrayOf("نزول الفصل", "الإضافة"))
        val filters = CatalogueFilterPolicy.catalogueFilters(Src("Team X") { FilterList(sort) })
        assertEquals(0, (filters.single() as Filter.Select<*>).state)
    }

    @Test
    fun `sources with a changed traversal get their own checkpoint key`() {
        // صفحة 59 بترتيب قديم ليست صفحة 59 بالجديد؛ الاستئناف منها يزيّف العدد
        assertTrue(CatalogueFilterPolicy.traversalTag(Src("Azora", filters = ::azoraFilters)).isNotEmpty())
        assertTrue(CatalogueFilterPolicy.traversalTag(Src("MangaDex") { FilterList() }).isNotEmpty())
        assertEquals("", CatalogueFilterPolicy.traversalTag(Src("Team X") { FilterList() }))
    }
}
