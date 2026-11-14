# Arabic repository index regression

The owner-supplied `Abodabodd/re-3arabi` index contains43 entries on2026-10-29.
`Aia2tv 2` is a valid internalName and its artifact URL contains a literal path
space. The app treated this metadata name as an ASCII package/path identifier,
then rejected spaces before HttpUrl could encode them. The first rejection
aborted the entire repository index with INVALID_PACKAGE_ID.

RuntimeRepositoryEntry separates opaque metadata from the existing SHA-derived
`cs3_` storage identifier, preserving the exact name and prior package IDs. It
canonicalizes artifact URL spaces to percent encoding before the existing strict
fetch/broker path. Controls, path separators in names, insecure schemes,
credentials and fragments remain rejected. HTTPS/public-DNS/redirect/size policy
and staged package validation are unchanged.

Regression coverage:
- Captured REAL43-entry index is a JVM test resource only, never a default repo,
  installed source, user-data snapshot or shipped production manifest.
- With the original validator,3 of4 regression cases failed: complete index,
  opaque names and spaced artifact URL. The security rejection case passed.
- After the fix, all4 pass; complete app unit suite541 cases has539 passed and
  the same two pre-existing opt-in live matrices skipped, not successful.
- Actual app/instrumentation APKs compile;55 safety/fingerprint checks pass.
- The real APK WebView acceptance now calls the native bridge with the supplied
  live GitHub repo, verifies the complete index includes Witcher/Rift/Aia2tv2 and
  its encoded download URL, checks installed packages are unchanged, then checks
  repository persistence after a real process restart. It makes no source-site
  or package-install requests. This new device gate must pass before publication.

No repository deletion/re-addition, cache clearing, storage migration, account or
device-identity change is required. No torrent/player/subtitle or Stable changes.
Index visibility does not prove execution/playback compatibility for all43.
