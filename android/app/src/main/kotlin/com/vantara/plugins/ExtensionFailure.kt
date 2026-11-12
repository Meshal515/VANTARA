package com.vantara.plugins

import eu.kanade.tachiyomi.network.HttpException
import eu.kanade.tachiyomi.network.interceptor.HostCoolingException
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/**
 * تصنيف كل عطل في إضافة إلى واحد من أربعة، بسبب عربي صادق ورمز ثابت يقرؤه التشخيص:
 * عطل في VANTARA، عطل في الإضافة نفسها، عطل من الموقع أو الشبكة، أو وظيفة غير مدعومة.
 * لا رسالة خام بالإنجليزية تصل للمستخدم ("HttpException: HTTP error 403").
 */
object ExtensionFailure {
    enum class Owner { VANTARA, EXTENSION, SITE, UNSUPPORTED }

    data class Verdict(val owner: Owner, val code: String, val message: String)

    fun classify(t: Throwable): Verdict {
        val chain = generateSequence(t) { it.cause }.take(6).toList()
        chain.firstNotNullOfOrNull { it as? HostCoolingException }?.let {
            return Verdict(Owner.SITE, "HOST_COOLING", it.message ?: "الموقع يطلب التمهّل؛ أعد المحاولة بعد قليل")
        }
        chain.firstNotNullOfOrNull { it as? HttpException }?.let { return http(it.code) }
        chain.firstNotNullOfOrNull { it.message?.let(HTTP_TEXT::find)?.groupValues?.get(1)?.toIntOrNull() }?.let { return http(it) }
        // رموز محرك التشغيل المعزول (CloudStream) تصل نصًا: لكل رمز معروف سببه ومالكه
        chain.firstNotNullOfOrNull { e -> e.message?.takeIf { CODE.matches(it) }?.let(::fromCode) }?.let { return it }
        for (e in chain) when (e) {
            is UnknownHostException -> return Verdict(Owner.SITE, "SITE_DNS", "تعذّر الوصول لاسم الموقع (DNS): متوقف أو محجوب في شبكتك")
            is SocketTimeoutException -> return Verdict(Owner.SITE, "SITE_TIMEOUT", TIMEOUT)
            is ConnectException -> return Verdict(Owner.SITE, "SITE_UNREACHABLE", "تعذّر الاتصال بالموقع: متوقف أو محجوب في شبكتك")
            is SSLException -> return Verdict(Owner.SITE, "SITE_TLS", "اتصال الموقع الآمن غير صالح (شهادة أو حجب في الشبكة)")
            is UnsupportedOperationException, is NotImplementedError ->
                return Verdict(Owner.UNSUPPORTED, "UNSUPPORTED_CAPABILITY", "هذا المصدر لا يدعم هذه الوظيفة")
            // واجهة يطلبها كود الإضافة وغير موجودة في المحرك: فجوة توافق عندنا لا خطأ من الموقع
            is LinkageError, is AbstractMethodError ->
                return Verdict(Owner.VANTARA, "ENGINE_INCOMPATIBLE", "هذه الإضافة تطلب واجهة لا يوفّرها محرك VANTARA بعد")
        }
        // رسالة عربية مكتوبة للمستخدم أصلًا تبقى كما هي، ومالكها من رماها: المحرك («أضف المستودع أولًا»)
        // أو الإضافة نفسها (مصادر عربية ترمي «لا توجد نتائج» مثلًا)
        t.message?.takeIf { ARABIC.containsMatchIn(it) }?.let {
            val ours = t.stackTrace.firstOrNull()?.className.orEmpty().let { c -> c.startsWith("com.vantara.") || c.startsWith("dev.vantara.") }
            return Verdict(if (ours) Owner.VANTARA else Owner.EXTENSION, "REPORTED", it.take(240))
        }
        val text = chain.joinToString(" ") { it.message.orEmpty() }
        // رمز داخلي من المحرك لا جدول له بعد: من عندنا، ولا يصل للمستخدم كما هو
        chain.firstOrNull { e -> e.message?.let(CODE::matches) == true && e.stackTrace.firstOrNull()?.className.orEmpty().let { it.startsWith("com.vantara.") || it.startsWith("dev.vantara.") } }
            ?.let { return Verdict(Owner.VANTARA, it.message!!, "تعذّر تنفيذ عملية الإضافة داخل VANTARA") }
        if (CLOUDFLARE.containsMatchIn(text)) return Verdict(Owner.SITE, "SITE_VERIFICATION", "الموقع يطلب تحققًا (حماية Cloudflare)")
        if (chain.any { it is IOException }) return Verdict(Owner.SITE, "SITE_NETWORK", "انقطع الاتصال بالموقع أثناء الطلب")
        // كود الإضافة رمى أثناء قراءة صفحة الموقع: الموقع تغيّر أو في الإضافة خلل؛ ليس من المحرك
        if (chain.any { e -> PARSER.any { it.isInstance(e) } || e.javaClass.name.startsWith("kotlinx.serialization") || e.javaClass.name.startsWith("org.jsoup") })
            return Verdict(Owner.EXTENSION, "EXTENSION_PARSE", "الإضافة لم تستطع قراءة صفحة الموقع (تغيّر الموقع أو خلل في الإضافة)")
        return Verdict(Owner.EXTENSION, "EXTENSION_FAILED", "تعطّلت الإضافة أثناء الطلب")
    }

    /** رمز معروف من محرك التشغيل المعزول، أو null. */
    fun fromCode(code: String): Verdict? {
        CODES[code]?.let { return Verdict(it.first, code, it.second) }
        REPOSITORY_HTTP.matchEntire(code)?.let { return Verdict(Owner.SITE, code, "مستودع الإضافات ردّ بخطأ (${it.groupValues[1]})؛ أعد المحاولة لاحقًا") }
        return null
    }

    private val REPOSITORY_HTTP = Regex("REPOSITORY_HTTP_(\\d{3})")

    private fun http(code: Int) = when (code) {
        401, 403 -> Verdict(Owner.SITE, "SITE_HTTP_$code", "الموقع رفض الطلب ($code): حماية أو حجب لمنطقتك؛ جرّب شبكة أخرى أو VPN")
        404, 410 -> Verdict(Owner.SITE, "SITE_HTTP_$code", "الصفحة لم تعد موجودة في الموقع ($code)")
        429 -> Verdict(Owner.SITE, "SITE_HTTP_429", "الموقع يحدّ عدد الطلبات؛ أعد المحاولة بعد قليل")
        in 500..599 -> Verdict(Owner.SITE, "SITE_HTTP_$code", "خادم الموقع معطّل الآن ($code)")
        else -> Verdict(Owner.SITE, "SITE_HTTP_$code", "ردّ الموقع بخطأ غير متوقع ($code)")
    }

    private val CODE = Regex("[A-Z][A-Z0-9_]{2,60}")
    private const val TIMEOUT = "الموقع لم يرد في المهلة المحددة"
    private val CODES: Map<String, Pair<Owner, String>> = mapOf(
        "SITE_DNS" to (Owner.SITE to "تعذّر الوصول لاسم الموقع (DNS): متوقف أو محجوب في شبكتك"),
        "SITE_TLS" to (Owner.SITE to "اتصال الموقع الآمن غير صالح (شهادة أو حجب في الشبكة)"),
        "SITE_UNREACHABLE" to (Owner.SITE to "تعذّر الاتصال بالموقع: متوقف أو محجوب في شبكتك"),
        "SITE_NETWORK" to (Owner.SITE to "انقطع الاتصال بالموقع أثناء الطلب"),
        "OPERATION_TIMEOUT" to (Owner.SITE to TIMEOUT),
        "VERIFICATION_REQUIRED" to (Owner.SITE to "الموقع يطلب تحققًا (حماية Cloudflare)؛ افتح «تحتاج تحقق» في الإضافات"),
        "NO_VIDEO_LINKS" to (Owner.EXTENSION to "المصدر لم يُرجع روابط تشغيل لهذه الحلقة"),
        "NO_SEARCH_RESULT" to (Owner.EXTENSION to "الإضافة لم تُرجع نتيجة للبحث"),
        "NO_DETAIL_RESULT" to (Owner.EXTENSION to "الإضافة لم تُرجع تفاصيل هذا العمل"),
        "NO_CATALOGUE_RESULT" to (Owner.EXTENSION to "الإضافة لم تُرجع صفحة الكتالوج"),
        "EXTENSION_PARSE" to (Owner.EXTENSION to "الإضافة لم تستطع قراءة صفحة الموقع (تغيّر الموقع أو خلل في الإضافة)"),
        "PROVIDER_FAILED" to (Owner.EXTENSION to "تعطّلت الإضافة أثناء الطلب"),
        "PROVIDER_INITIALIZATION_FAILED" to (Owner.EXTENSION to "الإضافة فشلت عند تشغيلها"),
        "NO_REGISTERED_SOURCES" to (Owner.EXTENSION to "الإضافة لم تسجّل أي مصدر"),
        "PACKAGE_HASH_MISMATCH" to (Owner.EXTENSION to "ملف الإضافة لا يطابق بصمة مستودعها؛ لم يُثبَّت"),
        "PACKAGE_NOT_IN_REPOSITORY" to (Owner.EXTENSION to "الإضافة لم تعد في مستودعها"),
        "NOT_CLOUDSTREAM_REPOSITORY" to (Owner.EXTENSION to "الرابط ليس مستودع CloudStream"),
        "INVALID_REPOSITORY_INDEX" to (Owner.EXTENSION to "فهرس المستودع غير صالح"),
        "CAPABILITY_UNSUPPORTED" to (Owner.UNSUPPORTED to "هذا المصدر لا يدعم هذه الوظيفة"),
        "USER_INTERACTION_REQUIRED" to (Owner.UNSUPPORTED to "الإضافة تطلب نافذة تفاعلية لا تدعمها VANTARA بعد"),
        "NETWORK_INTERCEPTOR_CAPABILITY_UNSUPPORTED" to (Owner.UNSUPPORTED to "الإضافة تطلب اعتراض الشبكة، وهي قدرة لا تدعمها VANTARA بعد"),
        "ABI_MISMATCH" to (Owner.VANTARA to "هذه الإضافة تطلب واجهة لا يوفّرها محرك VANTARA بعد"),
        "UNSUPPORTED_HTTP_CLIENT_ABI" to (Owner.VANTARA to "هذه الإضافة تطلب واجهة شبكة لا يوفّرها محرك VANTARA بعد"),
        "ORIGIN_NOT_ALLOWED" to (Owner.VANTARA to "سياسة VANTARA منعت الإضافة من الاتصال بموقع لم تُعلنه"),
        "RUNTIME_INITIALIZATION_FAILED" to (Owner.VANTARA to "محرك الإضافات لم يبدأ على هذا الجهاز"),
        "SOURCE_DISABLED" to (Owner.VANTARA to "المصدر معطّل؛ فعّله من الإضافات"),
        "SOURCE_NOT_INSTALLED" to (Owner.VANTARA to "المصدر غير مثبت"),
        "PACKAGE_NOT_INSTALLED" to (Owner.VANTARA to "الإضافة غير مثبتة"),
    )
    private val ARABIC = Regex("[\u0600-\u06FF]")
    private val HTTP_TEXT = Regex("""\bHTTP (?:error )?(\d{3})\b""")
    private val CLOUDFLARE = Regex("cloudflare|cf[-_]chl|just a moment", RegexOption.IGNORE_CASE)
    private val PARSER = listOf(
        NullPointerException::class.java, IndexOutOfBoundsException::class.java, NoSuchElementException::class.java,
        NumberFormatException::class.java, ClassCastException::class.java, UninitializedPropertyAccessException::class.java,
    )
}
