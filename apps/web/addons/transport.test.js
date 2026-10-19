import { expect, it } from "vitest";
import { createTransport } from "./transport.js";
it("uses GET without credentials and never follows an unchecked redirect", async () => {
  let options;
  const transport = createTransport({
    fetchImpl: async (_u, o) => {
      options = o;
      return new Response('{"items":[]}', {
        headers: { "content-type": "application/json" },
      });
    },
  });
  expect(await transport.json("https://addon.test/api")).toEqual({ items: [] });
  expect(options).toMatchObject({
    method: "GET",
    credentials: "omit",
    redirect: "error",
  });
  expect(options.headers).toEqual({ accept: "application/json, application/vnd.api+json" });
});
it("blocks public URL escapes before sending a request", async () => {
  let sent = 0;
  const t = createTransport({
    fetchImpl: async () => {
      sent++;
      return new Response("{}");
    },
  });
  await expect(t.json("https://localhost/foo")).rejects.toThrow();
  expect(sent).toBe(0);
});
it("cancels oversized responses and does not echo token-bearing URLs", async () => {
  const t = createTransport({
    fetchImpl: async () => new Response("a".repeat(100)),
  });
  await expect(
    t.text("https://addon.test/secret?token=x", { limit: 10 }),
  ).rejects.toThrow("حجم");
  const failed = createTransport({
    fetchImpl: async () => {
      throw new Error("https://addon.test/secret?token=x");
    },
  });
  await expect(
    failed.json("https://addon.test/secret?token=x"),
  ).rejects.toThrow("تعذّر");
  try {
    await failed.json("https://addon.test/secret?token=x");
  } catch (e) {
    expect(e.message).not.toContain("secret");
  }
});
it("aborts the actual request on session cancellation", async () => {
  const c = new AbortController();
  let signal;
  const t = createTransport({
    fetchImpl: async (_u, o) => {
      signal = o.signal;
      await new Promise((_, reject) =>
        o.signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      );
    },
  });
  const p = t.json("https://addon.test/x", { signal: c.signal });
  c.abort();
  await expect(p).rejects.toThrow();
  expect(signal.aborted).toBe(true);
});
it("distinguishes a resolver timeout from user cancellation so health can cool dead providers", async () => {
  const { vi } = await import("vitest");
  vi.useFakeTimers();
  try {
    const t = createTransport({
      fetchImpl: (_u, { signal }) =>
        new Promise((_r, reject) =>
          signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    });
    const done = t
      .json("https://addon.test/api", { timeout: 10 })
      .catch((e) => e.name);
    await vi.advanceTimersByTimeAsync(11);
    expect(await done).toBe("TimeoutError");
  } finally {
    vi.useRealTimers();
  }
});

it("decodes legacy Arabic subtitle downloads without corrupting UTF8 or declared encodings", async () => {
  const arabic = "مرحبا بالعالم";
  const legacy = new Uint8Array([227, 209, 205, 200, 199, 32, 200, 199, 225, 218, 199, 225, 227]);
  for (const [bytes, type, expected] of [
    [legacy, "application/force-download", arabic],
    [new TextEncoder().encode(arabic), "text/plain", arabic],
    [new Uint8Array([239,187,191,...new TextEncoder().encode(arabic)]), "text/plain; charset=windows-1256", arabic],
    [new Uint8Array([233]), "text/plain; charset=windows-1252", "é"],
    [new Uint8Array([255,254,69,6,49,6,45,6,40,6,39,6]), "text/plain", "مرحبا"],
    [new Uint8Array([254,255,6,69,6,49,6,45,6,40,6,39]), "text/plain", "مرحبا"],
  ]) {
    const t = createTransport({fetchImpl: async () => new Response(bytes, {headers: {"content-type": type}})});
    expect(await t.text("https://subs.test/ar.srt", {fallbackCharset: "windows-1256"})).toBe(expected);
  }
});
