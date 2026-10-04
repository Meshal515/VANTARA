import {
  discoverSubtitles,
  language,
  toWebVtt,
  subtitleRequest,
} from "../../addons/subtitles.js";
import { publicUrl } from "../../addons/manifest.js";
import { createTransport } from "../../addons/transport.js";
import { createSubtitleAdjustments } from "./subtitle-adjustments.js";
/** lifecycle مستقل؛ لا ينادي play ولا ينتظر منه المشغل. */
export function createSubtitleSession({
  video,
  getHls = () => null,
  providers = [],
  transport = createTransport(),
  identity = {},
  onChange = () => {},
  onHealth = () => {},
}) {
  let generation = 0,
    controller = null,
    list = [],
    selected = null,
    closed = false,
    working = false,
    mediaReady = false,
    manualChoice = false,
    hls = null,
    hlsClass = null;
  const nodes = new Map(),
    blobs = new Set();
  const change = () => {
    if (!closed) onChange();
  };
  const adjustments = createSubtitleAdjustments({ video, onChange: change });
  function detach() {
    if (hls && hlsClass) {
      hls.off?.(hlsClass.Events.SUBTITLE_TRACKS_UPDATED, loaded);
      hls.off?.(hlsClass.Events.SUBTITLE_FRAG_PROCESSED, subtitleCues);
    }
    hls = null;
    hlsClass = null;
  }
  function clear() {
    adjustments.bind(null);
    controller?.abort();
    detach();
    for (const n of nodes.values()) n.remove();
    nodes.clear();
    for (const u of blobs) URL.revokeObjectURL(u);
    blobs.clear();
    list = [];
    selected = null;
    working = false;
    mediaReady = false;
    for (const t of video.textTracks ?? []) t.mode = "disabled";
  }
  function tracks() {
    const out = [...list];
    if (!mediaReady)
      return out.sort(
        (a, b) => Number(b.lang === "ar") - Number(a.lang === "ar"),
      );
    const hs = getHls();
    if (hs?.subtitleTracks?.length)
      hs.subtitleTracks.forEach((t, i) =>
        out.push({
          id: `hls|${i}`,
          kind: "source",
          lang: language(t.lang),
          label: t.name ?? t.lang ?? "ترجمة",
          hlsIndex: i,
        }),
      );
    else
      [...(video.textTracks ?? [])]
        .filter(
          (t) =>
            ["subtitles", "captions"].includes(t.kind) &&
            ![...nodes.values()].some((n) => n.track === t),
        )
        .forEach((t, i) =>
          out.push({
            id: `embedded|${i}`,
            kind: "source",
            lang: language(t.language),
            label: t.label ?? t.language ?? "ترجمة",
            native: t,
          }),
        );
    return out.sort(
      (a, b) =>
        Number(b.kind === "source") - Number(a.kind === "source") ||
        Number(b.lang === "ar") - Number(a.lang === "ar") ||
        Number(b.match === "release") - Number(a.match === "release"),
    );
  }
  function resetMedia() {
    adjustments.bind(null);
    detach();
    mediaReady = false;
    change();
  }
  function attachHls(instance, Hls) {
    detach();
    hls = instance;
    hlsClass = Hls;
    hls.on?.(Hls.Events.SUBTITLE_TRACKS_UPDATED, loaded);
    hls.on?.(Hls.Events.SUBTITLE_FRAG_PROCESSED, subtitleCues);
  }
  function subtitleCues() {
    const t = tracks().find((t) => t.id === selected);
    if (t?.hlsIndex == null) return;
    const native = [...(video.textTracks ?? [])].find(
      (track) =>
        track.mode === "showing" &&
        ["subtitles", "captions"].includes(track.kind),
    );
    if (native && !adjustments.capabilities().size)
      adjustments.bind(native, { timing: false });
    else adjustments.refresh();
    change();
  }
  function setStream(candidate) {
    clear();
    generation++;
    const run = generation;
    controller = new AbortController();
    for (const [i, t] of (candidate.subtitles ?? []).entries()) {
      try {
        list.push({
          id: `source|${i}`,
          kind: "source",
          url: publicUrl(t.url).href,
          lang: language(t.lang ?? t.language),
          label: t.label ?? t.lang ?? "ترجمة",
        });
      } catch {}
    }
    change();
    const context = {
      ...identity,
      ...Object.fromEntries(
        Object.entries(candidate.identity ?? {}).filter(([k, v]) => v != null && (k !== "kind" || ["movie", "series", "anime"].includes(v))),
      ),
    };
    if (!providers.length || !subtitleRequest(context, candidate)) return;
    working = true;
    void discoverSubtitles({
      identity: context,
      stream: candidate,
      providers,
      signal: controller.signal,
      onHealth,
      onResult: (t) => {
        if (closed || run !== generation) return;
        list.push(t);
        change();
      },
    })
      .catch(() => {})
      .finally(() => {
        if (!closed && run === generation) {
          working = false;
          change();
        }
      });
  }
  async function select(id, { automatic = false } = {}) {
    if (!automatic) manualChoice = true;
    const run = generation;
    adjustments.bind(null);
    selected = id;
    const t = tracks().find((x) => x.id === id);
    const hs = getHls();
    if (hs) hs.subtitleTrack = -1;
    for (const track of video.textTracks ?? []) track.mode = "disabled";
    if (!t) {
      change();
      return;
    }
    if (t.hlsIndex != null) {
      hs.subtitleTrack = t.hlsIndex;
      change();
      return;
    }
    if (t.native) {
      t.native.mode = "showing";
      adjustments.bind(t.native, { timing: true });
      change();
      return;
    }
    let n = nodes.get(t.id);
    if (!n) {
      const text = await transport.text(t.url, { signal: controller.signal });
      const vtt = toWebVtt(text);
      if (run !== generation || closed || selected !== id) return;
      const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
      blobs.add(url);
      n = document.createElement("track");
      n.kind = "subtitles";
      n.srclang = t.lang;
      n.label = t.label;
      n.src = url;
      nodes.set(t.id, n);
      n.addEventListener("load", () => {
        if (closed || run !== generation || selected !== id) return;
        adjustments.bind(n.track, { timing: true });
      });
      video.append(n);
    }
    if (n.track) n.track.mode = "showing";
    if (n.track?.cues?.length) adjustments.bind(n.track, { timing: true });
    change();
  }
  function loaded() {
    mediaReady = true;
    change();
    const arabic = tracks().find((t) => t.kind === "source" && t.lang === "ar");
    if (!manualChoice && selected === null && arabic)
      void select(arabic.id, { automatic: true }).catch(() => {});
  }
  video.addEventListener("loadedmetadata", loaded);
  video.textTracks?.addEventListener?.("addtrack", change);
  video.textTracks?.addEventListener?.("removetrack", change);
  function close() {
    if (closed) return;
    closed = true;
    generation++;
    clear();
    adjustments.close();
    video.removeEventListener("loadedmetadata", loaded);
    video.textTracks?.removeEventListener?.("addtrack", change);
    video.textTracks?.removeEventListener?.("removetrack", change);
  }
  return {
    setStream,
    setIdentity(next) {
      identity = next;
    },
    resetMedia,
    attachHls,
    tracks,
    select,
    close,
    adjustments,
    pending: () => working,
    selected: () => selected,
    available: () =>
      tracks().length > 0 || providers.some((p) => p.healthy === true),
  };
}
