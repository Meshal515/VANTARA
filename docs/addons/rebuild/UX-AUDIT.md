# Current implementation audit — 2026-10-04

Actual Chromium rendered `v35/shell.js`, `addons-view.js` and the existing production styles at 1366×768 and 390×844 with an isolated local store. The public OpenSubtitles v3 manifest was fetched through the real PWA transport. BrowserAct cannot run here because no API key/browser is configured; local Chromium supplied the browser evidence.

| Evidence | Observation | Effect |
| --- | --- | --- |
| screenshots/before-desktop.png | A single column of generic name buttons and paragraphs, large gaps, no cards or logos | Hard to scan a library or know which action to take |
| screenshots/before-mobile.png | Many horizontally clipped filters, dense technical copy, no content/language/status hierarchy | Confusing entry point for ordinary users |
| screenshots/before-preview-mobile.png | URL only; `manifest` wording, awkward permissions wording and no installed-state preview | Doesn't support user's JSON/file flows or explain setup |
| screenshots/before-duplicate-error.png | Live install succeeded, then anime filter hid it. With a real registry snapshot, exact duplicate install failed | Matches supplied screenshot error; unnecessary replacement is the root cause |

Browser reproduction output: liveManifest=OpenSubtitles v3, hiddenByAnime=true, duplicateBlocked=true, JavaScript errors=0. The snapshot was deliberately held to reproduce the guard; which lifecycle owned the user's original phone snapshot is UNVERIFIED.

Architectural findings and public corpus are in STREMIO-RESEARCH.md; native/session boundary in NATIVE-BOUNDARY-AUDIT.md. They distinguish actual protocol bugs from unknown phone/network behavior. Core source and native transport success are not inferred from external manifest success.
