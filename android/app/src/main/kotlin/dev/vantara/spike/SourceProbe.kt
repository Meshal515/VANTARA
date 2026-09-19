package dev.vantara.spike

import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.model.FilterList
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import eu.kanade.tachiyomi.source.online.HttpSource
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit
import kotlin.coroutines.cancellation.CancellationException

/**
 * السلسلة الخمس لمصدر واحد، ثم قياس الكتالوج.
 *
 * كل خطوة تُسجَّل باسمها ووقتها ودليلها. **ولا تُصنَّف تلقائيًّا.**
 *
 * وهذا تصحيح مقصود لمنهج أسبق كان يقول: `NoClassDefFoundError` يعني
 * محرّكًا، و`IOException` يعني مصدرًا، وأن موقعًا يرجع 200 لـ`curl` يجعل
 * سقوط البحث عطلَ محرّك. وثلاثتها أقوى من الدليل:
 *
 *  - **200 يثبت أن الموقع حيّ، لا أن عقده لم يتغيّر.** الموقع قد يخدم
 *    صفحة سليمة بترميز HTML جديد يكسر selectors الإضافة، فيسقط التحليل
 *    والموقع بريء والمحرك بريء — والمتغيّر هو الموقع.
 *  - **`IOException` قد يكون من عندنا**: اعتراض مُعدٌّ خطأً، أو `cookieJar`
 *    ناقص، أو ترويسة مفقودة. الاستثناء يقول «فشل نقل»، لا «الموقع مذنب».
 *  - **و`NoClassDefFoundError` قرينة قوية على المحرك، لا برهان**: قد يكون
 *    من صنفٍ اختياري تطلبه الإضافة ولا نوفّره، وهو نقص مستضيف بحقّ — لكن
 *    اسم الصنف هو ما يفصل، لا نوع الاستثناء.
 *
 * فالمسبار يجمع الدليل: نوع الاستثناء واسمه، **وفحصًا حيًّا للموقع في نفس
 * اللحظة** لا خطَّ أساسٍ من الأمس. ثم يعرض **فرضية موسومة كفرضية**،
 * والتصنيف يبقى لقارئ التقرير.
 */
class SourceProbe(private val http: OkHttpClient) {

    data class Step(
        val name: String,
        val ok: Boolean,
        val detail: String,
        val millis: Long,
        /** نوع الاستثناء واسمه عند الفشل. فارغ عند النجاح. */
        val exceptionType: String? = null,
        /**
         * فحص مستقل للموقع **لحظةَ الفشل**.
         *
         * هذا هو الفرق بين دليل وحكم: خطّ أساسٍ قديم لا يقول شيئًا عن
         * الآن، وموقعٌ كان حيًّا أمس قد يكون ساقطًا أو متغيّرًا اليوم.
         */
        val live: LiveCheck? = null,
        /** فرضية موسومة، لا حكم. */
        val hypothesis: String? = null,
    )

    /** ما رآه طلبٌ خامّ للموقع في نفس اللحظة، بلا الإضافة. */
    data class LiveCheck(
        val url: String,
        val status: Int?,
        val bytes: Int?,
        val contentType: String?,
        val error: String?,
    ) {
        fun describe(): String = when {
            error != null -> "الموقع: تعذّر الوصول ($error)"
            else -> "الموقع: HTTP $status · ${bytes ?: 0} بايت · ${contentType ?: "?"}"
        }
    }

    data class CatalogueReach(
        /** عدد الأعمال الفريدة التي كُشفت فعلًا. */
        val uniqueWorks: Int,
        /** كم صفحة طُلبت. */
        val pagesFetched: Int,
        /** هل بلغنا النهاية فعلًا، أو توقفنا عند السقف؟ */
        val reachedEnd: Boolean,
        val stoppedBecause: String,
    )

    data class Report(
        val label: String,
        /**
         * المضيف الذي تضربه الإضافة فعلًا بعد اختيارها مرآتها.
         *
         * يُعرض لأن التشغيل الحيّ أظهر مصدرًا نجح بحثه وتفاصيله ثم طلب
         * الفصول من مضيف آخر تمامًا. بلا طباعة هذه القيمة يبقى السؤال
         * «أي مضيف؟» بلا جواب في كل تقرير.
         */
        val baseUrl: String?,
        val steps: List<Step>,
        /** رابط صورة صفحة حقيقية، تُعرض في الشاشة لا تُوصف. */
        val imageUrl: String?,
        val imageBytes: Int?,
        /**
         * بايتات الصورة كما قبِلها المسبار.
         *
         * تُحفظ ولا يُعاد تنزيلها للعرض: الطلب الثاني يخرج بعميلٍ آخر وبلا
         * ترويسات المصدر — و`Referer` خاصةً — فكثير من مضيفات الصور تردّه
         * 403، فتُقرأ صورةٌ صحيحة على أنها «لم تُفكَّك». والعرض من هذه
         * البايتات يجعل ما يُرى هو نفسه ما أُثبت.
         */
        val imageData: ByteArray?,
        /**
         * مدى قائمة الفصول: عددها، وأحدثها، وأقدمها.
         *
         * العدد وحده لا يقول هل القائمة كاملة. مصدرٌ ردّ ٩٩٧ فصلًا لعملٍ
         * يُعرف أنه تجاوز الألف قد يكون أرشيفه ناقصًا، أو قد يكون رقّم
         * فصولًا بكسور، أو قد تكون قائمته مُصفّحة ولم نأخذ إلا أولها.
         * وطرفا القائمة يفصلان بين هذه الاحتمالات في سطر واحد، بلا تخمين.
         */
        val chapterSpan: String?,
        /** الفصل الذي جاءت منه الصورة المعروضة، لا فصلٌ مجهول. */
        val imageFromChapter: String?,
        val reach: CatalogueReach?,
    ) {
        val passed: Boolean get() = steps.all { it.ok } && (imageBytes ?: 0) > 0
        val failedAt: String? get() = steps.firstOrNull { !it.ok }?.name
    }

    /**
     * ما تعرضه الشاشة **قبل** أن تبدأ الخطوة.
     *
     * يُسند مرة واحدة في أول `run`، والتشغيل متسلسل مصدرًا بعد مصدر فلا
     * تتزاحم عليه خطوتان.
     */
    private var announce: suspend (String) -> Unit = {}

    /**
     * خطوة واحدة: تُعلَن قبلها، وتُوقَّت، وتُمهَل، ولا تُفلت رميةً واحدة.
     *
     * والإعلان قبل التنفيذ ليس زينة. خطوة واحدة قد تستغرق دقائق مشروعة:
     * `callTimeout` دقيقتان، وداخلها إعادة محاولة ثلاثية لـGET، وداخل كل
     * محاولة قد يفتح اعتراض Cloudflare متصفحًا مخفيًّا وينتظره عشرين ثانية.
     * وطوال ذلك لم يكن يُطبع حرف: الشاشة تقف عند آخر سطر نجح، فتُقرأ كأن
     * التطبيق مات. الآن يظهر اسم الخطوة أولًا، فيُعرف أين نحن لا أين كنّا.
     *
     * والمهلة تُكمل المعنى: ما تجاوزها يصير سطرًا أحمر مقروءًا، والتشغيل
     * يمضي إلى الخطوة التالية بدل أن يُعلّق البقية خلفه.
     */
    private suspend fun <T> step(
        name: String,
        into: MutableList<Step>,
        baseUrl: String?,
        timeoutMs: Long = STEP_TIMEOUT_MS,
        block: suspend () -> T,
    ): T? {
        announce(name)
        val started = System.currentTimeMillis()
        return try {
            val value = withTimeout(timeoutMs) { block() }
            into += Step(name, true, describe(value), System.currentTimeMillis() - started)
            value
        } catch (t: Throwable) {
            // إلغاءٌ حقيقي (إغلاق الشاشة) يمرّ؛ ومهلتُنا وحدها تُلتقط. بلا
            // هذا التمييز يبتلع المسبار إلغاء النطاق فيبدو حيًّا وهو ميت.
            if (t is CancellationException && t !is TimeoutCancellationException) throw t

            val kind = t.javaClass.name
            val msg = when (t) {
                is TimeoutCancellationException -> "تجاوز المهلة (${timeoutMs / 1000}ث)"
                else -> diagnostic(t)
            }
            // الدليل يُجمع **الآن**: الموقع لحظةَ الفشل، لا أمس
            val live = baseUrl?.let { liveCheck(it) }
            into += Step(
                name = name,
                ok = false,
                detail = "$kind: $msg",
                millis = System.currentTimeMillis() - started,
                exceptionType = kind,
                live = live,
                hypothesis = hypothesise(t, live),
            )
            null
        }
    }

    /**
     * عميل الفحص الحيّ: نفس إعداد المصدر، بمهلة نداءٍ أقصر.
     *
     * الفحص يجري **داخل معالج الفشل**، فلو أخذ دقيقتَي العميل الأصلي تأخّر
     * السطر الذي يشرح الفشل أصلًا — ويصير التشخيص هو ما يؤخّر التشخيص.
     */
    private val prober: OkHttpClient by lazy {
        http.newBuilder().callTimeout(LIVE_CHECK_TIMEOUT_S, TimeUnit.SECONDS).build()
    }

    /**
     * طلب خامّ للموقع، بلا الإضافة وبلا عميلها.
     *
     * غرضه واحد: هل الموقع نفسه يردّ الآن؟ ولا يقول أكثر من ذلك — وتحديدًا
     * **لا يقول** إن عقد الصفحة لم يتغيّر.
     */
    private fun liveCheck(baseUrl: String): LiveCheck = try {
        val request = Request.Builder().url(baseUrl)
            .header("user-agent", RAW_UA)
            .build()
        prober.newCall(request).execute().use { res ->
            val body = res.body.bytes()
            LiveCheck(baseUrl, res.code, body.size, res.header("content-type"), null)
        }
    } catch (t: Throwable) {
        LiveCheck(baseUrl, null, null, null, "${t.javaClass.simpleName}: ${t.message?.take(120)}")
    }

    /**
     * فرضية، وتُقرأ كفرضية.
     *
     * لا تُستعمل للحكم ولا تُغلق التشخيص؛ تقول للقارئ من أين يبدأ. وكل
     * فرضية تحمل سببها، فمن يخالفها يخالف سببًا لا نبرة.
     */
    private fun hypothesise(t: Throwable, live: LiveCheck?): String {
        val name = t.javaClass.name
        val missing = (t as? NoClassDefFoundError)?.message?.take(120)

        return when {
            // مهلة ليست فشلًا مُسمّى: لا تقول الموقعَ ولا المحرك، تقول
            // «طال». والفحص الحيّ هو ما يوجّه القراءة بعدها.
            t is TimeoutCancellationException ->
                "فرضية: الخطوة طالت ولم تُنهِ (النوع $name). " +
                    if (live != null && live.error == null) {
                        "والموقع يردّ ${live.status} لطلبٍ خامّ الآن، فالبطء " +
                            "أقرب إلى مسارنا (إعادة محاولة، اعتراض Cloudflare، " +
                            "متصفح مخفيّ) منه إلى سقوط الموقع — وليست قطعًا."
                    } else {
                        "ولا فحص حيّ ناجح يرافقها، فقد يكون الموقع نفسه بطيئًا."
                    }
            // صنف مفقود يسمّي نفسه: القرينة هنا في **الاسم** لا في النوع
            t is NoClassDefFoundError || t is ClassNotFoundException ->
                "فرضية: نقصٌ في سطح المستضيف — الصنف الغائب «$missing». " +
                    "تُحقَّق بالبحث عنه في `eu/kanade/tachiyomi/` وفي الاعتماديات."
            t is LinkageError ->
                "فرضية: تعارض إصدارات في اعتمادية (OkHttp/serialization). " +
                    "تُحقَّق من `resolutionStrategy` ومن شجرة الاعتماديات."
            live?.error != null ->
                "فرضية: الموقع لا يردّ الآن. تُحقَّق بإعادة المحاولة لاحقًا، " +
                    "ولا تُنسب إلى المحرك قبل ذلك."
            live != null && live.status !in 200..299 ->
                "فرضية: الموقع ردّ HTTP ${live.status}. قد يكون حجبًا أو " +
                    "تغييرَ مسار — ولا يزال محتملًا أن ترويسةً عندنا هي السبب."
            live != null ->
                "فرضية **غير محسومة**: الموقع يردّ ${live.status} الآن، فالعطل " +
                    "إمّا تغيّرُ عقدِ الصفحة (selectors) أو إعدادٌ في محرّكنا " +
                    "(ترويسة، كوكي، اعتراض). الدليل لا يفصل بينهما، " +
                    "ويُفصل بمقارنة صفحة الموقع بما تتوقّعه الإضافة."
            else ->
                "فرضية: غير محسومة — لا فحص حيّ متاح لهذه الخطوة."
        }
    }

    private fun diagnostic(t: Throwable): String {
        val chain = generateSequence(t) { it.cause }
            .take(4)
            .joinToString(" <- ") { x ->
                val m = x.message?.replace("\n", " ")?.take(180) ?: "(no message)"
                "${x.javaClass.name}: $m"
            }
        val frames = t.stackTrace.take(6)
            .joinToString(" | ") { f -> "${f.className}.${f.methodName}:${f.lineNumber}" }
        return "$chain\nstack: $frames"
    }

    private fun describe(value: Any?): String = when (value) {
        null -> "null"
        is Collection<*> -> "${value.size} عنصرًا"
        is SManga -> value.title.take(60)
        is SChapter -> value.name.take(60)
        else -> value.toString().take(80)
    }

    suspend fun run(
        label: String,
        source: CatalogueSource,
        onStepStart: suspend (String) -> Unit = {},
    ): Report {
        announce = onStepStart
        val steps = mutableListOf<Step>()
        // `baseUrl` من المصدر نفسه لا من بياننا: الإضافة قد تكون هاجرت إلى
        // مرآة أخرى (`baseUrl { mirrors(...) }`)، فالفحص الحيّ يجب أن يضرب
        // ما تضربه الإضافة فعلًا.
        // بعض الإضافات تحسب baseUrl عبر تفضيلات/اعتماديات عند أول وصول.
        // فشل getter نفسه لا يجوز أن يهرب خارج المسبار ويسقط التطبيق.
        val base = runCatching { (source as? HttpSource)?.baseUrl }.getOrNull()

        // ١) البحث
        val found = step("search", steps, base) {
            // نبدأ باستعلام الاختبار المثبّت. لو رجع صفرًا، ما نحكم أن
            // البحث مكسور مباشرة: قد يكون العنوان ببساطة غير موجود في هذا
            // المصدر. نأخذ عنوانًا موجودًا الآن من Popular ثم نبحث عنه
            // حرفيًا؛ نجاحه يثبت أن مسار البحث نفسه يعمل.
            val preferred = queryFor(label)
            val firstTry = source.getSearchManga(1, preferred, FilterList())
            if (firstTry.mangas.isNotEmpty()) {
                firstTry.mangas
            } else {
                val seed = source.getPopularManga(1).mangas.firstOrNull()?.title
                    ?: error("search returned zero results and popular returned no seed title")
                val retry = source.getSearchManga(1, seed, FilterList())
                require(retry.mangas.isNotEmpty()) {
                    "search returned zero results for pinned query and live title: $seed"
                }
                retry.mangas
            }
        }

        // بلا نتيجة بحث لا معنى لبقية السلسلة: نتوقف ونقول أين
        val first = found?.firstOrNull()
            ?: return Report(label, base, steps, null, null, null, null, null, null)

        // ٢) تفاصيل العمل
        val details = step("details", steps, base) {
            // الوسيط الثاني هو الفصول **المعروفة سلفًا**، وهي فارغة في أول
            // استعلام. حذفُه كان خطأً عندي لا في العقد.
            source.getMangaUpdate(
                manga = first,
                chapters = emptyList(),
                fetchDetails = true,
                fetchChapters = false,
            ).manga.apply {
                // Details parsers commonly return a partial SManga without url.
                // The host already knows the canonical url from search and must
                // carry it forward before asking for chapters.
                url = first.url
            }
        } ?: first

        // ٣) الفصول
        val chapters = step("chapters", steps, base) {
            val list = source.getMangaUpdate(
                manga = details,
                chapters = emptyList(),
                fetchDetails = false,
                fetchChapters = true,
            ).chapters
            require(list.isNotEmpty()) { "chapter list is empty" }
            list
        }

        // طرفا القائمة لا عددُها وحده. «٩٩٧ فصلًا» لا يقول هل القائمة كاملة
        // أم مقطوعة؛ أما أحدثُ فصل وأقدمُه فيقولان المدى، ومنه يُعرف إن كان
        // النقص في أرشيف المصدر أو في قراءتنا نحن.
        val chapterSpan = chapters?.takeIf { it.isNotEmpty() }?.let { list ->
            "الأحدث «${list.first().name.take(48)}» · الأقدم «${list.last().name.take(48)}»"
        }

        val chapter = chapters?.firstOrNull()
        if (chapter == null) {
            return Report(label, base, steps, null, null, null, chapterSpan, null, null)
        }

        // ٤) الصفحات
        val pages = step("pages", steps, base) {
            val list = source.getPageList(chapter)
            require(list.isNotEmpty()) { "page list is empty" }
            list
        }

        // ٥) صورة فعلية — بايتات حقيقية لا رابط فقط
        var imageUrl: String? = null
        var imageBytes: Int? = null
        var imageData: ByteArray? = null
        val page = pages?.firstOrNull()
        if (page != null) {
            step("image", steps, base) {
                val asHttp = source as? HttpSource
                // المصدر قد يعطي الرابط في الصفحة، أو يشتقه بطلب ثانٍ
                val url = page.imageUrl
                    ?: asHttp?.let { runCatching { it.getImageUrl(page) }.getOrNull() }
                    ?: error("page carries no imageUrl")
                imageUrl = url
                // `imageRequest` محمية في العقد، فنبني الطلب بترويسات المصدر
                // نفسها: كثير من المواقع يرفض بلا `Referer` الصحيح.
                val request = Request.Builder().url(url)
                    .apply { asHttp?.headers?.let { headers(it) } }
                    .build()
                val caller = asHttp?.client ?: http
                caller.newCall(request).execute().use { response ->
                    require(response.isSuccessful) { "image HTTP ${response.code}" }
                    val body = response.body.bytes()
                    require(body.size > 1024) { "image too small: ${body.size} bytes" }
                    imageBytes = body.size
                    imageData = body
                    "${body.size} بايت · ${response.header("content-type")}"
                }
            }
        }

        // ٦) عيّنة كتالوج فقط: هل `getPopularManga` يعمل أصلًا؟
        //
        // الإحصاء الكامل **ليس هنا**. مصدرٌ بآلاف الأعمال يحتاج مئات الصفحات
        // ودقائق طويلة، ووضعُ ذلك داخل فحص السلسلة كان يجعل أربعة مصادر
        // تنتظر خلف واحد. فالعدّ الحقيقي صار زرًّا مستقلًّا يمشي حتى يقول
        // المصدرُ نفسه: لا مزيد.
        val reach = if (steps.all { it.ok }) {
            walkCatalogue(source, SAMPLE_PAGE_CAP, SAMPLE_BUDGET_MS) { p, n ->
                announce("عيّنة الكتالوج · صفحة $p · $n عملًا")
            }
        } else {
            null
        }
        return Report(label, base, steps, imageUrl, imageBytes, imageData, chapterSpan, chapter.name, reach)
    }

    /**
     * الإحصاء الكامل: يمشي حتى **يقول المصدر** لا مزيد.
     *
     * المالك طلب «كل أعمال المصدر من أول لآخر عمل»، وسقف الأربعين صفحة كان
     * يقطع العدّ عند ٤٠٠ ويُعلن صراحة أنه لم يُثبت النهاية. فلا سقف هنا إلا
     * حاجزُ أمانٍ بعيد، وكلُّ توقُّفٍ يُسمّى بسببه حتى لا يُقرأ رقمٌ ناقص
     * كأنه النهاية.
     */
    suspend fun crawlCatalogue(
        source: CatalogueSource,
        onProgress: suspend (Int, Int) -> Unit,
    ): CatalogueReach = walkCatalogue(source, FULL_PAGE_CAP, FULL_BUDGET_MS, onProgress)

    /**
     * كم عملًا يستطيع هذا المصدر كشفه فعلًا؟
     *
     * لا نكتفي بـ`hasNextPage`: مصادر تقول `true` إلى الأبد، ومصادر تعيد
     * نفس الصفحة. فالتوقف على ثلاث علامات، وكلٌّ منها يُسجَّل بالاسم:
     *
     *  - `end-of-catalogue`  — الخادم قال لا مزيد، **وهذا وحده إثبات النهاية**
     *  - `repeat`            — الصفحة الجديدة لم تُضف عملًا واحدًا: حلقة
     *  - `page-cap`          — بلغنا سقفنا، فلم نُثبت النهاية ونقولها صريحة
     */
    private suspend fun walkCatalogue(
        source: CatalogueSource,
        pageCap: Int,
        budgetMs: Long,
        onProgress: suspend (Int, Int) -> Unit,
    ): CatalogueReach {
        val seen = LinkedHashSet<String>()
        // عدّاد صريح لِما جُلب بنجاح. اشتقاقه من رقم الصفحة عند الخروج كان
        // يخطئ باثنتين في اتجاهين متعاكسين: صفحةٌ سقطت تُحسب مجلوبة، وصفحةُ
        // التكرار لا تُحسب وقد جُلبت. والرقم هنا يُقرأ كدليل، فوجب صدقه.
        var fetched = 0
        var page = 1
        var stoppedBecause = "page-cap"
        var reachedEnd = false
        val deadline = System.currentTimeMillis() + budgetMs

        while (page <= pageCap) {
            // ميزانية زمنية للقياس كله: أربعون صفحة على مصدر بطيء تبتلع
            // التشغيل وتترك المصادر الباقية بلا اختبار، والعدد الناقص
            // يُعلَن سببه فلا يُقرأ كأنه نهاية الكتالوج.
            if (System.currentTimeMillis() >= deadline) {
                stoppedBecause = "time-budget"
                break
            }
            onProgress(page, seen.size)
            val result = try {
                withTimeout(STEP_TIMEOUT_MS) { source.getPopularManga(page) }
            } catch (t: Throwable) {
                if (t is CancellationException && t !is TimeoutCancellationException) throw t
                stoppedBecause = when (t) {
                    is TimeoutCancellationException -> "timeout@p$page"
                    else -> "error@p$page: ${t.javaClass.simpleName}"
                }
                break
            }
            fetched += 1

            val before = seen.size
            result.mangas.forEach { seen += it.url }
            if (seen.size == before) {
                stoppedBecause = "repeat"
                break
            }
            if (!result.hasNextPage) {
                stoppedBecause = "end-of-catalogue"
                reachedEnd = true
                break
            }
            page += 1
        }

        return CatalogueReach(
            uniqueWorks = seen.size,
            pagesFetched = fetched,
            reachedEnd = reachedEnd,
            stoppedBecause = stoppedBecause,
        )
    }

    private fun queryFor(label: String): String =
        SPIKE_SOURCES.firstOrNull { it.label == label }?.query ?: "مانجا"

    private companion object {
        /** ترويسة الفحص الخامّ: نفس ما استُعمل في خطّ الأساس، فالمقارنة عادلة. */
        const val RAW_UA =
            "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/120 Mobile Safari/537.36"

        /**
         * عيّنة فحص السلسلة: تثبت أن `getPopularManga` يعمل، ولا تدّعي عدًّا.
         */
        const val SAMPLE_PAGE_CAP = 3
        const val SAMPLE_BUDGET_MS = 60_000L

        /**
         * حاجز الأمان للإحصاء الكامل، لا سقفَ سياسة.
         *
         * الغرض أن يتوقّف العدّ عند `end-of-catalogue` — أي عند قول المصدر
         * نفسه — لا عند رقمٍ اخترتُه أنا. وهذا الحاجز موجود لئلّا يدور
         * الزحف أبدًا على مصدرٍ يقول `hasNextPage = true` إلى ما لا نهاية،
         * وإذا بُلغ فإنه يُعلَن سببًا للتوقّف ولا يُقدَّم كنهاية.
         */
        const val FULL_PAGE_CAP = 5_000
        const val FULL_BUDGET_MS = 45L * 60L * 1000L

        /**
         * مهلة الخطوة الواحدة.
         *
         * أوسع من `callTimeout` الافتراضي للعميل بقليل، فلا تقطع نداءً
         * مشروعًا، وأضيق من أن تُجمّد الشاشة بلا خبر.
         */
        const val STEP_TIMEOUT_MS = 150_000L

        /** الفحص الحيّ يجري داخل معالج الفشل، فيُقطع أسرع من النداء العادي. */
        const val LIVE_CHECK_TIMEOUT_S = 20L
    }
}
