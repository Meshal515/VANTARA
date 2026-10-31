# تسليم محرك الإضافات — 31 أكتوبر 2026

يُحدَّث مع كل دفعة. نقطة البداية لأي وكيل يكمل العمل؛ لا تكرر ما فيه.

## الفروع والحالة

| الفرع | ما فيه |
|---|---|
| `feat/addons-v7-native-manager-20261027` (Debug، PR #298) | آخر عمل Codex (PRs 302–305: تشغيل CloudStream المعزول، Witcher، Pixeldrain، فهرس ARB) ثم دفعة Claude حتى `35da6719` (نُشرت بأمر المالك 30 أكتوبر). |
| `claude/supernatural-addons` | عمل لاحق **غير منشور**: أقسام الكتالوج، مستخرجا ok.ru وMixdrop، حل Cloudflare الصامت لـCloudStream، فحص المانجا الحي، الفحوص التشخيصية. لا يُدفع إلى Debug إلا بأمر المالك. |
| `main` / Stable | لم يُمس. |

Codex لم يدفع شيئًا بعد 29 أكتوبر؛ عمله كله داخل Debug أعلاه. بواباته المفتوحة (docs/ADDONS_ACCEPTANCE_STATUS_20261028.md): التحقق اليدوي الحي، Team X (كتالوج Debug فارغ مقابل 218 فصلًا في Stable)، MangaSwat وأغلفتها، ترقية Stable.

## أدوات الإثبات الحي (CI على محاكي API35 بشبكة GitHub)

`runtime-live-sweep.yml` (تشغيل يدوي على الفرع):
- `LiveRepositorySweepTest`: كل إضافات مستودع CloudStream العربي (43): تثبيت ← كتالوج ← تفاصيل ← حلقات ← روابط. الكتالوج الفارغ يسجّل أقسام جواب المزوّد الخام.
- `MangaLiveSweepTest`: كل مصدر مانجا مضمّن + كل إضافة عربية من Keiyoushi غير مضمّنة: تحميل ← رائج/أحدث ← فصول ← صفحات ← **تنزيل أول صورة والتحقق أنها صورة**.
- `LiveExtractorProbeTest` (JVM): كل رابط سيرفر حقيقي في `tools/repository-compat/extractor-samples.txt` وما جمعه الفحص، ويطلب أول بايتات كل رابط؛ المستخرج الذي يفشل يُسجَّل سبب فشله.
- الأدلة: Artifact `live-repository-sweep` (live-sweep.jsonl، manga-sweep.jsonl، extractor-probe.txt) وجدول في ملخص التشغيل.

ما ليس دليلًا: نجاح البناء، اختبارات المحاكاة (fixtures)، استخراج رابط دون طلب بايتاته.

## المثبت حيًا

- ok.ru: كل الجودات (144–1080 + HLS) أعادت فيديو فعليًا (تشغيل 41128928632).
- DoodStream/playmogo: فيديو فعلي.
- أقسام الكتالوج: EgyWatch من «لا كتالوج» إلى 213 عملًا وروابط؛ Eshek من 0 إلى 30 وروابط.
- رحلات CloudStream كاملة حتى روابط تشغيل: Aflaam وAsia2tv 2 وAnimeRift وAnimeWitcher وDima toon وEgyWatch وEshek وTVgarden.

## معروف ومفتوح

- Mixdrop: يعمل محليًا (الفك صحيح) ويفشل حيًا؛ الفحص صار يسجّل السبب.
- عشرة مصادر CloudStream بكتالوج فارغ «ناجح»: الفحص صار يسجّل الجواب الخام.
- ثمانية مصادر CloudStream تقف عند Cloudflare: الحل الصامت مكتوب ولم يُثبت (يحتاج نافذة أمامية؛ المحاكي في الفحص بلا نشاط ظاهر).
- MangaRose: غير موجود في Keiyoushi (59 إضافة عربية فيه)؛ يحتاج مستودعًا آخر من المالك.
- مستخرجات ناقصة كثيرة الطلب: mp4upload، voe، vk، uqload، streamwish، vidspeed، savefiles، byse*.

## مصفوفة المانجا

تُملأ من manga-sweep.jsonl بعد كل تشغيل (PASS = صورة صفحة فعلية نزلت وتحقق أنها صورة).
