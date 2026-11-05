package com.vantara.anime.player

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.TrackGroup
import androidx.media3.datasource.DataSource
import androidx.media3.decoder.DecoderInputBuffer
import androidx.media3.exoplayer.FormatHolder
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.FilteringMediaSource
import androidx.media3.exoplayer.source.MediaPeriod
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.MergingMediaSource
import androidx.media3.exoplayer.source.SampleStream
import androidx.media3.exoplayer.source.TrackGroupArray
import androidx.media3.exoplayer.source.WrappingMediaSource
import androidx.media3.exoplayer.trackselection.ExoTrackSelection
import androidx.media3.exoplayer.upstream.Allocator
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.Container
import java.io.IOException
import java.net.URI

/** Builds all candidate media through the caller's authenticated/cache-aware transport. */
object CandidateMediaSources {
    data class Result(
        val mediaSource: MediaSource,
        val externalAudioUrls: Set<String>,
        val rejectedAudio: List<RejectedExternalAudio>,
    )

    /**
     * Sidecars must describe the same content from time zero. Media3 merges equal period counts;
     * single-period VOD HLS/DASH and progressive audio work, independently segmented multi-period
     * DASH/live timelines may not. Offset adjustment aligns period starts, not dubbed content.
     * The primary timeline/duration is retained, even when a sidecar is shorter. Embedded tracks
     * and candidate subtitles remain in the primary source. An unavailable sidecar is a source
     * error: callers may retry once with [includeExternalAudio] false, retaining this candidate.
     */
    fun create(candidate: Candidate, dataSourceFactory: DataSource.Factory, includeExternalAudio: Boolean = true,
        mediaId: String = candidate.id): Result {
        val factory = DefaultMediaSourceFactory(dataSourceFactory)
        val item = MediaItem.Builder().setUri(candidate.url).setMediaId(mediaId).apply {
            when (candidate.container) {
                Container.HLS -> setMimeType(MimeTypes.APPLICATION_M3U8)
                Container.DASH -> setMimeType(MimeTypes.APPLICATION_MPD)
                else -> Unit // Preserve extractor sniffing for MP4, MKV and extensionless URLs.
            }
            setSubtitleConfigurations(candidate.subtitles.map { track ->
                MediaItem.SubtitleConfiguration.Builder(Uri.parse(track.url))
                    .setMimeType(subtitleMime(track.url)).setLanguage(track.lang).setLabel(track.lang)
                    .setSelectionFlags(if (track.lang.contains("ar", true) || track.lang.contains("عرب")) C.SELECTION_FLAG_DEFAULT else 0)
                    .build()
            })
        }.build()
        val primary = factory.createMediaSource(item)
        if (!includeExternalAudio) return Result(primary, emptySet(), emptyList())
        val plan = ExternalAudioPlan.from(candidate.audio)
        if (plan.accepted.isEmpty()) return Result(primary, emptySet(), plan.rejected)
        val sources = mutableListOf(primary)
        for ((index, audio) in plan.accepted.withIndex()) {
            val audioItem = MediaItem.Builder().setUri(audio.track.url).setMediaId("$mediaId|external-audio|$index").apply {
                when (audio.kind) {
                    ExternalAudioKind.HLS -> setMimeType(MimeTypes.APPLICATION_M3U8)
                    ExternalAudioKind.DASH -> setMimeType(MimeTypes.APPLICATION_MPD)
                    ExternalAudioKind.PROGRESSIVE -> Unit
                }
            }.build()
            // A supplied HLS/MP4 URL may contain video/text too. Only its audio is exposed.
            sources += NamedAudioMediaSource(FilteringMediaSource(factory.createMediaSource(audioItem), C.TRACK_TYPE_AUDIO), index, audio.track.lang)
        }
        return Result(MergingMediaSource(true, false, *sources.toTypedArray()), plan.accepted.map { it.track.url }.toSet(), plan.rejected)
    }

    private fun subtitleMime(url: String): String {
        val path = runCatching { URI(url).path.lowercase() }.getOrDefault(url.lowercase())
        return when {
            path.endsWith(".srt") -> MimeTypes.APPLICATION_SUBRIP
            path.endsWith(".ass") || path.endsWith(".ssa") -> MimeTypes.TEXT_SSA
            path.endsWith(".ttml") || path.endsWith(".xml") -> MimeTypes.APPLICATION_TTML
            else -> MimeTypes.TEXT_VTT
        }
    }
}

/** Candidate language is transport metadata; Media3 does not copy MediaItem labels to Formats. */
private class NamedAudioMediaSource(source: MediaSource, private val index: Int, private val language: String) : WrappingMediaSource(source) {
    override fun createPeriod(id: MediaSource.MediaPeriodId, allocator: Allocator, startPositionUs: Long): MediaPeriod =
        NamedAudioPeriod(mediaSource.createPeriod(id, allocator, startPositionUs), index, language)

    override fun releasePeriod(mediaPeriod: MediaPeriod) = mediaSource.releasePeriod((mediaPeriod as NamedAudioPeriod).child)
}

private class NamedAudioPeriod(val child: MediaPeriod, private val index: Int, private val language: String) : MediaPeriod by child, MediaPeriod.Callback {
    private lateinit var callback: MediaPeriod.Callback
    private var groups = TrackGroupArray.EMPTY
    private var prepareError: IOException? = null

    private fun named(format: Format): Format = format.buildUpon()
        .setId("external-audio|$index|${format.id.orEmpty()}")
        .setLanguage(language.ifBlank { format.language })
        .setLabel(language.ifBlank { format.label ?: "External audio" })
        .setSelectionFlags(format.selectionFlags and C.SELECTION_FLAG_DEFAULT.inv())
        .setRoleFlags((format.roleFlags and C.ROLE_FLAG_MAIN.inv()) or C.ROLE_FLAG_ALTERNATE)
        .build()

    override fun prepare(callback: MediaPeriod.Callback, positionUs: Long) {
        this.callback = callback
        child.prepare(this, positionUs)
    }

    override fun onPrepared(mediaPeriod: MediaPeriod) {
        val original = child.trackGroups
        if (original.length == 0) {
            prepareError = IOException("EXTERNAL_AUDIO_NO_AUDIO_TRACKS")
            return
        }
        groups = TrackGroupArray(*(0 until original.length).map { groupIndex ->
            val group = original[groupIndex]
            TrackGroup("external-audio-$index-$groupIndex", *(0 until group.length).map { named(group.getFormat(it)) }.toTypedArray())
        }.toTypedArray())
        callback.onPrepared(this)
    }

    override fun maybeThrowPrepareError() { prepareError?.let { throw it }; child.maybeThrowPrepareError() }
    override fun onContinueLoadingRequested(source: MediaPeriod) = callback.onContinueLoadingRequested(this)
    override fun getTrackGroups(): TrackGroupArray = groups

    private fun originalSelection(selection: ExoTrackSelection): ExoTrackSelection {
        val original = child.trackGroups[groups.indexOf(selection.trackGroup)]
        return OriginalAudioSelection(selection, original)
    }

    override fun getStreamKeys(trackSelections: List<ExoTrackSelection>) = child.getStreamKeys(trackSelections.map(::originalSelection))

    override fun selectTracks(selections: Array<out ExoTrackSelection?>, mayRetainStreamFlags: BooleanArray,
        streams: Array<out SampleStream?>, streamResetFlags: BooleanArray, positionUs: Long): Long {
        val originals = Array<ExoTrackSelection?>(selections.size) { selections[it]?.let(::originalSelection) }
        val childStreams = Array<SampleStream?>(streams.size) { (streams[it] as? NamedSampleStream)?.child }
        val position = child.selectTracks(originals, mayRetainStreamFlags, childStreams, streamResetFlags, positionUs)
        @Suppress("UNCHECKED_CAST")
        val writableStreams = streams as Array<SampleStream?>
        for (i in streams.indices) {
            val existing = streams[i] as? NamedSampleStream
            writableStreams[i] = childStreams[i]?.let { if (existing?.child === it) existing else NamedSampleStream(it) }
        }
        return position
    }

    private inner class NamedSampleStream(val child: SampleStream) : SampleStream by child {
        override fun readData(formatHolder: FormatHolder, buffer: DecoderInputBuffer, readFlags: Int): Int {
            val result = child.readData(formatHolder, buffer, readFlags)
            if (result == C.RESULT_FORMAT_READ) formatHolder.format = formatHolder.format?.let(::named)
            return result
        }
    }
}

/** Retains Media3 selection equivalence across track changes, as MergingMediaPeriod does. */
private class OriginalAudioSelection(private val selection: ExoTrackSelection, private val original: TrackGroup) : ExoTrackSelection by selection {
    override fun getTrackGroup(): TrackGroup = original
    override fun getFormat(index: Int): Format = original.getFormat(selection.getIndexInTrackGroup(index))
    override fun getSelectedFormat(): Format = original.getFormat(selection.selectedIndexInTrackGroup)
    override fun indexOf(format: Format): Int {
        val originalIndex = original.indexOf(format)
        return if (originalIndex < 0) -1 else selection.indexOf(originalIndex)
    }
    override fun equals(other: Any?): Boolean = other is OriginalAudioSelection && selection == other.selection && original == other.original
    override fun hashCode(): Int = 31 * selection.hashCode() + original.hashCode()
}
