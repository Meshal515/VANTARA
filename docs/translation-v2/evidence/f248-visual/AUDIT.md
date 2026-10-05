# Native translation runtime and visual audit: f2484667

Candidate `f2484667cb1d97ae4e1dff31d6bcaf81da926523`, run37325631139 attempt2, job111819101942 **success**, six native original-model tests **OK** (33.727seconds). New successful artifactID11353105002 (2,345,788bytes) SHA256`2068b48cc4bce0e8fc68d1be3fe691a396aa0521cd8272ecae93cfe5cb7a87cd` matches Actions upload digest and locally downloadedZIP.

The first attempt failed in sdkmanager downloading the systemimage (`Error on ZipFile unknown archive`) before emulator boot, not from product code. Its smaller artifact11352571531 contains only JVM reports; **do not mistake it for runtime evidence**.

## Actual PNG inspection

Both current rendered images were opened and visually inspected. Source and rendered flat720×1000, realmagician1080×2316 preserve dimensions. All four source/rendered RGB arrays are **pixel-identical** to the separately audited44b09cf baseline images. Hence there is no render regression in these samples.

Flatpage:3Arabic bubbles, shaping joined, text centered/fitting, no visible Latin leftovers, original outlines preserved. Evidence.json independently records rendered3, fill3, inpaint0, eraseNoOpRegions0.

Realpage: main bubble clean `ساحرنا يعرف الحقيقة`; artwork, balloon outline/tail and bottom original`ترجم` screenshot button unchanged. Source→output differences remain9,738pixels flat (none outside authored bubble bounding boxes) and25,755pixels real (confined to the main bubble rectangle[174,612,507,765]).

No visual blocker found in these two samples. LiveLuna, interactive reader E2E,100-page annotated-corpus quality, physicalS23Ultra throughput/thermals and chapter target budgets remain **UNVERIFIED**.33.727seconds is the duration of six emulator tests, not a chapter throughput measurement.
