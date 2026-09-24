"""التبييض الآمن: يُمسح ما هو حروف (وهالتها) فقط، وحدود الفقاعة والرسم كما هما.

ثلاث حالات مقيسة على الصفحات الحقيقية:

1. **فقاعة مسطّحة** (قناع فقاعة + داخلها لونٌ واحد حول النص): تُملأ بكسلات
   الحروف بلون الفقاعة الدقيق — كما تفعل فرق الترجمة. القناع = الحروف موسَّعة
   بسخاء **مقطوعةً بداخل الفقاعة المتآكل** فلا تصل الحافة، زائد كل بكسل قرب
   النص يخالف لون الفقاعة (التوهج والظل خلف الحروف، صفحة «THE WARRIORS»).
2. **فقاعة فيها رسم** أو **نص فوق الرسم** (مطر، دخان، شعاع): LaMa على قناع
   الحروف موسَّعًا بما يكفي لحدّ الحرف السميك وهالته؛ الحجم يتبع ارتفاع الحرف.
3. **مؤثر صوتي** أو منطقة بلا نص مقروء: لا يُلمس.

لا يخرج أي بكسل خارج `erase_mask` مختلفًا عن الأصل — وهذا مُختبَر.
"""

from __future__ import annotations

import cv2
import numpy as np

from .regions import Region
from .vision.inpaint import Inpainter


def _glyph_height(glyph: np.ndarray, box: Box) -> int:  # type: ignore[name-defined]  # noqa: F821
    x1, y1, x2, y2 = box
    sub = glyph[y1:y2, x1:x2] > 0
    if not sub.any():
        return 12
    rows = sub.sum(axis=1) > 0
    runs: list[int] = []
    n = 0
    for v in rows:
        if v:
            n += 1
        elif n:
            runs.append(n)
            n = 0
    if n:
        runs.append(n)
    return int(np.median(runs)) if runs else 12


def _flat_color(rgb: np.ndarray, inner: np.ndarray, near_text: np.ndarray) -> tuple[np.ndarray | None, float]:
    """لون الفقاعة حول النص ومدى تجانسه (متوسط البعد عن الوسيط)."""
    ring = inner.copy()
    ring[near_text > 0] = 0
    px = rgb[ring > 0]
    if len(px) < 50:
        return None, 999.0
    med = np.median(px, axis=0)
    return med, float(np.abs(px - med).mean())


def plan_erase(rgb: np.ndarray, region: Region, siblings: list[Region] | None = None) -> None:
    """يحدد `erase_mask` و`clean_mode` للمنطقة (بلا تعديل الصورة)."""
    H, W = rgb.shape[:2]
    gh = _glyph_height(region.glyph, region.box)
    core = cv2.morphologyEx(region.glyph, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    # حروف الشقيقات في نفس الفقاعة ليست «رسمًا»: تُستثنى من قياس التجانس
    others = np.zeros_like(core)
    for sib in siblings or []:
        others |= sib.glyph

    bubble_mask = region.bubble.mask if region.bubble is not None else None
    if bubble_mask is None and region.bubble_box is not None:
        from .regions import flat_box_mask

        bubble_mask = flat_box_mask(rgb, region.bubble_box, region.box)

    if bubble_mask is not None:
        erode = max(3, int(gh * 0.25))
        inner = cv2.erode(bubble_mask, np.ones((erode * 2 + 1, erode * 2 + 1), np.uint8))
        grow = max(7, int(gh * 0.45))
        near = cv2.dilate(core, np.ones((grow * 2 + 1, grow * 2 + 1), np.uint8))
        color, spread = _flat_color(rgb, inner, cv2.dilate(core | others, np.ones((grow * 3, grow * 3), np.uint8)))
        if color is not None and spread < 7.0:
            # مسطّحة: الحروف + كل ما يخالف لون الفقاعة قربها (توهج/ظل) — داخل الفقاعة فقط
            deviant = (np.abs(rgb.astype(np.int16) - color.astype(np.int16)).max(axis=2) > 12).astype(np.uint8) * 255
            halo = cv2.dilate(core, np.ones((grow * 4 + 1, grow * 4 + 1), np.uint8))
            mask = (near | (deviant & halo)) & inner
            # فتات معزول بعيد عن الحروف (نقطة رسم) لا يُمسح
            mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) | (near & inner)
            region.erase_mask = mask
            region.clean_mode = "fill"
            region.notes.append(f"flat bubble, spread {spread:.1f}, fill {tuple(int(c) for c in color)}")
            region.fill_color = color  # type: ignore[attr-defined]
            return
        region.erase_mask = near & inner
        region.clean_mode = "inpaint"
        region.notes.append(f"bubble with art, spread {spread:.1f}")
        return

    # نص فوق الرسم: يشمل حدّ الحرف السميك وهالته
    grow = max(9, int(gh * 0.5))
    mask = cv2.dilate(core, np.ones((grow * 2 + 1, grow * 2 + 1), np.uint8))
    x1, y1, x2, y2 = region.box
    allow = np.zeros((H, W), np.uint8)
    m = grow + 4
    allow[max(0, y1 - m) : min(H, y2 + m), max(0, x1 - m) : min(W, x2 + m)] = 255
    region.erase_mask = mask & allow
    region.clean_mode = "inpaint"


def apply_erase(rgb: np.ndarray, regions: list[Region], inpainter: Inpainter | None) -> np.ndarray:
    """ينفّذ المسح المخطَّط لكل منطقة معتمدة؛ يرجع نسخة معدَّلة."""
    out = rgb.copy()
    for r in regions:
        if r.status != "translated" or r.erase_mask is None or r.clean_mode is None:
            continue
        sel = r.erase_mask > 0
        if not sel.any():
            continue
        if r.clean_mode == "fill":
            out[sel] = r.fill_color.astype(np.uint8)
        elif inpainter is not None:
            ys, xs = np.where(sel)
            box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
            out = inpainter.inpaint_box(out, r.erase_mask, box)
        else:
            # بلا LaMa: لا نخاطر بالرسم — تبقى المنطقة كما هي وتُعلَّم
            r.status = "skipped:no_inpainter"
            r.notes.append("inpainter unavailable; region left untouched")
    return out
