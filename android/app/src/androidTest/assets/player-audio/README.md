Authored regression fixtures, generated locally with ffmpeg; no external footage or audio.

`primary.mp4` reuses the repository's authored 12-second `../addon-torrent-proof.mp4`
video and `../addon-http-proof.vtt` text, adds a 440 Hz sine wave labelled Japanese,
and embeds the text as MP4 tx3g. `alternate.m4a` is an 8-second 880 Hz sine wave.
Its shorter duration verifies that adding an audio sidecar does not truncate video.

Regenerate from the repository root:

```sh
ffmpeg -y -i android/app/src/androidTest/assets/addon-torrent-proof.mp4 \
  -f lavfi -i sine=frequency=440:duration=12 \
  -i android/app/src/androidTest/assets/addon-http-proof.vtt \
  -map 0:v:0 -map 1:a:0 -map 2:s:0 -c:v copy -c:a aac -b:a 32k \
  -c:s mov_text -metadata:s:a:0 language=jpn -metadata:s:s:0 language=eng \
  -t 12 android/app/src/androidTest/assets/player-audio/primary.mp4
ffmpeg -y -f lavfi -i sine=frequency=880:duration=8 -c:a aac -b:a 32k \
  -metadata:s:a:0 language=ara android/app/src/androidTest/assets/player-audio/alternate.m4a
```

Device proof: `CandidateExternalAudioDeviceTest`. It checks separate M4A and MP4
sidecars, language/label metadata, default embedded selection, manual external
selection reaching the audio decoder, seek, decoded audio output and continuing
video frames, plus preservation of embedded and external subtitles. The MP4
sidecar deliberately contains extra video/text that must be filtered out.
