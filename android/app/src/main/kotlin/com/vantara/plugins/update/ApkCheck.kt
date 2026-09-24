package com.vantara.plugins.update

/**
 * هل هذا الملف تحديثٌ رسمي لهذا التطبيق؟ بلا أندرويد: يُختبر على JVM.
 *
 * أندرويد نفسه يرفض تثبيت APK بمفتاح مختلف أو رقم أقل، لكن بعد أن يعرض
 * شاشته وبرسالة لا يفهمها أحد. هنا نرفض قبلها وبسبب واضح.
 */
object ApkCheck {
    /**
     * بصمة شهادة توقيع VANTARA المستقر (SHA-256). CI يرفض أي بناء مستقر
     * بغيرها، والتطبيق يرفض أي تحديث بغيرها.
     */
    const val STABLE_CERT_SHA256 = "0b5cce2127f3bb107a3ee01fe7e6c51b58d18ab3fe5292e6b944bbfe86a76bb0"

    enum class Verdict {
        OK,
        /** ليس ملف APK قابلًا للقراءة. */
        UNREADABLE,
        /** تطبيق آخر. */
        WRONG_PACKAGE,
        /** ليس أحدث من المثبّت: أندرويد يرفض الرجوع. */
        NOT_NEWER,
        /** ليس موقّعًا بمفتاح VANTARA الرسمي. */
        NOT_OFFICIAL,
        /** المثبّت الآن موقّع بمفتاح آخر (نسخة تجريبية): التحديث فوقه مستحيل. */
        INSTALLED_DIFFERENT_KEY,
    }

    data class Apk(val packageName: String, val versionCode: Long, val certs: Set<String>)

    fun verify(candidate: Apk?, installed: Apk, officialCert: String = STABLE_CERT_SHA256): Verdict {
        if (candidate == null || candidate.certs.isEmpty()) return Verdict.UNREADABLE
        if (candidate.packageName != installed.packageName) return Verdict.WRONG_PACKAGE
        if (candidate.certs != setOf(officialCert.lowercase())) return Verdict.NOT_OFFICIAL
        if (installed.certs != candidate.certs) return Verdict.INSTALLED_DIFFERENT_KEY
        if (candidate.versionCode <= installed.versionCode) return Verdict.NOT_NEWER
        return Verdict.OK
    }
}
