Authored local HLS/DASH regression fixtures. They contain the first four seconds of
video from `../player-audio/primary.mp4`; no external service or footage is used.
The H.264 stream is copied without transcoding. These fixtures intentionally omit
audio because this test proves format admission and actual video decoding;
`CandidateExternalAudioDeviceTest` separately proves audio selection/decoding.

Regenerate from the repository root (ffmpeg 7.x):

```sh
ffmpeg -y -i android/app/src/androidTest/assets/player-audio/primary.mp4 \
  -t 4 -map 0:v:0 -an -c:v copy -hls_time 1 -hls_playlist_type vod \
  -hls_segment_filename 'android/app/src/androidTest/assets/player-formats/hls/segment-%02d.ts' \
  android/app/src/androidTest/assets/player-formats/hls/manifest.m3u8
ffmpeg -y -i android/app/src/androidTest/assets/player-audio/primary.mp4 \
  -t 4 -map 0:v:0 -an -c:v copy -f dash -seg_duration 1 \
  -use_template 1 -use_timeline 1 -init_seg_name 'init-$RepresentationID$.m4s' \
  -media_seg_name 'chunk-$RepresentationID$-$Number%03d$.m4s' \
  android/app/src/androidTest/assets/player-formats/dash/manifest.mpd
```

`PreparedHttpPlaybackDeviceTest` serves these files from a real test-owned loopback
HTTP server and requires Referer, Origin, User-Agent, Authorization and either an
explicit Cookie or inherited CookieJar cookie on every manifest/segment request.
A test-only OkHttp route maps the reserved HTTPS fixture hostname onto that
server. Production addon URL/DNS policy remains unchanged; the separate public
HTTPS test covers the actual addon transport.

The tests run production addon candidate parsing, cancellable probing, Prepared
admission and `CandidateMediaSources`, then require first-frame/continuing decoder
output. The DASH body receives a UTF-8 BOM and long XML comment; HLS is deliberately
served as text/plain. An HTML error response must remain outside the playback
session. Per-format device evidence is written under app files `addon-proof/`.
