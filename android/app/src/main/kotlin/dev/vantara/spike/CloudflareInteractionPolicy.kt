package dev.vantara.spike

enum class CloudflareInteractiveAction {
    FAIL_FAST,
    SHOW_BROWSER,
}

/**
 * Automated batch probes must never steal the whole screen for a human
 * challenge. Manual browsing may opt into the visible challenge flow.
 */
fun cloudflareInteractiveAction(batchProbe: Boolean): CloudflareInteractiveAction =
    if (batchProbe) {
        CloudflareInteractiveAction.FAIL_FAST
    } else {
        CloudflareInteractiveAction.SHOW_BROWSER
    }

/**
 * سياسة العملية كلها، لأن الاعتراض يُنشأ داخل `NetworkHelper` بلا طريق لتمرير
 * خيار إليه.
 *
 * الافتراض FAIL_FAST كما كان في الـspike. تطبيق القارئ يغيّره عند التحميل:
 * بدون ذلك يرى القارئ «محجوب» حيث كان يكفيه أن يحلّ التحدّي بيده.
 */
object CloudflareInteractionMode {
    @Volatile
    var batchProbe: Boolean = true

    fun action(): CloudflareInteractiveAction = cloudflareInteractiveAction(batchProbe)
}
