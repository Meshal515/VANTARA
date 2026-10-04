/** Live controls for actual browser soft cues. Never prepares or seeks media. */
export const SUBTITLE_SIZES = [75, 100, 125, 150, 175, 200, 250];
export function createSubtitleAdjustments({ video, onChange = () => {} }) {
  let track = null,
    timing = false,
    delay = 0,
    size = 100,
    position = 90,
    positioned = false;
  const originals = new Map();
  let lastCapabilities = "";
  const values = () => ({ delay, size, position });
  const capabilities = () => {
    const cue = track?.cues?.[0];
    return {
      timing: Boolean(cue && timing),
      size: Boolean(cue && "line" in cue),
      position: Boolean(cue && "line" in cue),
    };
  };
  function times(cue, start, end) {
    // Preserve ordering even when the two values move past their old interval.
    if (start > cue.startTime) {
      cue.endTime = end;
      cue.startTime = start;
    } else {
      cue.startTime = start;
      cue.endTime = end;
    }
  }
  function font() {
    if (!track || size === 100)
      video.style.removeProperty("--pp-subtitle-size");
    else {
      // Browser cues use 5% of the smaller video viewport dimension, not
      // the letterboxed picture height (390x844 portrait => 19.5px at 100%).
      const height = Math.min(video.clientHeight, video.clientWidth);
      video.style.setProperty(
        "--pp-subtitle-size",
        `${(height * 0.05 * size) / 100}px`,
      );
    }
  }
  function refresh() {
    for (const cue of track?.cues ?? []) {
      if (!originals.has(cue))
        originals.set(cue, {
          start: cue.startTime,
          end: cue.endTime,
          line: cue.line,
          snap: cue.snapToLines,
          align: cue.lineAlign,
        });
      const original = originals.get(cue);
      if (
        timing &&
        (cue.startTime !== original.start + delay ||
          cue.endTime !== original.end + delay)
      )
        times(cue, original.start + delay, original.end + delay);
      if (positioned && "line" in cue) {
        if (cue.snapToLines) cue.snapToLines = false;
        if (cue.line !== position) cue.line = position;
        const align = position === 0 ? "start" : position === 100 ? "end" : "center";
        if (cue.lineAlign !== align) cue.lineAlign = align;
      }
    }
    font();
    const next = JSON.stringify(capabilities());
    if (next !== lastCapabilities) { lastCapabilities = next; onChange(); }
  }
  function restore() {
    for (const [cue, original] of originals) {
      if (timing) times(cue, original.start, original.end);
      if ("line" in cue) {
        cue.line = original.line;
        cue.snapToLines = original.snap;
        cue.lineAlign = original.align;
      }
    }
    originals.clear();
  }
  function bind(next, options = {}) {
    track?.removeEventListener?.("cuechange", refresh);
    restore();
    track = next;
    timing = options.timing === true;
    delay = 0;
    track?.addEventListener?.("cuechange", refresh);
    refresh();
    onChange();
  }
  function set(key, value) {
    const caps = capabilities();
    if (!Number.isFinite(value) || !caps[key === "delay" ? "timing" : key])
      throw new Error("هذا التحكم غير مدعوم لهذه الترجمة");
    if (key === "delay")
      delay = Math.round(Math.max(-10, Math.min(10, value)) * 10) / 10;
    else if (key === "size") {
      if (!SUBTITLE_SIZES.includes(value)) throw new Error("حجم غير مدعوم");
      size = value;
    } else if (key === "position") {
      position = Math.round(Math.max(0, Math.min(100, value)));
      positioned = true;
    }
    refresh();
    onChange();
  }
  video.addEventListener?.("resize", font);
  return {
    values,
    capabilities,
    bind,
    refresh,
    set,
    close() {
      bind(null);
      video.removeEventListener?.("resize", font);
    },
  };
}
