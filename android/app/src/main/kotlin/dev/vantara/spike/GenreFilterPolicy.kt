package dev.vantara.spike

import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.model.Filter
import eu.kanade.tachiyomi.source.model.FilterList

/**
 * تصنيفٌ واحد عبر مصادر لا تشترك في لغة فلاتر.
 *
 * كل مصدر يسمّي تصنيفاته بطريقته: «أكشن» و«اكشن» و«Action»، و«رومانسي»
 * و«رومانسية» و«Romance». الواجهة ترسل أسماء التصنيف كلها، وهنا يُبحث في
 * فلاتر المصدر عن خانة (CheckBox أو TriState) أو خيار قائمة (Select) يطابق
 * أحدها بعد التطبيع، فيُفعَّل ويُطلب البحث بلا نص.
 *
 * مصدرٌ بلا هذا التصنيف يُرجع `null` فيُتجاوز: البحث بالكلمة «مغامرة» كان
 * يرجع أعمالًا في عنوانها الكلمة، لا أعمال مغامرة — نتيجة تبدو صحيحة وهي لا.
 *
 * ويبدأ من فلاتر الكتالوج نفسها (`CatalogueFilterPolicy`): MangaDex العربي
 * يبقى عربيًّا والتصنيف مفعّل.
 */
object GenreFilterPolicy {

    fun filters(source: CatalogueSource, names: Collection<String>): FilterList? {
        val wanted = names.map(::normalize).filter { it.isNotEmpty() }.toSet()
        if (wanted.isEmpty()) return null
        val filters = runCatching { CatalogueFilterPolicy.catalogueFilters(source) }.getOrElse { source.getFilterList() }
        val all = flatten(filters)

        all.firstOrNull { (it is Filter.CheckBox || it is Filter.TriState) && matches(it.name, wanted) }?.let { box ->
            when (box) {
                is Filter.CheckBox -> box.state = true
                is Filter.TriState -> box.state = Filter.TriState.STATE_INCLUDE
                else -> Unit
            }
            return filters
        }
        for (select in all.filterIsInstance<Filter.Select<*>>()) {
            val index = select.values.indexOfFirst { matches(it.toString(), wanted) }
            if (index >= 0) {
                select.state = index
                return filters
            }
        }
        return null
    }

    private fun matches(name: String, wanted: Set<String>): Boolean {
        val n = normalize(name)
        if (n.isEmpty()) return false
        return wanted.any { w -> n == w || (minOf(n.length, w.length) >= 5 && (n.startsWith(w) || w.startsWith(n))) }
    }

    /** «الأكشن» و«اكشن» و«Action » شيء واحد. */
    fun normalize(raw: String): String {
        var s = raw.trim().lowercase()
            .replace(Regex("[أإآٱ]"), "ا")
            .replace('ة', 'ه')
            .replace('ى', 'ي')
            .replace(Regex("[\\u064B-\\u0652\\u0640]"), "")
            .replace(Regex("[\\s\\-_'’.]+"), "")
        if (s.startsWith("ال") && s.length > 4) s = s.substring(2)
        return s
    }

    private fun flatten(filters: List<Filter<*>>): List<Filter<*>> = filters.flatMap { filter ->
        if (filter is Filter.Group<*>) listOf(filter) + flatten(filter.state.filterIsInstance<Filter<*>>()) else listOf(filter)
    }
}
