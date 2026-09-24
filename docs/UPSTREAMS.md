# VANTARA Upstreams

> كل سطر هنا له عمود **كيف يُربط** وعمود **التثبيت**.
> `مُتحقَّق` = القيمة مأخوذة من الصورة المسحوبة أو من lockfile أو من فحص حيّ في
> هذه الجلسة. `يحتاج تحقق` = لم أستطع تثبيته من هذه البيئة (الوسيط يحجب
> GitHub API)، فيُثبَّت عند أول تركيب على جهاز مشعل ويُحدَّث هذا الملف.
>
> التعريفات الآلية في [`upstreams.lock.json`](../upstreams.lock.json).

---

## تصنيف الربط

| الرمز | المعنى |
|---|---|
| `SERVICE` | حاوية تعمل في الإنتاج |
| `LIBRARY` | يُستورد في كودنا |
| `BUNDLED` | يأتي داخل تابع آخر، لا يُثبَّت منفردًا |
| `DATA` | كتالوج أو API خارجي نستهلكه |
| `MODEL` | أوزان تُنزَّل عند التشغيل |
| `REFERENCE` | يُقرأ لفهم منطق، **صفر كود مأخوذ** |
| `DEFERRED` | قرار مؤجّل بشرط مكتوب |

---

## 1. النواة — SERVICE

| # | المستودع | الربط | التثبيت |
|---|---|---|---|
| 1 | [AngeloSha/uchiyomi](https://github.com/AngeloSha/uchiyomi) | `SERVICE` — المكتبة والمستخدمون والتقدم والقارئ | `ghcr.io/angelosha/uchiyomi@sha256:781c5cf723d9d6fca2abf1314eb76e94793a5b777fdfdfe4066235ce7cb1aadd` **مُتحقَّق** |
| 2 | [Suwayomi/Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server) | `SERVICE` — محرك الإضافات، مدمج upstream عبر `SUWAYOMI_URL` | `v2.3.2243` · `sha256:e59f212ccf91b26de8676a063a2db90256c148c6261535c7c477d47a43d9751b` **مُتحقَّق** |
| 3 | [FlareSolverr/FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) | `SERVICE` — **إلزامي**، بلا هذا تفشل الفصول على مصادر Cloudflare | `sha256:c80ae007ce2ccdcd217a12426e4f039ef763ff90738c808d38810c3e59323767` **مُتحقَّق** |
| 4 | [keiyoushi/extensions](https://github.com/keiyoushi/extensions) | `DATA` — كتالوج الإضافات المبنية | `repo/index.min.json` · **1,392 إضافة، 38 عربية — مُتحقَّق حيًّا** |
| 5 | [keiyoushi/extensions-source](https://github.com/keiyoushi/extensions-source) | `REFERENCE` — مصدر الإضافات، يُقرأ عند تشخيص parser | يحتاج تحقق |
| 6 | [cloudflare/cloudflared](https://github.com/cloudflare/cloudflared) | `SERVICE` — النفق | يحتاج تحقق |
| 7 | PostgreSQL | `SERVICE` — جداول VANTARA + pg-boss | `postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685` **مُتحقَّق** |

---

## 2. الخدمة والتشغيل — LIBRARY

| # | المستودع | الربط | التثبيت |
|---|---|---|---|
| 8 | [timgit/pg-boss](https://github.com/timgit/pg-boss) | `LIBRARY` — `apps/api/src/jobs` | `10.4.2` **مُتحقَّق (lockfile)** |
| 9 | [fastify/fastify](https://github.com/fastify/fastify) | `LIBRARY` — `apps/api` | `5.12.5` **مُتحقَّق** |
| 10 | [brianc/node-postgres](https://github.com/brianc/node-postgres) | `LIBRARY` — `packages/db` | `8.23.0` **مُتحقَّق** |
| 11 | [colinhacks/zod](https://github.com/colinhacks/zod) | `LIBRARY` — تحقق الإعداد والطلبات | `3.25.76` **مُتحقَّق** |
| 12 | [lovell/sharp](https://github.com/lovell/sharp) | `LIBRARY` — مصغّرات وأغلفة ومشتقات WebP/AVIF | `0.35.4` **مُتحقَّق (npm)** |
| 13 | [imgproxy/imgproxy](https://github.com/imgproxy/imgproxy) | `DEFERRED` — **الشرط:** لا يُشغَّل إلا إذا أثبت Sharp داخل الـAPI أنه لا يكفي | — |

---

## 3. الترجمة — الخط المعالجي

> مُقاس على 11 صفحة حقيقية (2026‑09‑24)؛ التفصيل في [`TRANSLATION_PIPELINE.md`](TRANSLATION_PIPELINE.md).
> الأوزان تُنزَّل ببصمة sha256 مثبَّتة في `services/translation-worker/vantara_worker/models.py`.

| # | المستودع | الربط | التثبيت |
|---|---|---|---|
| 14 | [ogkalu/comic-text-and-bubble-detector](https://huggingface.co/ogkalu/comic-text-and-bubble-detector) | `MODEL` — RT-DETR-v2: فقاعات + صناديق نص (Apache-2.0) | `detector-v4-s_int8.onnx` · `sha256:5fe9e4f5…ea79` **مُتحقَّق** |
| 15 | [dmMaze/comic-text-detector](https://github.com/dmMaze/comic-text-detector) | `MODEL` — قناع الحروف (UNet) + خرائط الأسطر؛ **أوزان فقط، GPL-3.0، تُشغَّل على خادم البيت؛ صفر كود منه** | `comictextdetector.pt.onnx` (إصدار manga-image-translator beta-0.3) · `sha256:1a86ace7…718f` **مُتحقَّق** |
| 16 | [kitsumed/yolov8m_seg-speech-bubble](https://huggingface.co/kitsumed/yolov8m_seg-speech-bubble) | `MODEL` — مضلّع الفقاعة بكسلًا بكسلًا؛ أوزان فقط، GPL-3.0، خادم البيت | `model_dynamic.onnx` · `sha256:36c26bde…251c` **مُتحقَّق** |
| 17 | [ogkalu/lama-manga-onnx-dynamic](https://huggingface.co/ogkalu/lama-manga-onnx-dynamic) | `MODEL` — LaMa المدرَّب على الأنمي/المانجا (anime-manga-big-lama) للترميم فوق الرسم (Apache-2.0) | `lama-manga-dynamic.onnx` · `sha256:de31ffa5…15f9` **مُتحقَّق** |
| 18 | [ogkalu/ppocr-v5-onnx](https://huggingface.co/ogkalu/ppocr-v5-onnx) | `MODEL` — PP-OCRv5 en mobile (PaddleOCR، Apache-2.0) لقراءة اللاتيني سطرًا سطرًا | `en_PP-OCRv5_rec_mobile_infer.onnx` · `sha256:c3461add…4be8` **مُتحقَّق** |
| 19 | [kha-white/manga-ocr](https://github.com/kha-white/manga-ocr) عبر [ogkalu/manga-ocr-onnx](https://huggingface.co/ogkalu/manga-ocr-onnx) | `MODEL` — الياباني (يفهم العمودي)، Apache-2.0، اختياري | `encoder/decoder_model_int8.onnx` **مُتحقَّق** |
| 20 | [google/fonts — Baloo Bhaijaan 2](https://github.com/google/fonts/tree/main/ofl/baloobhaijaan2) | `BUNDLED` — الخط العربي للرسم (OFL-1.1) | `services/translation-worker/fonts/` |
| 21 | [ogkalu2/comic-translate](https://github.com/ogkalu2/comic-translate) | `REFERENCE` — قُرئت شفرة الكشف والترميم والتنزيل لاختيار الطرق؛ **صفر كود مأخوذ** | — |
| 22 | [zyddnys/manga-image-translator](https://github.com/zyddnys/manga-image-translator) | `REFERENCE` — تنقية القناع بـOtsu، تشغيل CTD عبر OpenCV DNN؛ **صفر كود مأخوذ** | — |
| 23 | [dmMaze/BallonsTranslator](https://github.com/dmMaze/BallonsTranslator) | `REFERENCE` — مقارنة فقط | — |
| 24 | [ArbenApura/xianscan-rust](https://github.com/ArbenApura/xianscan-rust) | `DEFERRED` — كان المرشح الأول في D‑04؛ لم يُدخل لأن المكوّنات المفتوحة أعلاه قِيست وكفت | — |
| 25 | [advimman/lama](https://github.com/advimman/lama) | `BUNDLED` — يأتي داخل 17 | — |
| 25b | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) | `LIBRARY` — يشغّل النماذج على الجوال (`onnxruntime-android`، arm64، ~12MB) وفي العامل (`onnxruntime` Python) | `1.20.0` (Android) · `1.30.0` (Python) **مُتحقَّق** |

---

## 4. الكشف والـOCR

> **تنبيه (2026‑09‑24):** ما في هذا القسم كان الخطة قبل القياس. الخط الفعلي للترجمة في §3؛
> ما هنا يبقى مرجعًا لبدائل قِيست أو أُجّلت ولا يُثبَّت في العامل.

| # | المستودع | الربط | التثبيت |
|---|---|---|---|
| 23 | [dmMaze/comic-text-detector](https://github.com/dmMaze/comic-text-detector) | `MODEL` — كشف البالونات | يحتاج تحقق |
| 24 | [kha-white/manga-ocr](https://github.com/kha-white/manga-ocr) | `LIBRARY` — ياباني، يدعم النص العمودي | `manga-ocr==0.1.16` **مُتحقَّق (PyPI)** |
| 25 | [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | `LIBRARY` — كوري/صيني/إنجليزي | `paddleocr==3.7.0` **مُتحقَّق** |
| 26 | [datalab-to/surya](https://github.com/datalab-to/surya) | `LIBRARY` — احتياطي + ترتيب القراءة | `surya-ocr==0.22.1` **مُتحقَّق** |
| 27 | [zai-org/GLM-OCR](https://github.com/zai-org/GLM-OCR) | `DEFERRED` — **الشرط:** لا يدخل قبل قياس تكلفته وزمنه مقابل 25 و26 | — |

---

## 5. تنظيف النص القديم

| # | المستودع | الربط | التثبيت |
|---|---|---|---|
| 28 | [Sanster/IOPaint](https://github.com/Sanster/IOPaint) | `LIBRARY` — inpainting احتياطي | `iopaint==1.6.0` **مُتحقَّق** |
| 29 | [advimman/lama](https://github.com/advimman/lama) | `BUNDLED` — يأتي داخل XianScan وIOPaint. **لا تُشغَّل خدمة منفصلة لمجرد وجوده** | — |

---

## 6. العربية — الطبقة التي نملكها

| # | المستودع | الربط | التثبيت |
|---|---|---|---|
| 30 | [python-pillow/Pillow](https://github.com/python-pillow/Pillow) | `LIBRARY` — الرسم العربي، `Layout.RAQM` إلزاميًا | `Pillow==12.3.0` **مُتحقَّق** |
| 31 | [harfbuzz/harfbuzz](https://github.com/harfbuzz/harfbuzz) | `BUNDLED` — داخل ويل Pillow | عبر `raqm 0.10.5` **مُتحقَّق** |
| 32 | [fribidi/fribidi](https://github.com/fribidi/fribidi) | `BUNDLED` — داخل ويل Pillow | عبر `raqm 0.10.5` **مُتحقَّق** |
| 33 | [HOST-Oman/libraqm](https://github.com/HOST-Oman/libraqm) | `BUNDLED` — `PIL.features.version('raqm')` | `0.10.5` **مُتحقَّق** |
| 34 | [notofonts/arabic](https://github.com/notofonts/arabic) | `DATA` — Noto Naskh Arabic. ⚠️ لا يحمل محارف لاتينية ⇒ يلزم خط ثانٍ لـruns المختلطة | `fonts-noto-core` **مُتحقَّق** |

**لماذا 31–33 `BUNDLED` لا `SERVICE`:** المخطط القديم عدّها ثلاثة مشاريع تُبنى.
قياس هذه الجلسة: `pip install Pillow` يعطيها كلها، و`features.check('raqm') == True`.

---

## 7. الهوية والـMetadata

| # | المستودع | الربط | التثبيت |
|---|---|---|---|
| 35 | [MangaBaka](https://mangabaka.org/) | `DATA` — معرّفات موحّدة | يحتاج تحقق |
| 36 | [Snd-R/komf](https://github.com/Snd-R/komf) | `REFERENCE` — منطق المطابقة. Kotlin | يحتاج تحقق |
| 37 | [unseensnick/Reikai](https://github.com/unseensnick/Reikai) | `REFERENCE` — دمج المصادر. Kotlin/Android | يحتاج تحقق |
| 38 | [mihonapp/mihon](https://github.com/mihonapp/mihon) | `REFERENCE` — سلوك الإضافات | يحتاج تحقق |
| 39 | [Nyora-Manga/nyora-web](https://github.com/Nyora-Manga/nyora-web) | `DEFERRED` — محرك kotatsu-parsers. **الشرط:** لا يدخل إلا إذا نقص عدد المصادر `SUPPORTED` عن الحاجة | — |
| 40 | [miwayomi](https://miwayomi.github.io/miwayomi/) | `DEFERRED` — محرك احتياطي. **الشرط:** فشل Suwayomi في نوع إضافات نحتاجه | — |

**تصحيح مهم:** 36 و37 و38 و21 و22 كلها Kotlin/Android. stackنا TypeScript وPython،
فهذه **مواد قراءة**، لا قطع غيار. قراءتها تكلّف وقتًا ولا توفره.

---

## 8. التشغيل والنسخ الاحتياطي

| # | المستودع | الربط | التثبيت |
|---|---|---|---|
| 41 | [restic/restic](https://github.com/restic/restic) | `SERVICE` — نسخ مشفّر | يحتاج تحقق |
| 42 | [rclone/rclone](https://github.com/rclone/rclone) | `SERVICE` اختياري — رفع إلى R2 | يحتاج تحقق |
| 43 | [louislam/uptime-kuma](https://github.com/louislam/uptime-kuma) | `SERVICE` اختياري — مراقبة | يحتاج تحقق |
| 44 | [binwiederhier/ntfy](https://github.com/binwiederhier/ntfy) | `SERVICE` اختياري — إشعارات | يحتاج تحقق |

---

## 9. مرفوضة بشرط مكتوب — DEFERRED

| المستودع | شرط الدخول |
|---|---|
| [better-auth/better-auth](https://github.com/better-auth/better-auth) | لا يدخل: Uchiyomi يملك Auth + 2FA + OIDC. الشرط: فصل VANTARA عن Uchiyomi |
| [MasterKale/SimpleWebAuthn](https://github.com/MasterKale/SimpleWebAuthn) | Passkeys. الشرط: طلب صريح من المستخدمين |
| [meilisearch/meilisearch](https://github.com/meilisearch/meilisearch) | الشرط: إثبات أن `pg_trgm` لا يكفي بقياس |
| [typesense/typesense](https://github.com/typesense/typesense) | نفس الشرط |

---

## قاعدة الترخيص

1. اقرأ `LICENSE` قبل نسخ أي سطر.
2. سجّل في `THIRD_PARTY_NOTICES.md`.
3. ما يعمل `SERVICE` أو `REFERENCE` **لا يخلط تراخيص** — وهذا سبب إضافي لتقليل النسخ.
4. Uchiyomi **MPL-2.0 مُتحقَّق**. التزام ملف-بملف: تعديلاتنا على ملفاته تبقى MPL
   ويلزم نشر مصدرها **عند التوزيع**. نتعامل معه عبر REST ولا نعدّل ملفاته، فلا
   التزام ينشأ أصلًا.
5. استخدام خاص بين ثلاثة = لا توزيع.

---

## كيف يُحدَّث هذا الملف

```bash
# تثبيت صورة بالـdigest بدل الوسم
docker pull <image>:<tag>
docker inspect --format '{{index .RepoDigests 0}}' <image>:<tag>

# نسخة محرك الإضافات الحيّة
curl -H "Authorization: Bearer $TOK" localhost:8080/api/admin/extensions/status

# مكدّس العربية
python3 -c "from PIL import features; print(features.version('raqm'))"
```

كل `يحتاج تحقق` يُملأ عند أول تركيب على جهاز مشعل. **لا يُكتب رقم لم يُقَس.**
