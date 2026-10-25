# Chapter availability repair

Base: main e885abce, published stable-210. Preserve all later player, torrent and addon changes.

1. Reproduce Team-X feed 251 vs readable218 and34 vs31 against public source markup. Search other Arabic providers for actual readable219–251, without treating catalog numbers as image proof.
2. Add regressions: purchase-modal chapter is not a readable release; previously ingested blocked-only source is removed without removing another provider or changing release times.
3. Align server filtering with reader link/lock checks. Correct old false feed sources only after an explicit current locked marker; no correction from network errors or absent pages.
4. Keep the source of a clicked update alongside saved editions; refresh Arabic discovery when its requested chapter is missing, preserving identity checks and existing progress.
5. Test exact requested chapter navigation without English substitution, run relevant integration and repository checks, push the isolated branch, then merge/publish through existing gates if green.

Unknown: Arabic219–251 may require source access; no availability claim until a public/authorized reader returns real pages. Evidence and unsuccessful checks remain in the final report.
