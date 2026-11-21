package com.vantara.plugins

import dev.vantara.spike.ContentWarning
import dev.vantara.spike.SPIKE_SOURCES
import dev.vantara.spike.SourceSpec

/**
 * المرحلة 2 من «صفر مصادر مدمجة» (docs/audits/ZERO_BUILTIN_MIGRATION_PLAN.md): كل حزمة مدمجة ظاهرة للحساب تصير
 * إضافة مثبّتة عادية، مرة واحدة، بلا شبكة ولا إصدار مختلف:
 *
 *  - السجل يشير إلى النسخة نفسها التي على الجهاز (البصمة والرابط من حالتها الحالية)، وآخر سليم قبلها إن وُجد على الجهاز.
 *  - مصادر السجل هي ما كان يراه الحساب: العربي (`pkg`) والتكملة (`pkg@lang`)، فلا يظهر ولا يختفي مصدر. والمعرّفات
 *    القديمة تبقى هي الظاهرة (LegacySourceIds)، فالمكتبة والتقدّم والتنزيلات لا تُلمس.
 *  - الحساب القديم و«بلا حساب» يُحفظ لهما مستودع Keiyoushi في قائمة مستودعاتهما (بياناتهما هما، مصادرهما جاءت منه)،
 *    فيستمر التحديث التلقائي. الحساب الجديد لا يُضاف له أبدًا (قرار المالك 21 نوفمبر).
 *  - الحزمة تُسجَّل في `formerBuiltins`: بعدها لها حالة واحدة (مثبّتة أو لا)، ومسار المدمجة لها مغلق. حذفها حذف حقيقي
 *    ولا تعود مدمجة، والترحيل لا يعيدها.
 *  - متكرر بأمان: حزمة مثبّتة أو مرحّلة سابقًا لا تُلمس.
 */
object BuiltinMigration {
    const val REPOSITORY_NAME = "Keiyoushi"

    /** لغة الإضافة من اسم حزمتها (`eu.kanade.tachiyomi.extension.<lang>.<name>`). */
    fun langOf(pkg: String): String = pkg.split('.').let { parts -> parts.getOrNull(parts.size - 2) ?: "all" }

    /**
     * مصادر السجل: ما كان المعرّف القديم يعنيه. `loaded` (اختياري) مصادر الحزمة المحمّلة الآن بأسمائها، لتكملة بلا
     * معرّف مثبّت (MangaDex الإنجليزية: أول مصدر بلغتها). بدونها تُترك، ومعرّفها القديم يبقى يصل لها عند الطلب.
     */
    fun sourcesOf(pkg: String, loaded: List<UserSource>? = null): List<UserSource> {
        val out = mutableListOf<UserSource>()
        SPIKE_SOURCES.firstOrNull { it.pkg == pkg }?.let { spec ->
            val id = spec.arabicSourceIds.firstOrNull()
            if (id != null) out += UserSource(id, spec.arabicSourceNames.firstOrNull() ?: spec.label, "ar")
        }
        for (filler in FILLER_SOURCES.filter { it.pkg == pkg }) {
            val pinned = filler.sourceId
            when {
                pinned != null -> out += UserSource(pinned, filler.label, filler.lang)
                loaded != null -> loaded.firstOrNull { it.lang.equals(filler.lang, ignoreCase = true) }?.let { out += it }
            }
        }
        return out.distinctBy { it.id }
    }

    /** سجل الإضافة المرحّلة من نسخة الجهاز الحالية [current] وآخر سليم قبلها [previous] (إن وُجدت نسخته). */
    fun record(base: SourceSpec, current: SourceSpec, previous: SourceSpec?, sources: List<UserSource>): UserExtension = UserExtension(
        repoUrl = BuiltinSourceRefresh.KEIYOUSHI_BASE, name = base.label, pkg = base.pkg, apkUrl = current.apkUrl,
        sha256 = current.sha256, versionName = current.versionName, lib = current.expectedLib, lang = langOf(base.pkg),
        nsfw = base.warning == ContentWarning.MIXED, sources = sources,
        previous = previous?.takeIf { !it.sha256.equals(current.sha256, ignoreCase = true) }
            ?.let { UserVersion(it.apkUrl, it.sha256, it.versionName, it.expectedLib, sources) },
    )

    data class Outcome(val state: UserExtensionState, val migrated: List<String>, val skipped: List<String>)

    /**
     * يطبّق الترحيل على الحالة (دالة خالصة، تُستدعى داخل `UserExtensionStore.update`): السجلات الجديدة تُضاف، وكل
     * حزمة طُلبت تُسجَّل مرحّلة، والمستودع يُحفظ إن طُلب ورُحّل شيء أو كانت إضافة منه مثبّتة.
     */
    fun apply(state: UserExtensionState, records: List<UserExtension>, keepRepository: Boolean): Outcome {
        val migrated = mutableListOf<String>()
        val skipped = mutableListOf<String>()
        var extensions = state.extensions
        for (record in records) {
            if (record.pkg in state.formerBuiltins || extensions.any { it.pkg == record.pkg }) { skipped += record.pkg; continue }
            extensions = extensions + record
            migrated += record.pkg
        }
        val former = (state.formerBuiltins + records.map { it.pkg }).distinct()
        val needsRepo = keepRepository && migrated.isNotEmpty() && state.repos.none { it.url == BuiltinSourceRefresh.KEIYOUSHI_BASE }
        val repos = if (needsRepo) state.repos + UserRepo(BuiltinSourceRefresh.KEIYOUSHI_BASE, REPOSITORY_NAME, BuiltinSourceRefresh.KEIYOUSHI_KEY) else state.repos
        return Outcome(state.copy(extensions = extensions, repos = repos, formerBuiltins = former), migrated, skipped)
    }
}
