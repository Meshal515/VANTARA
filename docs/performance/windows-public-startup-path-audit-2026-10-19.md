# Public torrent startup path audit, 2026-10-19

Audited VANTARA `cc81203b` (published Windows 0.3.16 integration plus subtitle fixes) against the immutable [rqbit 9.0.1 source](https://github.com/ikatson/rqbit/tree/a499d2f243d124e144aef137afe7cb304a6e3f36). This is a source audit and a deterministic proxy regression test. It does **not** reproduce the user's public swarm or establish first-frame improvement on Windows.

## Confirmed defect: response headers were held behind the first piece

rqbit's [streaming handler](https://github.com/ikatson/rqbit/blob/a499d2f243d124e144aef137afe7cb304a6e3f36/crates/librqbit/src/http_api/handlers/streaming.rs#L75) constructs Range status, content length, and content range before streaming verified bytes. VANTARA's torrent proxy called Node `res.writeHead()` and then piped the body. `writeHead()` alone buffers headers until the first body write or `end()`. Consequently a player requesting a missing piece could not inspect the engine's already-available headers until that piece arrived.

The regression test `torrent HTTP headers reach the player before a missing first piece is available` starts the real services/proxy and child-process fixtures. Its engine flushes a 206 response for bytes 0–3, then supplies **no body bytes** until the test explicitly releases a file gate. Before the fix the client response callback times out at 1.5 seconds. After adding `res.flushHeaders()`, the client receives exact Range headers before release, no `http-first-byte` event exists yet, and the subsequently released body is exactly `abcd`. The test also verifies separate `http-headers` and first-body-byte timings.

This fixes an HTTP response visibility defect. It does not make the missing verified piece arrive sooner and does not prove that header buffering caused this user's slow first frame. No timeout, peer, engine, or prefetch tuning follows from this reproduction.

## Metadata and discovery path

| Boundary | Verified behavior | Implication |
| --- | --- | --- |
| Selected file index supplied | Production defaults to one `POST /torrents?only_files=N` with the magnet. [rqbit session](https://github.com/ikatson/rqbit/blob/a499d2f243d124e144aef137afe7cb304a6e3f36/crates/librqbit/src/session.rs#L1245) merges already-seen metadata peers back into the same live receiver. | No duplicate list-only resolution in this path. Reintroducing list-only is not supported by this audit. |
| Index unavailable | VANTARA resolves `list_only=true`, selects the file, then performs the managed add with bounded public `initial_peers`. rqbit does not keep a managed handle for list-only. | Metadata is resolved twice; initial peers mitigate rediscovery. Exact metadata-byte reuse could avoid this later, but requires separate identity/cache validation and measured evidence. |
| Sources of peers | [make_peer_rx](https://github.com/ikatson/rqbit/blob/a499d2f243d124e144aef137afe7cb304a6e3f36/crates/librqbit/src/session.rs#L1528) merges DHT, trackers, initial peers, and enabled LSD. VANTARA enables DHT/trackers and disables LSD. | The application does not serially wait for each tracker before DHT. A failed tracker is not itself proof all discovery is blocked. |
| Metadata connections | [dht_utils](https://github.com/ikatson/rqbit/blob/a499d2f243d124e144aef137afe7cb304a6e3f36/crates/librqbit/src/dht_utils.rs#L42) allows 128 concurrent peer metadata operations and returns the first valid metadata result. | One slow/refused peer does not serially hold every later peer. Saturation remains possible, but has not been reproduced here. |
| Peer deadlines | [CLI defaults](https://github.com/ikatson/rqbit/blob/a499d2f243d124e144aef137afe7cb304a6e3f36/crates/rqbit/src/main.rs#L144) are connect 2s and read/write 10s; these are supplied to session peer options and inherited during metadata resolution. VANTARA does not override them. | These are per-operation limits, not a guaranteed total metadata duration. No evidence supports reducing them on the user's network. |
| Managed add response | rqbit resolves metadata, validates selected files, creates storage and registers the handle before returning. Initialization continues after the handle starts. | VANTARA's direct-index `magnet-metadata-start` → `magnet-metadata-complete` interval also includes managed registration/storage setup. It cannot isolate discovery from that work. |

## Observability limits that remain

VANTARA starts torrent stats polling only **after** the add response returns. rqbit registers the handle after metadata is available. Therefore existing torrent stats cannot distinguish zero discovered peers, refused peer connections, slow metadata transfers, or storage setup while the POST is pending. A `knownPeers: 0` sample after registration is not a retrospective measurement of metadata discovery.

For the next device-local diagnostic capture, retain distinct engine-ready, managed-add request/response/failure, metadata strategy, HTTP headers, first body byte, decoder readiness, and timeout stages. Only bounded numeric fields and enumerated error classifications should be emitted; raw magnets, tracker URLs, addresses, auth values, titles, and file paths are unnecessary. Diagnostic stage visibility is evidence collection, not a claimed performance repair.

After the add response, the useful distinction is requested-range progress versus aggregate transfer: connected peers and downloaded bytes alone do not prove the container's current piece is ready. Current code correctly uses actual proxy demand progress for its first-frame retry decision. mpv's initial cache pause and rqbit's 32 MiB reader priority window remain unchanged by this patch.

No public-swarm TCP test was performed. This environment offers proxied HTTP but lacks an authorized external raw-TCP identity; no proxy bypass was attempted. The user's exact hash/file index and device trace were unavailable. Existing owned loopback speed tests do not establish public discovery or missing-piece performance, and no engine replacement or unsafe fastresume change is justified by this audit.

## Verification

- Regression observed failing before the production change: response callback timed out while the engine withheld its body.
- Focused services, startup-trace, and replay HTTP tests: 54 passed, 0 failed.
- Full desktop `node --test`: 132 tests, 128 passed, 0 failed, 4 skipped. Skips cover the opt-in real-rqbit fixture, real-mpv fixture, torrent window integration, and Windows-only NTFS punching. This run does not substitute for those platform/integration checks.
- `node --check` for the two changed modules and `git diff --check` passed.
