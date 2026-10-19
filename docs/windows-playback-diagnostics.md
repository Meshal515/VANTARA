# Windows playback diagnostics

When a source loads slowly or fails, press **Alt**, open **مساعدة**, then choose
**نسخ تشخيص تشغيل الفيديو**. **Ctrl+Shift+D** activates the same menu action.
Paste the copied JSON into your support conversation. Copying also works after
the video has closed; keep the application open until you have copied the report.

The report includes the app version, platform, current or most recent playback
attempt, and up to 256 allowed diagnostic events. Torrent sources include their
validated info hash and optional file index, so you do not need to find the hash
yourself. Direct sources are identified only as `direct`.

The report excludes URLs, titles, account/session IDs, headers, tokens, file
paths, and raw error messages. Failures use fixed classes. Nothing is uploaded
automatically: the clipboard changes only when you activate the menu action.
The report stays in memory and is cleared when the app exits or playback starts
again. Earlier events may fall out of the 256-event limit on long sessions.

`elapsedMs` measures time since the main process received the playback attempt.
`traceElapsedMs` measures the service's startup trace clock. Peer counts, checked
bytes, transfer speed, HTTP timing, and decoder milestones help explain where
startup waits. `render-unmeasured` does not prove a frame appeared on screen.
This feature collects evidence from the affected device; it does not establish
that slow public torrents or Windows movie playback have been fixed.
