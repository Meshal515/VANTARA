"""خط الترجمة الكامل لصفحة واحدة.

    صفحة → كشف (RT-DETR) → قناع الحروف (CTD) → أقنعة الفقاعات (YOLO-seg)
          → مناطق بمعرّفات ثابتة + بوابات الأمان → OCR → Luna (لغة وسياق)
          → مسح آمن (ملء مسطّح أو LaMa) → عربي داخل المضلّع (RAQM) → تحقق

كل قرار هندسي (أين الفقاعة، ما يُمسح، أين يُكتب) من نماذج الرؤية وقناع
البكسلات؛ Luna لا ترى إلا نصوصًا بمعرّفات وترد بنصوص بمعرّفات.

القاعدة الصلبة: منطقة لا نثق بها (ثقة كشف منخفضة، حروف قليلة، OCR فارغ،
Luna لم تردّ عليها أو قالت `sfx`، أو العربي لم يدخل بحجم مقروء) تبقى كما هي
في الصورة — لا تبييض بلا عربي، ولا عربي بلا تبييض.
"""

from __future__ import annotations

import hashlib
import io
import time
from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image, ImageDraw

from . import clean
from . import layout as lay
from .ocr import LatinOcr, MangaOcr
from .regions import Region, assemble
from .translate_client import NullTranslator, PageMeta, RegionInput, Translator
from .vision.bubbles import BubbleSegmenter
from .vision.detect import TextBubbleDetector
from .vision.glyphs import GlyphSegmenter, glyph_mask
from .vision.inpaint import Inpainter

MIN_OCR_CONF = 0.55
MIN_DET_SCORE = 0.35
MAX_INPUT_EDGE = 4096


@dataclass
class PageResult:
    width: int
    height: int
    page_hash: str
    regions: list[Region]
    image: np.ndarray  # RGB النهائية
    engine: str
    cached: bool
    error: str | None
    timings: dict[str, float] = field(default_factory=dict)
    summary: str | None = None

    @property
    def translated(self) -> int:
        return sum(1 for r in self.regions if r.status == "translated")

    def to_json(self) -> dict:
        return {
            "width": self.width,
            "height": self.height,
            "pageHash": self.page_hash,
            "engine": self.engine,
            "cached": self.cached,
            "error": self.error,
            "summary": self.summary,
            "translated": self.translated,
            "regions": [r.to_json() for r in self.regions],
            "timings": {k: round(v, 3) for k, v in self.timings.items()},
        }


class Pipeline:
    """يحمّل النماذج مرة ويعالج الصفحات."""

    def __init__(self, *, japanese: bool = False) -> None:
        t = time.time()
        self.detector = TextBubbleDetector(conf=0.3)
        self.glyphs = GlyphSegmenter()
        self.bubbles = BubbleSegmenter()
        self.inpainter = Inpainter()
        self.latin = LatinOcr()
        self.manga_ocr: MangaOcr | None = MangaOcr() if japanese else None
        self.load_seconds = time.time() - t

    @staticmethod
    def decode(data: bytes) -> tuple[np.ndarray, str]:
        arr = np.frombuffer(data, np.uint8)
        bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if bgr is None:
            raise ValueError("not an image")
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        H, W = rgb.shape[:2]
        if max(H, W) > MAX_INPUT_EDGE:
            s = MAX_INPUT_EDGE / max(H, W)
            rgb = cv2.resize(rgb, (int(W * s), int(H * s)), interpolation=cv2.INTER_AREA)
        return rgb, hashlib.sha256(data).hexdigest()

    def analyze(self, rgb: np.ndarray, page_hash: str, source_lang: str = "auto") -> tuple[list[Region], dict[str, float]]:
        """الهندسة وOCR فقط (بلا ترجمة ولا رسم)."""
        timings: dict[str, float] = {}
        t = time.time()
        dets = self.detector(rgb)
        timings["detect"] = time.time() - t
        # كل منطقة تبدأ من صندوق نص بثقة ≥ MIN_DET_SCORE: بلا صندوق كهذا لا منطقة
        # مهما قالت بقية النماذج. فصفحة بلا نص تتخطاها، والنتيجة نفسها تمامًا.
        if not any(d.label.startswith("text") and d.score >= MIN_DET_SCORE for d in dets):
            return [], timings
        t = time.time()
        maps = self.glyphs(rgb)
        glyph_full = glyph_mask(maps)
        timings["glyphs"] = time.time() - t
        t = time.time()
        bubbles = self.bubbles(rgb)
        timings["bubbles"] = time.time() - t
        t = time.time()
        regions = assemble(rgb, page_hash, dets, bubbles, glyph_full, min_score=MIN_DET_SCORE)
        timings["assemble"] = time.time() - t
        t = time.time()
        for r in regions:
            if r.kind == "sfx":
                r.status = "skipped:sfx"
                continue
            use_manga = self.manga_ocr is not None and source_lang == "ja"
            r.ocr = (self.manga_ocr.read(rgb, r.glyph, r.box) if use_manga else self.latin.read(rgb, r.glyph, r.box))  # type: ignore[union-attr]
            r.source = r.ocr.text
            if not r.ocr.text or r.ocr.confidence < MIN_OCR_CONF:
                # لا نص مقروء: مؤثر صوتي مرسوم أو زخرفة؛ تبقى كما هي
                r.status = "skipped:unreadable"
        timings["ocr"] = time.time() - t
        return regions, timings

    def run(self, data: bytes, meta: PageMeta | None = None, translator: Translator | None = None) -> PageResult:
        rgb, page_hash = self.decode(data)
        H, W = rgb.shape[:2]
        meta = meta or PageMeta(page_hash=page_hash, series_ref="local")
        if not meta.page_hash:
            meta.page_hash = page_hash
        translator = translator or NullTranslator()
        regions, timings = self.analyze(rgb, page_hash, meta.source_lang)

        # ٢. Luna: النصوص بمعرّفاتها + الصفحة للسياق
        t = time.time()
        pending = [r for r in regions if r.status == "pending"]
        reply = translator.translate(
            _jpeg(rgb, 1400),
            meta,
            [RegionInput(r.id, r.source, r.kind, r.box, r.ocr.confidence if r.ocr else 0.0) for r in pending],
            width=W,
            height=H,
        )
        timings["translate"] = time.time() - t
        for r in pending:
            rr = reply.regions.get(r.id)
            if rr is None:
                r.status = "skipped:untranslated" if reply.error is None else f"skipped:{reply.error}"
                continue
            if rr.source:
                r.source = rr.source
            r.speaker = rr.speaker
            if rr.kind in ("sfx", "credit") or rr.arabic is None:
                r.status = f"skipped:{rr.kind}"
                continue
            r.arabic = rr.arabic
            if rr.kind in ("speech", "thought", "narration", "sign") and r.kind not in ("speech", "narration"):
                r.kind = rr.kind
            r.status = "translated"

        # ٣. تخطيط العربي أولًا: ما لا يدخل بحجم مقروء لا يُمسح أصله
        t = time.time()
        layouts: dict[str, lay.Layout] = {}
        siblings = _siblings(regions)
        for r in regions:
            if r.status != "translated":
                continue
            inner = lay.inner_mask_for(r, rgb, siblings.get(r.id))
            l = lay.layout_region(r, r.arabic or "", inner, (W, H))
            if l is None:
                r.status = "skipped:no_fit"
                r.notes.append("arabic does not fit at a readable size")
                continue
            layouts[r.id] = l
            line_h, ascent = lay.line_metrics(l.size)
            r.layout = {
                "size": l.size,
                "lines": l.lines,
                "bounds": list(l.bounds),
                # حدود كل سطر فعليًّا (لا مستطيل الكتلة): ما يُختبر ضد مضلّع الفقاعة
                "lineBounds": [
                    [int(cx - lay.text_width(line, l.size) / 2), int(base - ascent), int(cx + lay.text_width(line, l.size) / 2), int(base - ascent + line_h)]
                    for line, (cx, base) in zip(l.lines, l.positions, strict=True)
                ],
            }
        timings["layout"] = time.time() - t

        # ٤. المسح الآمن
        t = time.time()
        for r in regions:
            if r.status == "translated":
                clean.plan_erase(rgb, r, siblings.get(r.id))
        cleaned = clean.apply_erase(rgb, regions, self.inpainter)
        timings["clean"] = time.time() - t

        # ٥. الرسم
        t = time.time()
        image = Image.fromarray(cleaned)
        for r in regions:
            if r.status != "translated" or r.id not in layouts:
                continue
            lay.draw_layout(image, layouts[r.id], ink_light=r.ink_light, on_art=(r.bubble is None and r.bubble_box is None))
        timings["render"] = time.time() - t
        final = np.asarray(image)

        # ٦. التحقق: لا بكسل تغيّر خارج (قناع المسح ∪ حدود العربي)
        allowed = np.zeros((H, W), bool)
        for r in regions:
            if r.status != "translated":
                continue
            if r.erase_mask is not None:
                allowed |= r.erase_mask > 0
            if r.id in layouts:
                x1, y1, x2, y2 = layouts[r.id].bounds
                pad = layouts[r.id].size // 2
                allowed[max(0, y1 - pad) : min(H, y2 + pad), max(0, x1 - pad) : min(W, x2 + pad)] = True
        changed = np.any(final != rgb, axis=2)
        leaked = int(np.count_nonzero(changed & ~allowed))
        if leaked:
            # لا يجب أن يحدث؛ إن حدث نعيد الأصل في تلك البكسلات ونسجّل
            final = final.copy()
            final[changed & ~allowed] = rgb[changed & ~allowed]
            timings["leaked_pixels"] = float(leaked)

        return PageResult(W, H, page_hash, regions, final, reply.engine, reply.cached, reply.error, timings, reply.summary)

    # ────────────────────────── العرض التشخيصي ──────────────────────────

    def debug_image(self, rgb: np.ndarray, result: PageResult) -> np.ndarray:
        """طبقات: قناع الحروف (أحمر)، قناع الفقاعة (أخضر)، قناع المسح (أزرق)،
        المضلّع الآمن (أصفر)، المعرّف والثقة وOCR والحالة، وحدود العربي (سماوي)."""
        vis = rgb.copy()
        _H, _W = vis.shape[:2]
        for r in result.regions:
            if r.bubble is not None:
                g = vis.copy()
                g[r.bubble.mask > 0] = (0, 200, 0)
                vis = cv2.addWeighted(vis, 0.8, g, 0.2, 0)
                cv2.polylines(vis, [r.bubble.polygon.reshape(-1, 1, 2)], True, (0, 160, 0), 2)
            if r.erase_mask is not None:
                b = vis.copy()
                b[r.erase_mask > 0] = (40, 80, 255)
                vis = cv2.addWeighted(vis, 0.6, b, 0.4, 0)
            red = vis.copy()
            red[r.glyph > 0] = (255, 0, 0)
            vis = cv2.addWeighted(vis, 0.5, red, 0.5, 0)
            x1, y1, x2, y2 = r.box
            color = (0, 120, 255) if r.status == "translated" else (255, 140, 0) if r.status.startswith("skipped") else (128, 128, 128)
            cv2.rectangle(vis, (x1, y1), (x2, y2), color, 2)
            if r.bubble_box and r.bubble is None:
                bx1, by1, bx2, by2 = r.bubble_box
                cv2.rectangle(vis, (bx1, by1), (bx2, by2), (200, 200, 0), 2)
            if r.layout:
                lx1, ly1, lx2, ly2 = r.layout["bounds"]
                cv2.rectangle(vis, (lx1, ly1), (lx2, ly2), (0, 220, 220), 2)
        pil = Image.fromarray(vis)
        draw = ImageDraw.Draw(pil)
        f = lay.font(18)
        for r in result.regions:
            x1, y1, _, _ = r.box
            label = f"{r.id} {r.kind} det={r.score:.2f}"
            if r.ocr:
                label += f" ocr={r.ocr.confidence:.2f}"
            label += f" [{r.status}] {r.clean_mode or ''}"
            lines = [label, f"src: {r.source[:60]}"]
            if r.arabic:
                lines.append(f"ar: {r.arabic[:60]}")
            y = max(2, y1 - 22 * len(lines))
            for line in lines:
                draw.rectangle((x1, y, x1 + 8 * len(line) + 6, y + 21), fill=(0, 0, 0))
                draw.text((x1 + 3, y + 2), line, font=f, fill=(255, 255, 0))
                y += 22
        return np.asarray(pil)


def _siblings(regions: list[Region]) -> dict[str, list[Region]]:
    """المناطق التي تتشارك الفقاعة نفسها (قناع YOLO-seg أو صندوق RT-DETR نفسه)."""
    out: dict[str, list[Region]] = {}
    for a in regions:
        for b in regions:
            if a is b:
                continue
            same = (a.bubble is not None and a.bubble is b.bubble) or (a.bubble is None and a.bubble_box is not None and a.bubble_box == b.bubble_box)
            if same:
                out.setdefault(a.id, []).append(b)
    return out


def _jpeg(rgb: np.ndarray, max_width: int, quality: int = 86) -> bytes:
    H, W = rgb.shape[:2]
    if max_width < W:
        rgb = cv2.resize(rgb, (max_width, int(H * max_width / W)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("jpeg encode failed")
    return bytes(buf)


def encode_webp(rgb: np.ndarray, quality: int = 90) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, format="WEBP", quality=quality, method=4)
    return buf.getvalue()
