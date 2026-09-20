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
