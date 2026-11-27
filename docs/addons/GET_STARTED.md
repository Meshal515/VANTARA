# Create your first VANTARA add-on

This starter makes addon authoring easier. **It does not ship playable media, scrape sites, bypass verification, or execute CloudStream/Mihon APK extensions.** It uses the currently documented VANTARA remote v1 contract for manga and the standard Stremio HTTP manifest protocol for video, stream (including torrent metadata handlers), and subtitles.

## 1. Generate an addon

Run from the VANTARA repository with Node 22+:

```sh
node tools/create-vantara-addon.mjs --kind video --name "My Video Source" --dir ./my-video-source
node tools/create-vantara-addon.mjs --kind manga --name "My Manga Source" --dir ./my-manga-source
node tools/create-vantara-addon.mjs --kind subtitles --name "My Subs" --dir ./my-subs
node tools/create-vantara-addon.mjs --kind torrent --name "My Stream Provider" --dir ./my-stream-provider
```

All output is editable source. Supply `--origin https://addons.example.org` (change to your **own** HTTPS origin) for manga, whose Remote v1 manifest binds requests to that host. The local server is only a preview; the production app disallows local HTTP manifests.

The generator creates:
- `manifest.json` — valid protocol capabilities.
- `index.mjs` — sample HTTP service with appropriately shaped JSON resources.
- `addon.test.mjs` — smoke tests of the actual server.
- `package.json` — zero external runtime dependencies.
- `README.md` — steps to replace placeholders.

## 2. Test immediately

```sh
cd my-video-source
npm test
npm run dev
```

Try the local preview at `http://127.0.0.1:8787/manifest.json`.

**The sample has zero playable links.** A 200 response, a passed smoke test or an installable manifest does not establish video/reader functionality.

## 3. Make a working addon

1. Connect source data that you are authorized to access.
2. Implement the relevant endpoints rather than copying unrelated capabilities:
   - Video: `/catalog/{type}/{id}.json` → `/meta/{type}/{id}.json` → `/stream/{type}/{videoId}.json`, optionally subtitles.
   - Manga: `/home`, `/search`, `/details/{workId}`, `/chapters/{workId}`, `/pages/{chapterId}`.
   - Subtitle-only: return real available tracks, never claim audio or hardcoded text as a separate subtitle.
   - Stream/torrent-only: return real valid stream descriptors; a magnet URI alone is not proof it plays on all devices.
3. Add correct source icons, content types, qualities, languages, and permissions.
4. Serve the manifest and resources behind HTTPS, with appropriate CORS and redirect/security policies.
5. On real VANTARA clients, test source catalog/search, details, episodes/chapters, first video frame/pages, seek/navigation, and persistence.

## 4. Existing third-party add-ons

- A **Stremio** `manifest.json` is read as a standard remote HTTP manifest, with platform-specific playback limits.
- A **Mihon** `index.min.json` points to Android APK extensions; adding the repo is **not** equivalent to being able to run APK extensions in Windows/PWA.
- **CloudStream** `repo.json` typically lists `pluginLists`, which enumerate binary `.cs3` packages. Current VANTARA does not run those packages. Never label them Working based on the repo index alone.
- VANTARA Remote v1 manga is not yet fully enabled through APK native bridges; this CLI does not change that.

## 5. Safety, upgrade and licensing

Keep API keys outside public manifests; bound requests to explicit hosts; use consented verification rather than bypassing CAPTCHA; never read another addon's cookies or VANTARA auth state. Ensure source identifiers remain stable across updates to protect watch/read progress.

The new CLI/template is original VANTARA code. No CloudStream engine code has been copied. Third-party libraries/addons retain their own license obligations.

For the architecture and release gates see [PLATFORM_V2_RFC.md](./PLATFORM_V2_RFC.md); for the existing runtime contract see [CONTRACTS.md](./CONTRACTS.md).
