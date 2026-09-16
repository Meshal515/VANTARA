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

| # | المستودع | الربط | التثبيت |
|---|---|---|---|
| 14 | [ArbenApura/xianscan-rust](https://github.com/ArbenApura/xianscan-rust) | `SERVICE` — كشف + OCR + inpaint. **لا نطلب منه رسم العربية** | يحتاج تحقق (‎`v0.5.0-beta.*`) |
| 15 | [zyddnys/manga-image-translator](https://github.com/zyddnys/manga-image-translator) | `SERVICE` بديل — يُختبر Benchmark مقابل 14 | يحتاج تحقق |
| 16 | [meangrinch/MangaTranslator](https://github.com/meangrinch/MangaTranslator) | `REFERENCE` — مرشح ثالث في الـBenchmark | يحتاج تحقق |
| 17 | [ogkalu2/comic-translate](https://github.com/ogkalu2/comic-translate) | `REFERENCE` — معالجة الصفحة والتحرير | يحتاج تحقق |
| 18 | [dmMaze/BallonsTranslator](https://github.com/dmMaze/BallonsTranslator) | `REFERENCE` — شاشة `NEEDS_REVIEW` اليدوية | يحتاج تحقق |
| 19 | [CoSciBlog/BallonsTranslator-vibe](https://github.com/CoSciBlog/BallonsTranslator-vibe) | `REFERENCE` — ثبات المصطلحات | يحتاج تحقق |
| 20 | [uncial-exchangetransfusion381/kotoba-manga-translator](https://github.com/uncial-exchangetransfusion381/kotoba-manga-translator) | `REFERENCE` — ذاكرة الشخصيات. ⚠️ **المالك في المخطط القديم (`andrey231`) خطأ**، واسم المالك الحقيقي عشوائي الشكل: يُقرأ ولا يُشغَّل كوده | يحتاج تحقق |
| 21 | [joyeli/Yakuyomi](https://github.com/joyeli/Yakuyomi) | `REFERENCE` — دمج القارئ بالترجمة. Kotlin/Android، صفر كود قابل للنقل | يحتاج تحقق |
| 22 | [PineappleTwilight/houri-engine](https://github.com/PineappleTwilight/houri-engine) | `REFERENCE` — محرك Yakuyomi الفعلي. ⚠️ المخطط القديم سماه `joyeli/yakuyomi-engine` | يحتاج تحقق |

---

## 4. الكشف والـOCR

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
