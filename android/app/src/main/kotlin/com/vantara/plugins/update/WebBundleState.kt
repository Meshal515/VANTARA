package com.vantara.plugins.update

/**
 * أي حزمة واجهة تُعرض، ومتى تُعتمد، ومتى يُرجع عنها. بلا أندرويد: يُختبر على JVM.
 *
 * دورة الحزمة:
 *
 *   staged ──(طلب المستخدم أو `promoteNow`)──▶ trial ──(`healthy`)──▶ good
 *                                                  │
 *                          (لم تؤكد نفسها) ────────┴──▶ bad + رجوع إلى good
 *
 * - **staged**: نزلت وتحققت بصمتها وتوافقها، ولم تُعرض بعد. التبديل لا يحدث
 *   تحت يد المستخدم أثناء القراءة.
 * - **trial**: معروضة الآن، لكن لم تثبت أنها تعمل. الواجهة تنادي `healthy`
 *   بعد أول شاشة. إقلاعان بلا تأكيد (أو مهلة المراقب) = رجوع تلقائي.
 * - **good**: آخر حزمة أكدت نفسها. فارغ = الواجهة المدمجة في الـAPK، وهي
 *   الأرضية التي لا تنكسر أبدًا.
 * - **bad**: إصدارات فشلت على هذا الجهاز؛ لا تُنزَّل مرة ثانية.
 *
 * `native` بصمة الكود الأصلي. حزمة بُنيت لبصمة أخرى لا تُعرض أبدًا، وتغيّر
 * البصمة (APK جديد) يمسح كل الحالة: الواجهة المدمجة في الـAPK الجديد أحدث.
 */
class WebBundleState(
    private val own: KeyValue,
    /** تفضيلات Capacitor (`CapWebViewSettings`): منها يقرأ مسار الواجهة عند الإقلاع. */
    private val cap: KeyValue,
    private val exists: (String) -> Boolean,
    private val native: String,
    private val bundledVersion: String? = null,
) {
    interface KeyValue {
        fun get(key: String): String?
        fun put(key: String, value: String?)
    }

    sealed class Boot {
        object Nothing : Boot()
        /** تغيّر الـAPK: الحالة مُسحت، والمجلدات القديمة تُحذف. */
        object Reset : Boot()
        data class Trial(val version: String) : Boot()
        data class RolledBack(val version: String) : Boot()
    }

    /** يُنادى مرة في كل إقلاع، قبل أن يقرأ Capacitor المسار. */
    fun onBoot(): Boot {
        if (own.get(NATIVE) != native) {
            clearAll(keepBad = false)
            own.put(NATIVE, native)
            cap.put(CAP_PATH, "")
            return Boot.Reset
        }
        // An APK can embed newer web without changing the native fingerprint.
        // Never let an old downloaded bundle hide that newer bundled code.
        forgetOlderBundle(GOOD, GOOD_VERSION)
        forgetOlderBundle(TRIAL, TRIAL_VERSION, TRIAL_BOOTS)
        forgetOlderBundle(STAGED, STAGED_VERSION, STAGED_MANUAL)
        val trial = own.get(TRIAL)
        if (trial != null) {
            val version = own.get(TRIAL_VERSION) ?: ""
            val boots = (own.get(TRIAL_BOOTS)?.toIntOrNull() ?: 0) + 1
            if (!exists(trial) || boots > MAX_TRIAL_BOOTS) {
                rollback()
                return Boot.RolledBack(version)
            }
            own.put(TRIAL_BOOTS, boots.toString())
            return Boot.Trial(version)
        }
        // حزمة طلبها المستخدم تبقى قابلة للإكمال بعد إغلاق التطبيق أثناء التنزيل.
        // الحزم القديمة التي نزلت تلقائيًا لا تُفعّل عند الإقلاع.
        return if (own.get(STAGED_MANUAL) == "true") {
            promote()?.let { Boot.Trial(it.second) } ?: Boot.Nothing
        } else Boot.Nothing
    }

    /** حزمة تحققت: الطلب اليدوي وحده يسمح بإكمالها في الإقلاع التالي. */
    fun stage(path: String, version: String, bundleNative: String, userInitiated: Boolean = false): Boolean {
        if (bundleNative != native || version in bad() || olderThanBundled(version)) return false
        own.put(STAGED, path)
        own.put(STAGED_VERSION, version)
        own.put(STAGED_MANUAL, userInitiated.toString())
        return true
    }

    /** تُعرض الآن (رجوع من الخلفية بعد مدة). المسار أو null إن لا شيء جاهز. */
    fun promoteNow(): Pair<String, String>? = if (own.get(TRIAL) != null) null else promote()

    private fun promote(): Pair<String, String>? {
        val staged = own.get(STAGED) ?: return null
        val version = own.get(STAGED_VERSION) ?: ""
        own.put(STAGED, null)
        own.put(STAGED_VERSION, null)
        own.put(STAGED_MANUAL, null)
        if (!exists(staged) || version in bad()) return null
        own.put(TRIAL, staged)
        own.put(TRIAL_VERSION, version)
        own.put(TRIAL_BOOTS, "1")
        cap.put(CAP_PATH, staged)
        return staged to version
    }

    /** الواجهة المعروضة تعمل. `true` إن كانت هذه أول مرة تُعتمد فيها. */
    fun healthy(runningVersion: String): Boolean {
        val trial = own.get(TRIAL) ?: return false
        if (own.get(TRIAL_VERSION) != runningVersion) return false
        own.put(GOOD, trial)
        own.put(GOOD_VERSION, runningVersion)
        own.put(TRIAL, null)
        own.put(TRIAL_VERSION, null)
        own.put(TRIAL_BOOTS, null)
        return true
    }

    fun inTrial(version: String) = own.get(TRIAL) != null && own.get(TRIAL_VERSION) == version

    /** رجوع إلى آخر حزمة سليمة. يرجع مسارها، و"" للواجهة المدمجة. */
    fun rollback(): String {
        own.get(TRIAL_VERSION)?.let { markBad(it) }
        own.put(TRIAL, null)
        own.put(TRIAL_VERSION, null)
        own.put(TRIAL_BOOTS, null)
        val good = own.get(GOOD)?.takeIf { exists(it) && !olderThanBundled(own.get(GOOD_VERSION)) } ?: ""
        if (good.isEmpty()) {
            own.put(GOOD, null)
            own.put(GOOD_VERSION, null)
        }
        cap.put(CAP_PATH, good)
        return good
    }

    /** يدويًا من «النظام»: الواجهة المدمجة في الـAPK. */
    fun reset() {
        clearAll(keepBad = true)
        cap.put(CAP_PATH, "")
    }

    fun bad(): Set<String> = own.get(BAD)?.split(',')?.filter { it.isNotEmpty() }?.toSet() ?: emptySet()

    fun stagedVersion(): String? = own.get(STAGED_VERSION)

    fun goodVersion(): String? = own.get(GOOD_VERSION)

    /** المجلدات التي تبقى على القرص؛ غيرها يُحذف. */
    fun keep(): Set<String> = listOfNotNull(own.get(GOOD), own.get(TRIAL), own.get(STAGED)).toSet()

    private fun markBad(version: String) {
        if (version.isEmpty()) return
        // آخر عشرة تكفي: الإصدار الأحدث يلغي حاجة الأقدم
        own.put(BAD, (bad().toList() + version).distinct().takeLast(10).joinToString(","))
    }

    private fun clearAll(keepBad: Boolean) {
        for (k in listOf(STAGED, STAGED_VERSION, STAGED_MANUAL, TRIAL, TRIAL_VERSION, TRIAL_BOOTS, GOOD, GOOD_VERSION)) own.put(k, null)
        if (!keepBad) own.put(BAD, null)
    }

    private fun forgetOlderBundle(pathKey: String, versionKey: String, vararg otherKeys: String) {
        if (!olderThanBundled(own.get(versionKey))) return
        val previous = own.get(pathKey)
        own.put(pathKey, null)
        own.put(versionKey, null)
        for (key in otherKeys) own.put(key, null)
        if (previous != null && cap.get(CAP_PATH) == previous) {
            cap.put(CAP_PATH, own.get(GOOD)?.takeIf(exists) ?: "")
        }
    }

    /** Stable versions are numeric. Unknown local/debug labels never evict web. */
    private fun olderThanBundled(version: String?): Boolean {
        fun components(value: String?): List<Long>? {
            if (value == null || !value.matches(Regex("[0-9]+(?:\\.[0-9]+){0,3}"))) return null
            return value.split('.').map { it.toLongOrNull() ?: return null }
        }
        val candidate = components(version) ?: return false
        val bundled = components(bundledVersion) ?: return false
        for (index in 0 until maxOf(candidate.size, bundled.size)) {
            val comparison = (candidate.getOrElse(index) { 0L }).compareTo(bundled.getOrElse(index) { 0L })
            if (comparison != 0) return comparison < 0
        }
        return false
    }

    companion object {
        const val CAP_PATH = "serverBasePath"
        /** إقلاعان بلا تأكيد: الأول قد يُغلق قبل أول شاشة، الثاني لا عذر له. */
        const val MAX_TRIAL_BOOTS = 2
        private const val NATIVE = "native"
        private const val STAGED = "staged"
        private const val STAGED_VERSION = "stagedVersion"
        private const val STAGED_MANUAL = "stagedManual"
        private const val TRIAL = "trial"
        private const val TRIAL_VERSION = "trialVersion"
        private const val TRIAL_BOOTS = "trialBoots"
        private const val GOOD = "good"
        private const val GOOD_VERSION = "goodVersion"
        private const val BAD = "bad"
    }
}
