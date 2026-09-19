# Capacitor Extension Engine Bridge

## Architecture Overview

The VANTARA reader consists of two separate Android components:

```
┌─────────────────────────────────────────────────────────────┐
│                    VANTARA Reader (apps/web)                 │
│                    JavaScript + Capacitor                    │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Reader UI (Library, Search, Read, etc.)                │ │
│  │                                                          │ │
│  │ ExtensionEngine.searchManga("mangalek", "ون بيس")      │ │
│  │ ExtensionEngine.getChapters("mangalek", url)           │ │
│  │ ExtensionEngine.getPages("mangalek", chapterUrl)       │ │
│  │ ExtensionEngine.getImage("mangalek", imageUrl)         │ │
│  └──────────────────────────▲──────────────────────────────┘ │
│                             │                                  │
│                      Capacitor Bridge                          │
│                             │                                  │
└─────────────────────────────┼──────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Extension Engine (spike module)                  │
│                   Kotlin Native Code                          │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ExtensionEnginePlugin.kt (Capacitor Plugin)            │ │
│  │ - testSource()                                          │ │
│  │ - searchManga()                                         │ │
│  │ - getChapters()                                         │ │
│  │ - getPages()                                            │ │
│  │ - getImage()                                            │ │
│  └──────────────────────────▲──────────────────────────────┘ │
│                             │                                  │
│                     (future integration)                       │
│                             │                                  │
│  ┌──────────────────────────▼──────────────────────────────┐ │
│  │ SourceProbe.kt                                          │ │
│  │ - run(): Full 5-step probe (search, details, chapters, │ │
│  │         pages, image)                                   │ │
│  │ - announce(): Live status display                       │ │
│  │ - diagnostic(): Error analysis                          │ │
│  │ - hypothesize(): Evidence-based classification          │ │
│  └──────────────────────────▲──────────────────────────────┘ │
│                             │                                  │
│  ┌──────────────────────────▼──────────────────────────────┐ │
│  │ FileExtensionLoader.kt + DexClassLoader                 │ │
│  │ - Download APK from GitHub                              │ │
│  │ - Verify SHA-256 signature                              │ │
│  │ - Load DEX bytecode into memory                         │ │
│  │ - Instantiate CatalogueSource                           │ │
│  └──────────────────────────▲──────────────────────────────┘ │
│                             │                                  │
│  ┌──────────────────────────▼──────────────────────────────┐ │
│  │ NetworkHelper.kt + OkHttp                               │ │
│  │ - HTTP client with Cloudflare solver                    │ │
│  │ - Automatic retry on transient errors                   │ │
│  │ - Cookie persistence                                    │ │
│  │ - Source-specific headers                               │ │
│  └──────────────────────────▲──────────────────────────────┘ │
│                             │                                  │
│  ┌──────────────────────────▼──────────────────────────────┐ │
│  │ 5 Keiyoushi Extensions (loaded dynamically)             │ │
│  │ 1. Mangalek      (ar.mangalek)      lib 1.4             │ │
│  │ 2. MangaSpark    (ar.mangaspark)    lib 1.4             │ │
│  │ 3. Azora         (ar.azora)         lib 1.6             │ │
│  │ 4. MangaSwat     (ar.mangaswat)     lib 1.6             │ │
│  │ 5. Team X        (ar.teamx)         lib 1.6             │ │
│  └──────────────────────────▲──────────────────────────────┘ │
│                             │                                  │
│                    Keiyoushi Extension API                    │
│              (RxJava 1 observables, dynamic)                  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Files

### JavaScript Side (apps/web/lib/)

**extension-engine.js**
- Main wrapper module
- Exports functions: testSource, searchManga, getChapters, getPages, getImage
- Hardcoded extension metadata with exact URLs and SHA256 hashes
- Handles Capacitor plugin registration and fallback loading

**extension-engine-web.js**
- Fallback implementation for browser/development
- Returns mock data for testing without device
- Allows frontend development to proceed independently

### Kotlin Side (android/app/src/main/java/com/vantara/plugins/)

**ExtensionEnginePlugin.kt**
- Capacitor plugin entry point
- Implements @CapacitorPlugin decorator
- Methods: testSource, searchManga, getChapters, getPages, getImage
- Currently: placeholder implementation
- Future: bridges to spike/extension-engine

## Integration Path

### Phase 1: Bridge Layer (✅ Complete)
- [x] Create Capacitor plugin wrapper
- [x] Define extension metadata (URLs, SHA256)
- [x] Create JavaScript wrapper functions
- [x] Add web fallback for development

### Phase 2: Full Integration (⏳ Next)
1. Move spike module dependencies into main Android app (build.gradle)
2. Initialize Injekt in MainActivity for extension engine
3. Implement ExtensionEnginePlugin methods to call SourceProbe
4. Handle RxJava 1 → Kotlin coroutine conversion
5. Test plugin methods with actual extensions

### Phase 3: Reader Integration (⏳ Future)
1. Add search UI integration in apps/web/src/routes/search
2. Display manga results from extension sources
3. Add source selection UI
4. Implement reading view with extension pages
5. Add to library management

## Current Status

- ✅ Bridge architecture defined
- ✅ JavaScript wrapper API created
- ✅ Kotlin plugin skeleton with all methods
- ✅ Extension metadata hardcoded (5 sources)
- ✅ Web fallback for development
- ⏳ Full spike module integration pending
- ⏳ Reader UI integration pending

## Testing the Bridge

### On Device (Android)
```kotlin
// JavaScript side
import { testSource } from '@/lib/extension-engine.js';

const result = await testSource('mangalek');
// Returns: {success, baseUrl, chapterSpan, imageFromChapter, ...}
```

### In Browser (Development)
```javascript
// Uses extension-engine-web.js fallback automatically
// Returns mock data for UI development
```

## Extension Metadata

Five sources are pre-configured with exact download URLs and SHA256 hashes:

```
✓ Mangalek      https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.mangalek-v1.4.65.apk
✓ MangaSpark    https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.mangaspark-v1.4.60.apk
✓ Azora         https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.azora-v1.6.73.apk
✓ MangaSwat     https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.mangaswat-v1.6.61.apk
✓ Team X        https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.teamx-v1.6.33.apk
```

All hashes verified against actual releases (2026-09-18).

## Security Model

1. **Extension Verification**: Each APK verified by SHA-256 before loading
2. **Isolated Loading**: Extensions loaded via DexClassLoader in private app storage
3. **Read-Only Storage**: APK files set to read-only (Android 14+ requirement)
4. **No Installation**: No system APK installation required
5. **Network Isolation**: Keiyoushi sources handle their own HTTP with OkHttp

## Next Steps

To complete the integration:

1. Add spike module as dependency in android/build.gradle
2. Ensure MainActivity initializes Injekt/SpikeModule
3. Implement ExtensionEnginePlugin methods to call SourceProbe
4. Test with `./scripts/build-android.sh` on device
5. Verify all 5 sources work (search, chapters, pages, images)
6. Add UI in apps/web for source selection and manga browsing

## References

- SourceProbe: `/home/user/VANTARA/spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/SourceProbe.kt`
- FileExtensionLoader: `/home/user/VANTARA/spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/FileExtensionLoader.kt`
- NetworkHelper: `/home/user/VANTARA/spike/extension-engine/app/src/main/kotlin/eu/kanade/tachiyomi/network/NetworkHelper.kt`
- Sources: `/home/user/VANTARA/spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/Sources.kt`
