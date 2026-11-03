package com.vantara.anime.player

import com.vantara.anime.stream.TrackRef
import java.net.URI

enum class ExternalAudioKind { PROGRESSIVE, HLS, DASH }
enum class ExternalAudioRejection { INVALID_URL, UNSUPPORTED_CONTAINER, DUPLICATE, TRACK_LIMIT }
data class ExternalAudioTrack(val track: TrackRef, val kind: ExternalAudioKind)
data class RejectedExternalAudio(val track: TrackRef, val reason: ExternalAudioRejection)
data class ExternalAudioPlan(val accepted: List<ExternalAudioTrack>, val rejected: List<RejectedExternalAudio>) {
    companion object {
        /** Candidate sidecars carry no MIME hint: only known containers can be chosen safely. */
        fun from(tracks: List<TrackRef>): ExternalAudioPlan {
            val accepted = mutableListOf<ExternalAudioTrack>()
            val rejected = mutableListOf<RejectedExternalAudio>()
            val seen = mutableSetOf<String>()
            for (track in tracks) {
                val uri = runCatching { URI(track.url) }.getOrNull()
                val path = uri?.path?.lowercase().orEmpty()
                val kind = when (path.substringAfterLast('.', "")) {
                    "m3u8" -> ExternalAudioKind.HLS
                    "mpd" -> ExternalAudioKind.DASH
                    "mp3", "m4a", "aac", "mp4", "wav", "flac", "ogg", "opus" -> ExternalAudioKind.PROGRESSIVE
                    else -> null
                }
                val reason = when {
                    uri == null || uri.scheme?.lowercase() !in setOf("https", "http", "file", "content", "asset") ||
                        (uri.scheme?.lowercase() in setOf("https", "http") && uri.host.isNullOrBlank()) -> ExternalAudioRejection.INVALID_URL
                    kind == null -> ExternalAudioRejection.UNSUPPORTED_CONTAINER
                    !seen.add(track.url) -> ExternalAudioRejection.DUPLICATE
                    accepted.size >= 8 -> ExternalAudioRejection.TRACK_LIMIT
                    else -> null
                }
                if (reason != null) rejected += RejectedExternalAudio(track, reason)
                else accepted += ExternalAudioTrack(track, requireNotNull(kind))
            }
            return ExternalAudioPlan(accepted, rejected)
        }
    }
}
