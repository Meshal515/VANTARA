# Internal startup diagnostic additions

These events add visibility only. They do not change discovery, deadlines, cache policy, player options, recovery, or media acceptance. They are not evidence that the user's movie starts successfully and do not justify publication.

| Stage | Meaning | Fields |
| --- | --- | --- |
| `cache-selection-start` | Before checking a retained volume or enumerating/selecting a cache root | none |
| `cache-selection-complete` | A usable cache root was selected; directory preparation follows | `waitMs` |
| `managed-add-start` | Immediately before each actual selected-file POST | `fileIdx` |
| `managed-add-complete` | That POST returned successfully | `waitMs` |
| `managed-add-error` | That POST failed, before the existing retry or terminal error path | `waitMs`, `errorCode`, optional HTTP `statusCode` |
| `player-end-file` | MPV sent an end-file event, before existing EOF/error handling | `reasonCode`, `errorCode` |
| `decoder-output` | Existing decoder readiness check succeeded | existing mode plus `decoderWidth`, `decoderHeight` |

The managed-add events describe each request, so the existing initial-peers HTTP 400 fallback produces start/error/start/complete. A direct-index add still includes metadata discovery and managed registration; those cannot be split using this HTTP endpoint alone. A pending start without completion/error, followed by a startup budget expiry, identifies the outstanding boundary.

`managed-add-error.errorCode`: 1 timeout; 2 connection refused; 3 connection reset/broken pipe; 4 cancellation; 5 HTTP failure; 6 other. The stopped-session guard continues suppressing events after cancellation. `statusCode` is supplied only for an HTTP response error.

`player-end-file.reasonCode`: 0 unrecognized; 1 EOF; 2 stop; 3 quit; 4 error; 5 redirect.

`player-end-file.errorCode`: 0 no file error supplied; 1 loading failed; 2 unrecognized file format; 3 audio output initialization failed; 4 video output initialization failed; 5 not supported; 6 other. These are local diagnostic categories, not MPV's negative API error numbers. Arbitrary error text is not retained. A generic loading failure does not distinguish network, container, or codec failure. Decoder dimensions establish decoded output, not visible presentation.

Tests exercise the real services flow with child-process engine/player fixtures: success stage order, rejected managed-add classification before terminal error, MPV format failure classification before terminal error, and the trace numeric whitelist. These are controlled diagnostic tests, not a public-swarm playback benchmark.
