/** مستويات معلنة من master فقط، دون تخمين الجودة من اسم المضيف. */
export function hlsVariants(text, stream, edgeOrigin = null) {
  const lines = String(text).split(/\r?\n/),
    out = [];
  // A standalone video URI cannot carry another rendition group. Keep the master.
  const externalGroups = new Set(lines.filter(l => /^#EXT-X-MEDIA:/i.test(l) && /\bURI="[^"\r\n]+"/.test(l) && /\bTYPE=(?:AUDIO|SUBTITLES)\b/i.test(l)).map(l => /\bGROUP-ID="([^"\r\n]+)"/.exec(l)?.[1]).filter(Boolean));
  for (let i = 0; i < lines.length; i++) {
    const m = /^#EXT-X-STREAM-INF:.*\bRESOLUTION=\d+x(\d+)/i.exec(lines[i]);
    if (!m || [...lines[i].matchAll(/\b(?:AUDIO|SUBTITLES)="([^"\r\n]+)"/g)].some(x => externalGroups.has(x[1]))) continue;
    const raw = lines.slice(i + 1).find((x) => x.trim() && !x.startsWith("#"));
    if (!raw) continue;
    try {
      let u = new URL(raw.trim(), stream.url);
      if (
        edgeOrigin &&
        u.origin === edgeOrigin &&
        u.pathname === "/v1/media" &&
        u.searchParams.has("u")
      )
        u = new URL(u.searchParams.get("u"));
      if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
        continue;
      const quality = Number(m[1]);
      if (quality < 144 || quality > 4320) continue;
      out.push({
        ...stream,
        url: u.href,
        quality,
        qualitySource: "hls-master",
        type: "hls",
      });
    } catch {
      /* لا مرشح من URI غير صالح */
    }
  }
  return [...new Map(out.map((x) => [x.url, x])).values()];
}
export async function discoverHlsVariants(stream, fetcher, { signal } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 8000);
  try {
    const grant = stream.addonKey ? null : await fetcher.ensureGrant(),
      edge = stream.addonKey
        ? stream.url
        : fetcher.mediaUrl(stream.url, stream.referer, grant);
    const response = await fetch(edge, {
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const reader = response.body?.getReader();
    if (!reader) return [];
    let size = 0,
      chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 256 * 1024) return [];
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const data = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      data.set(chunk, at);
      at += chunk.length;
    }
    return hlsVariants(
      new TextDecoder().decode(data),
      stream,
      new URL(edge).origin,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
