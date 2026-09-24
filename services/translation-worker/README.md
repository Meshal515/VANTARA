# عامل الترجمة المرئية

يعمل على جهاز البيت بجانب `apps/api`. يستقبل صفحةً ويرجعها مترجمةً: الفقاعات
مكتشفة، النص الأصلي ممسوح بأمان، والعربي مكتوب في مكانه. الهندسة من نماذج رؤية
مفتوحة مدرَّبة على المانجا؛ اللغة والسياق من Luna عبر sync-worker.

التصميم والقياس الكامل في [`docs/TRANSLATION_PIPELINE.md`](../../docs/TRANSLATION_PIPELINE.md).

## التثبيت

```bash
python3.11 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -c "from PIL import features; assert features.check('raqm')"   # الرسم العربي
python -m vantara_worker.cli models            # ينزّل ~430MB ويتحقق ببصمة sha256
python -m vantara_worker.cli models --japanese # + manga-ocr للياباني
```

الأوزان في `VANTARA_MODELS_DIR` (الافتراضي `~/.cache/vantara/models`).
CPU يكفي (12–17 ثانية للصفحة، أثقلها قناع الحروف)؛ مع CUDA يلتقطه onnxruntime تلقائيًا إن ثُبّت `onnxruntime-gpu`.

## التشغيل

```bash
VANTARA_SYNC_URL=https://<sync-worker> python -m vantara_worker.cli serve --port 8765
```

ثم في `apps/api`: `TRANSLATION_WORKER_URL=http://127.0.0.1:8765`.

`GET /health` · `POST /translate/page` (انظر `vantara_worker/server.py`). ترويسة
`Authorization` تُمرَّر كما هي إلى sync-worker، فالحدّ الأسبوعي والقاموس مع الحساب.

## محليًّا وللقياس

```bash
python -m vantara_worker.cli translate tests/pages/*.jpg --out out --debug --translator none
python -m vantara_worker.cli translate page.jpg --out out --debug --translator openai   # OPENAI_API_KEY
python -m vantara_worker.cli translate page.jpg --out out --translator fake --table table.json
```

`--debug` يكتب `*.debug.jpg`: الأقنعة والمضلّعات والمعرّفات والثقة وOCR وحدود العربي.

## الاختبار

```bash
pytest -q          # 11 صفحة حقيقية × 6 قواعد + الراسم + عقد الخادم
ruff check .
```

اختبارات الصفحات تحتاج الأوزان؛ بدونها تُتخطى محليًّا، وفي CI تُلزم
(`VANTARA_REQUIRE_MODELS=1`).

## البنية

| الملف | الدور |
|---|---|
| `vision/detect.py` | RT-DETR-v2: فقاعات وصناديق نص |
| `vision/glyphs.py` | comic-text-detector: قناع الحروف (OpenCV DNN) |
| `vision/bubbles.py` | YOLOv8m-seg: مضلّع الفقاعة |
| `vision/inpaint.py` | LaMa-manga: ترميم فوق الرسم |
| `regions.py` | تجميع المناطق، معرّفات ثابتة، تنقية القناع، بوابات الأمان |
| `ocr.py` | PP-OCRv5 (لاتيني) / manga-ocr (ياباني) |
| `translate_client.py` | Luna عبر sync-worker، أو OpenAI مباشرة، أو ثابت/صامت للاختبار |
| `clean.py` | خطة المسح: ملء مسطّح أو LaMa |
| `layout.py` | التفاف مقيَّد بمضلّع الفقاعة، تمركز، رسم RAQM |
| `arabic.py` | الطبقة المُثبتة سابقًا: تقسيم النصوص، القياس، RAQM |
| `pipeline.py` | التسلسل + التحقق + العرض التشخيصي |
| `server.py` / `cli.py` | HTTP وسطر الأوامر |
| `models.py` | سجلّ الأوزان والرخص والبصمات |
