# Cinema debug specification and execution plan
User explicitly authorized implementation and downloadable debug APK, prohibited publishing main. Unique Cinema visual identity; reuse Anime preparation and player infrastructure, not its visual design. Preserve Anime/Manga/Profile.

## Global constraints
Worktree feature/cinema-debug only. No main merge, stable release or backend deployment. Existing debug suffix .debug stays isolated. No signed media URLs in assets. Public metadata, fresh source resolution, exact movie/title/year/type and explicit season mapping; never guess a different episode. No torrent implementation or external links masquerading as streams.

## Tasks
1. Native Cinema adapters, namespace manifests and player identity. Tuktuk current selectors proved movie Runner 2026 and Irreplaceable S1E1; EgyDead secondary. Engine configure must merge namespaces. Expose seasons. Player receives content=cinema/mediaType/contentId/season defaults preserve Anime, separate coverage/history/usage, no MAL skips or anime presence/social for Cinema. Unit tests parsing and isolation.
2. Web metadata, bridge, local library/history and unique Cinema controller. Catalog via Cinemeta no secret. Source catalogs as playable discovery alternative, user can select exact source work. Own charcoal/copper poster/editorial mobile UI, big tonight artwork, film/series discovery, seasons/episodes, progressive server sheet, loading/error/cancel. Use one native plugin with independent configure. Separate owner storage and season identity. Metadata/cache tests.
3. Shell integration with all home/library/search/detail paths, Cinema source manifest, Anime event guards. No unrelated design changes. Baseline and new tests, browser checks.
4. Independent review, fix, debug workflow build, downloadable APK. No stable publication. Verify packaged assets/native tests. State actual network proof limits honestly.

## Interface contract
Native configure({manifest,content:'cinema'}), page({sourceId,listing,page,query}), details({anime}), seasons({anime}), episodes({anime}), search({query,content:'cinema'}), prepare/routes/best/pick/closeSession unchanged. SourceAnime adds default optional mediaType/year if needed. play passes content/mediaType/contentId/season alongside existing animeId and selected-season copies. playback/episode/server events carry default content and explicit Cinema identity.
Cinema web can use native source catalog directly, avoids unsafe fuzzy metadata mapping. Catalog tiles from native results guaranteed navigable; Cinemeta discovery may resolve strict native title/year/type with explicit no-match state.
