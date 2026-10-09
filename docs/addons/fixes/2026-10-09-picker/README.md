# APK 0.0.129 — torrent choices stuck at HTTP probing

The user's Fight Club screenshots showed 73 results indefinitely labelled `نفحص التشغيل` with indistinguishable TRR codes. Native preparation already allowed registered torrent tickets into selection, deliberately without starting network acquisition or claiming an HTTP probe. Its serialized Route did not expose this readiness. Cinema's selector required `probed === true`, disabled every torrent tile and labelled every `probed == null` result as HTTP probing. Torrent tickets intentionally never enter HTTP probing, so these tiles could never settle.

A separate `runtimeReady` flag now crosses the native route boundary. It means the user may select a native runtime ticket, **not** that peers/metadata/first frame were verified. The selector says `يبدأ عند الاختيار` and keeps ordinary HTTP probes independent. Failure removes runtime readiness. `probed` stays null for torrents; HTTP gates, THE ROCK, routing codes, fallback ranking, user-selected playback and no-autoplay remain intact.

Provider name and release description now accompany addon choices instead of opaque TRR-only presentation. The first six addon releases per quality remain visible; extra releases stay available in a closed `نسخ إضافية` fold. Ordinary-source rows are not limited. Identical raw responses are deduplicated before torrent ticket allocation; different files/releases/provider replies are retained.

Validation:
- Native regression failed before the fix at the serialized readiness field and duplicate allocation assertions; afterwards all **380 native JVM tests** passed.
- **1118 web tests**, including the actual cinema renderer with 73 torrent choices, with/without a pending HTTP route: no autoplay, immediately enabled torrent tile, retained 67 folded choices, user click reaches the player bridge.
- **54 repository safety tests** passed; service-worker digest changed.
- [Mobile](mobile.png) and [desktop](desktop.png) are real Chromium renders of the actual renderer's controlled 73-release fixture using production CSS, not screenshots from the user's Android device. The empty hero is deliberate fixture data. They verify layout, not public torrent availability.

Public Fight Club/Torrentio metadata acquisition, peers and playback after selection on the user's phone remain **UNVERIFIED**. This fix removes the proven selector deadlock; it does not turn a weak swarm into a verified working stream.
