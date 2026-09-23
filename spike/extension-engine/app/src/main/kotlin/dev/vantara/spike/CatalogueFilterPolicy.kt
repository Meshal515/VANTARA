package dev.vantara.spike

import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.model.Filter
import eu.kanade.tachiyomi.source.model.FilterList

/**
 * الفلاتر التي تعني «كل الكتالوج» لكل مصدر، حين لا تعنيها الافتراضية.
 *
 * كل حالة هنا مثبتة بدليل حيّ، ومحدّدة باسم المصدر وباسم الفلتر كما في ملفات
 * لغة الإضافة نفسها (أسماء الأصناف مشوّشة بـR8 ولا يُعتمد عليها):
 *
 *  - **Azora**: الترتيب الافتراضي «نزول الفصل» يتغيّر أثناء التصفّح — عمل
 *    نزل له فصل يقفز إلى الأعلى — فيتكرّر بعضها ويختفي غيرها: 1921 من 2421.
 *    و«الإضافة» تصاعديًّا ثابت؛ الجديد يُلحق في الآخر فلا تنزاح صفحة: 2421
 *    بلا تكرار. ويزول معه NPE الإضافة على الصفحة الفارغة (عدّادها لا يُملأ
 *    إلا لصفحة 1).
 *  - **MangaDex (ar)**: بلا «Has available chapters» يتصفّح 85,664 عملًا بكل
 *    اللغات، ويرفض الخادم ما بعد الإزاحة 10,000. العربي منها 990.
 *
 * وفلترٌ مطلوب لا يوجد يُسقط المصدر بصوت عالٍ: عدّ كتالوج آخر على أنه هذا
 * أسوأ من توقّفٍ له سبب مكتوب.
 */
object CatalogueFilterPolicy {

    fun catalogueFilters(source: CatalogueSource): FilterList {
        val filters = source.getFilterList()
        when {
            isAzora(source) -> {
                select(source, filters, setOf("ترتيب حسب", "Sort"), setOf("الإضافة", "Date Added"))
                select(source, filters, setOf("فرز الترتيب", "Sort direction"), setOf("تصاعديا", "Ascending"))
            }
            isArabicMangaDex(source) -> check(source, filters, "Has available chapters")
        }
        return filters
    }

    /**
     * يُلحق بمفتاح نقطة الحفظ حين يتغيّر مسار التصفّح: صفحة 59 بالترتيب القديم
     * ليست صفحة 59 بالجديد، والاستئناف منها يزيّف العدد.
     */
    fun traversalTag(source: CatalogueSource): String = when {
        isAzora(source) -> "|sort=createdAt-asc"
        isArabicMangaDex(source) -> "|ar-chapters"
        else -> ""
    }

    private fun isAzora(source: CatalogueSource) = source.name == "Azora"

    private fun isArabicMangaDex(source: CatalogueSource) =
        source.name == "MangaDex" && source.lang.equals("ar", ignoreCase = true)

    private fun flatten(filters: List<Filter<*>>): List<Filter<*>> = filters.flatMap { filter ->
        if (filter is Filter.Group<*>) listOf(filter) + flatten(filter.state.filterIsInstance<Filter<*>>()) else listOf(filter)
    }

    private fun select(source: CatalogueSource, filters: FilterList, names: Set<String>, values: Set<String>) {
        val target = flatten(filters).filterIsInstance<Filter.Select<*>>().firstOrNull { it.name in names }
            ?: error("${source.name}: catalogue filter ${names.first()} not found")
        val index = target.values.indexOfFirst { it.toString() in values }
        check(index >= 0) { "${source.name}: ${target.name} has no ${values.first()}" }
        target.state = index
    }

    private fun check(source: CatalogueSource, filters: FilterList, name: String) {
        val target = flatten(filters).filterIsInstance<Filter.CheckBox>().firstOrNull { it.name == name }
            ?: error("${source.name}: catalogue filter \"$name\" not found")
        target.state = true
    }
}
