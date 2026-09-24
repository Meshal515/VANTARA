"""تجميع ما رأته النماذج إلى «مناطق» بمعرّفات ثابتة، مع بوابات الأمان.

منطقة = صندوق نص من RT-DETR + (اختياريًا) فقاعة تحتويه + قناع حروفها المقصوص
داخل الصندوق + ما قرأه OCR. المعرّف ثابت: يُشتق من بصمة الصفحة وموضع الصندوق
بالنِّسب، فنفس الصفحة تعطي نفس المعرّفات في كل تشغيل، وLuna ترد بالمعرّف لا
بالإحداثيات — النموذج اللغوي لا يلمس الهندسة.

بوابات الأمان (القاعدة الصلبة: الشك = اترك المنطقة كما هي):
  * صندوق نص بلا حروف في قناع الحروف → لا منطقة.
  * منطقة بلا نص مقروء (OCR فارغ أو ثقة دنيا) → تبقى بلا ترجمة ولا تبييض.
  * «فقاعة» بلا نص داخلها (فراغات المؤثر الكوري) → تُهمل.
  * ثقة الكشف دون العتبة → تبقى.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

import cv2
import numpy as np

from .ocr import OcrResult
from .vision.bubbles import Bubble
from .vision.common import Box, contains_ratio, iou
from .vision.detect import Detection

Kind = str  # speech | thought | narration | free | sfx


@dataclass
class Region:
    id: str
    box: Box  # صندوق النص
    score: float
    kind: Kind
    bubble: Bubble | None
    bubble_box: Box | None
    glyph: np.ndarray  # HxW uint8 قناع الحروف المقصوص داخل الصندوق (بحجم الصورة)
    glyph_pixels: int
    ink_light: bool  # حروف فاتحة على داكن؟
    ocr: OcrResult | None = None
    source: str = ""  # النص الأصلي المعتمد (OCR ثم تصحيح Luna)
    arabic: str | None = None
    speaker: str | None = None
    status: str = "pending"  # pending | translated | skipped:<reason>
    notes: list[str] = field(default_factory=list)
    layout: dict | None = None  # ما رُسم فعلًا: حدود النص العربي وحجمه
    erase_mask: np.ndarray | None = None
    clean_mode: str | None = None  # fill | inpaint | none

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "box": list(self.box),
            "score": round(self.score, 3),
            "kind": self.kind,
            "bubbleBox": list(self.bubble_box) if self.bubble_box else None,
            "glyphPixels": self.glyph_pixels,
            "inkLight": self.ink_light,
            "ocr": {"text": self.ocr.text, "confidence": round(self.ocr.confidence, 3)} if self.ocr else None,
            "source": self.source,
            "arabic": self.arabic,
            "speaker": self.speaker,
            "status": self.status,
            "cleanMode": self.clean_mode,
            "layout": self.layout,
            "notes": self.notes,
        }


def stable_id(page_hash: str, box: Box, width: int, height: int) -> str:
    """معرّف من موضع الصندوق بالنسب (دقة 0.5%) — ثابت عبر التشغيلات وتغيّر الدقة."""
    x1, y1, x2, y2 = box
    key = f"{page_hash}:{round(200 * x1 / width)}:{round(200 * y1 / height)}:{round(200 * x2 / width)}:{round(200 * y2 / height)}"
    return "r" + hashlib.sha1(key.encode()).hexdigest()[:8]


def merge_text_boxes(dets: list[Detection], iou_thr: float = 0.4, contain_thr: float = 0.75) -> list[Detection]:
    """صناديق النص المتكررة أو المتداخلة (النموذج يعطي `text_bubble` و`text_free`
    لنفس النص أحيانًا) تُدمج في صندوق واحد يحيط بهما."""
    texts = sorted([d for d in dets if d.label.startswith("text")], key=lambda d: -d.score)
    merged: list[Detection] = []
    for d in texts:
        hit = None
        for i, m in enumerate(merged):
            if iou(m.box, d.box) > iou_thr or contains_ratio(m.box, d.box) > contain_thr or contains_ratio(d.box, m.box) > contain_thr:
                hit = i
                break
        if hit is None:
            merged.append(d)
            continue
        m = merged[hit]
        box = (min(m.box[0], d.box[0]), min(m.box[1], d.box[1]), max(m.box[2], d.box[2]), max(m.box[3], d.box[3]))
        label = m.label if m.score >= d.score else d.label
        merged[hit] = Detection(box, max(m.score, d.score), label)
    return merged


def refine_glyph(rgb: np.ndarray, glyph: np.ndarray, box: Box) -> np.ndarray:
    """قناع UNet خشن (1024 بكسل ثم تكبير) ويدمج الأسطر المتقاربة؛ يُقطع ببكسلات الحبر
    الفعلية: عتبة Otsu على السطوع داخل الصندوق بقطبية الحبر (فاتح أم داكن) —
    الطريقة نفسها في manga-image-translator (`refine_mask`)."""
    H, W = glyph.shape[:2]
    x1, y1, x2, y2 = box
    pad = 6
    x1, y1, x2, y2 = max(0, x1 - pad), max(0, y1 - pad), min(W, x2 + pad), min(H, y2 + pad)
    sub = glyph[y1:y2, x1:x2] > 0
    if not sub.any():
        return glyph
    gray = cv2.cvtColor(rgb[y1:y2, x1:x2], cv2.COLOR_RGB2GRAY)
    light = float(np.median(gray[sub])) > float(np.median(gray[~sub])) if (~sub).any() else True
    _, ink = cv2.threshold(gray, 0, 255, (cv2.THRESH_BINARY if light else cv2.THRESH_BINARY_INV) + cv2.THRESH_OTSU)
    refined = np.zeros_like(glyph)
    core = cv2.dilate(glyph[y1:y2, x1:x2], np.ones((3, 3), np.uint8))
    refined[y1:y2, x1:x2] = ink & core
    # حبرٌ معزول كبير (خط رسم مرّ بالصندوق) ليس حرفًا: نبقي المكوّنات التي يغطيها القناع الأصلي
    n, labels, stats, _ = cv2.connectedComponentsWithStats(refined[y1:y2, x1:x2], 8)
    keep = np.zeros_like(refined[y1:y2, x1:x2])
    orig = glyph[y1:y2, x1:x2] > 0
    for i in range(1, n):
        comp = labels == i
        if stats[i, cv2.CC_STAT_AREA] < 3:
            continue
        if (orig & comp).sum() / comp.sum() >= 0.5:
            keep[comp] = 255
    refined[y1:y2, x1:x2] = keep
    if np.count_nonzero(refined) < 0.25 * np.count_nonzero(glyph):
        return glyph  # التنقية أكلت الحروف (تباين ضعيف): القناع الأصلي أأمن
    return refined


def ink_is_light(rgb: np.ndarray, glyph: np.ndarray, box: Box) -> bool:
    x1, y1, x2, y2 = box
    sub = glyph[y1:y2, x1:x2] > 0
    if not sub.any():
        return False
    gray = cv2.cvtColor(rgb[y1:y2, x1:x2], cv2.COLOR_RGB2GRAY)
    return float(np.median(gray[sub])) > 140


def flat_box_mask(rgb: np.ndarray, bubble_box: Box, text_box: Box, tol: int = 18) -> np.ndarray | None:
    """قناع صندوق سرد مستطيل فاته YOLO-seg: المكوّن المتصل بلون الحافة الداخلية
    للصندوق حول النص. يرجع None إن لم يكن الصندوق مسطّح اللون (نص فوق رسم)."""
    H, W = rgb.shape[:2]
    bx1, by1, bx2, by2 = bubble_box
    tx1, ty1, tx2, ty2 = text_box
    if bx2 - bx1 < 8 or by2 - by1 < 8:
        return None
    crop = rgb[by1:by2, bx1:bx2].astype(np.int16)
    # حلقة داخلية قرب حافة صندوق الفقاعة، خارج صندوق النص
    ring = np.zeros(crop.shape[:2], bool)
    m = max(2, min(6, (by2 - by1) // 12))
    ring[:m, :] = ring[-m:, :] = True
    ring[:, :m] = ring[:, -m:] = True
    ring[max(0, ty1 - by1 - 2) : ty2 - by1 + 2, max(0, tx1 - bx1 - 2) : tx2 - bx1 + 2] = False
    px = crop[ring]
    if len(px) < 20:
        return None
    color = np.median(px, axis=0)
    if np.abs(px - color).mean() > 10:
        return None  # الحافة ليست بلون واحد: ليست فقاعة مسطّحة
    close = (np.abs(crop - color).max(axis=2) <= tol).astype(np.uint8) * 255
    close = cv2.morphologyEx(close, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, labels, _stats, _ = cv2.connectedComponentsWithStats(close, 4)
    if n <= 1:
        return None
    # المكوّن الذي يلامس معظم الحلقة الداخلية
    ring_labels = labels[ring]
    ring_labels = ring_labels[ring_labels > 0]
    if len(ring_labels) == 0:
        return None
    lab = int(np.bincount(ring_labels).argmax())
    if (ring_labels == lab).mean() < 0.8:
        return None
    mask = np.zeros((H, W), np.uint8)
    comp = (labels == lab).astype(np.uint8) * 255
    # الثقوب (الحروف) تُملأ: القناع هو داخل الصندوق كاملًا
    contours, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    biggest = max(contours, key=cv2.contourArea)
    full = np.zeros(comp.shape, np.uint8)
    cv2.drawContours(full, [biggest], -1, 255, -1)
    mask[by1:by2, bx1:bx2] = full
    return mask


def assemble(
    rgb: np.ndarray,
    page_hash: str,
    dets: list[Detection],
    bubbles: list[Bubble],
    glyph_full: np.ndarray,
    *,
    min_score: float = 0.35,
    pad: int = 10,
    min_glyph_pixels: int = 40,
) -> list[Region]:
    H, W = rgb.shape[:2]
    bubble_boxes = [d for d in dets if d.label == "bubble"]
    regions: list[Region] = []
    for d in merge_text_boxes(dets):
        if d.score < min_score:
            continue
        x1, y1, x2, y2 = d.box
        px1, py1, px2, py2 = max(0, x1 - pad), max(0, y1 - pad), min(W, x2 + pad), min(H, y2 + pad)
        glyph = np.zeros((H, W), np.uint8)
        glyph[py1:py2, px1:px2] = glyph_full[py1:py2, px1:px2]
        glyph = refine_glyph(rgb, glyph, d.box)
        n_px = int(np.count_nonzero(glyph))
        if n_px < min_glyph_pixels:
            continue
        # الفقاعة الحاوية: قناع YOLO-seg يغطي الصندوق، أو صندوق RT-DETR يحتويه
        bubble = None
        best_cov = 0.0
        for b in bubbles:
            cov = float((b.mask[y1:y2, x1:x2] > 0).mean()) if y2 > y1 and x2 > x1 else 0.0
            if cov > best_cov:
                bubble, best_cov = b, cov
        if best_cov < 0.85:
            bubble = None
        bubble_box = bubble.box if bubble else None
        if bubble is None:
            holder = max((b for b in bubble_boxes if contains_ratio(b.box, d.box) > 0.9), key=lambda b: b.score, default=None)
            if holder and (holder.box[2] - holder.box[0]) * (holder.box[3] - holder.box[1]) > 1.15 * (x2 - x1) * (y2 - y1):
                bubble_box = holder.box
        light = ink_is_light(rgb, glyph, d.box)
        if bubble is not None:
            kind = "speech"
        elif bubble_box is not None:
            kind = "narration"
        elif d.label == "text_free" and d.score < 0.5:
            kind = "sfx"
        else:
            kind = "free"
        regions.append(
            Region(
                id=stable_id(page_hash, d.box, W, H),
                box=d.box,
                score=d.score,
                kind=kind,
                bubble=bubble,
                bubble_box=bubble_box,
                glyph=glyph,
                glyph_pixels=n_px,
                ink_light=light,
            )
        )
    # ترتيب القراءة: من أعلى لأسفل ثم من اليمين لليسار (الويبتون والمانجا)
    regions.sort(key=lambda r: (r.box[1] // 60, -r.box[0]))
    return regions
