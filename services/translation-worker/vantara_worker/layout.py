"""تخطيط العربي داخل الفقاعة: التفاف مقيَّد بمضلّع الفقاعة لا بمستطيل.

الفكرة كما يفعل المخطِّط البشري: يبدأ من أكبر حجم خط، ويلفّ الكلمات في أسطر
كل سطر بعرض الوتر المتاح داخل الفقاعة عند ارتفاعه (من قناع الفقاعة المتآكل)،
ويوازن الأسطر (الأوسط أعرض، الأطراف أضيق)، وينزل حجمًا حتى تدخل الكتلة كلها.

الرسم بـPillow/RAQM (HarfBuzz + FriBidi) — الطبقة المُثبتة في `arabic.py`.
الخط Baloo Bhaijaan 2 (OFL): مصمَّم للعربية، مستدير سميك يشبه خطوط الكوميك.

النص فوق الرسم (بلا فقاعة) يُرسم في صندوق النص الأصلي بلون حبره (أبيض على
داكن، أسود على فاتح) مع حدّ بلون مضاد بسُمك يتبع الحجم، كما في الأصل.
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .regions import Region
from .vision.common import Box

FONT_PATH = str(Path(__file__).resolve().parent.parent / "fonts" / "BalooBhaijaan2.ttf")
MIN_SIZE = 12
LINE_SPACING = 1.08  # من ارتفاع الحرف الفعلي لا من ascent+descent (Baloo يبالغ فيهما)


@lru_cache(maxsize=128)
def font(size: int, path: str = FONT_PATH) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(path, size, layout_engine=ImageFont.Layout.RAQM)
    with contextlib.suppress(Exception):
        f.set_variation_by_name("SemiBold")
    return f


_measure = ImageDraw.Draw(Image.new("L", (1, 1)))


def text_width(text: str, size: int) -> float:
    return _measure.textlength(text, font=font(size), direction="rtl", language="ar")


def line_metrics(size: int) -> tuple[int, int]:
    """(ارتفاع سطر، إزاحة القاعدة) من صندوق حبر حقيقي لعيّنة عربية عالية ومنخفضة."""
    f = font(size)
    _l, t, _r, b = f.getbbox("لجفقيبطئ", anchor="ls", direction="rtl", language="ar")
    ascent = -t
    descent = b
    return round((ascent + descent) * LINE_SPACING), int(ascent)


@dataclass
class Layout:
    size: int
    lines: list[str]
    positions: list[tuple[float, float]]  # مركز x، قاعدة y لكل سطر
    bounds: Box
    fits: bool


def _chord(mask: np.ndarray, y: int, cx: int) -> tuple[int, int] | None:
    """أطول امتداد أفقي داخل القناع عند الصف y يحتوي cx (أو الأقرب إليه)."""
    if y < 0 or y >= mask.shape[0]:
        return None
    row = mask[y] > 0
    if not row.any():
        return None
    xs = np.where(row)[0]
    # مقاطع متصلة
    breaks = np.where(np.diff(xs) > 1)[0]
    segs = np.split(xs, breaks + 1)
    best = min(segs, key=lambda s: 0 if s[0] <= cx <= s[-1] else min(abs(s[0] - cx), abs(s[-1] - cx)))
    return int(best[0]), int(best[-1])


def _wrap_polygon(words: list[str], size: int, mask: np.ndarray, cx: int, top: int, line_h: int, pad: int) -> tuple[list[str], list[tuple[int, int]]] | None:
    """يلفّ الكلمات سطرًا سطرًا من `top` نزولًا؛ كل سطر بعرض وتر القناع عنده."""
    lines: list[str] = []
    spans: list[tuple[int, int]] = []
    y = top
    i = 0
    while i < len(words):
        rows = [_chord(mask, yy, cx) for yy in (y, y + line_h // 2, y + line_h - 1)]
        if any(r is None for r in rows):
            return None
        left = max(r[0] for r in rows) + pad  # type: ignore[index]
        right = min(r[1] for r in rows) - pad  # type: ignore[index]
        width = right - left
        if width < size:
            return None
        line = words[i]
        if text_width(line, size) > width:
            return None  # كلمة واحدة أطول من الوتر: لا نقطع الكلمة العربية
        i += 1
        while i < len(words) and text_width(f"{line} {words[i]}", size) <= width:
            line = f"{line} {words[i]}"
            i += 1
        lines.append(line)
        spans.append((left, right))
        y += line_h
    return lines, spans


def fit_in_mask(text: str, mask: np.ndarray, anchor: Box, *, max_size: int, min_size: int = MIN_SIZE, pad: int = 4) -> Layout | None:
    """أكبر حجم يُدخل النص في القناع، متمركزًا رأسيًا حول مركز صندوق النص الأصلي."""
    words = text.split()
    if not words:
        return None
    ys, _xs = np.where(mask > 0)
    if len(ys) == 0:
        return None
    cx = int((anchor[0] + anchor[2]) / 2)
    cy_anchor = (anchor[1] + anchor[3]) / 2
    cy_mask = float(ys.mean())
    # المركز: مركز النص الأصلي، لكنه لا يبتعد عن مركز الفقاعة أكثر من الربع
    cy = cy_anchor if abs(cy_anchor - cy_mask) < (ys.max() - ys.min()) * 0.25 else cy_mask
    for size in range(max_size, min_size - 1, -1):
        line_h, ascent = line_metrics(size)
        # نخمّن عدد الأسطر، نلفّ من أعلى الكتلة المتمركزة، ثم نعيد التمركز على العدد الفعلي
        n_guess = 1
        for _ in range(14):
            top = int(cy - n_guess * line_h / 2)
            res = _wrap_polygon(words, size, mask, cx, top, line_h, pad)
            if res is None:
                n_guess += 1
                continue
            lines, spans = res
            if len(lines) != n_guess:
                n_guess = len(lines)
                res2 = _wrap_polygon(words, size, mask, cx, int(cy - n_guess * line_h / 2), line_h, pad)
                if res2 is None or len(res2[0]) != n_guess:
                    n_guess += 1
                    continue
                lines, spans = res2
                top = int(cy - n_guess * line_h / 2)
            positions = []
            x1 = 10**9
            x2 = -1
            for k, (l, r) in enumerate(spans):
                w = text_width(lines[k], size)
                mid = (l + r) / 2
                positions.append((mid, top + k * line_h + ascent))
                x1 = min(x1, int(mid - w / 2))
                x2 = max(x2, int(mid + w / 2))
            return Layout(size, lines, positions, (x1, top, x2, top + len(lines) * line_h), True)
    return None


def fit_in_box(text: str, box: Box, *, max_size: int, image_size: tuple[int, int], min_size: int = MIN_SIZE, grow: float = 1.2) -> Layout | None:
    """للنص فوق الرسم: مستطيل النص الأصلي موسَّعًا قليلًا، ولا يخرج من الصورة."""
    words = text.split()
    if not words:
        return None
    W, H = image_size
    x1, y1, x2, y2 = box
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    w = (x2 - x1) * grow
    h = (y2 - y1) * grow
    margin = 8
    w = min(w, 2 * (cx - margin), 2 * (W - margin - cx))
    h = min(h, 2 * (cy - margin), 2 * (H - margin - cy))
    for size in range(max_size, min_size - 1, -1):
        line_h, ascent = line_metrics(size)
        lines: list[str] = []
        cur = ""
        ok = True
        for word in words:
            cand = f"{cur} {word}".strip()
            if not cur or text_width(cand, size) <= w:
                cur = cand
            else:
                if text_width(cur, size) > w:
                    ok = False
                lines.append(cur)
                cur = word
        if cur:
            lines.append(cur)
        if not ok or any(text_width(line, size) > w for line in lines) or len(lines) * line_h > h:
            continue
        top = cy - len(lines) * line_h / 2
        positions = [(cx, top + k * line_h + ascent) for k in range(len(lines))]
        widest = max(text_width(line, size) for line in lines)
        return Layout(size, lines, positions, (int(cx - widest / 2), int(top), int(cx + widest / 2), int(top + len(lines) * line_h)), True)
    return None


def glyph_height_of(region: Region) -> int:
    x1, y1, x2, y2 = region.box
    sub = region.glyph[y1:y2, x1:x2] > 0
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
    return int(np.median(runs)) if runs else max(12, (y2 - y1) // 3)


def layout_region(region: Region, text: str, inner_mask: np.ndarray | None, image_size: tuple[int, int]) -> Layout | None:
    """يختار المساحة الصحيحة للمنطقة ويعيد تخطيطًا أو None إن لم يدخل النص بحجم مقروء."""
    gh = glyph_height_of(region)
    # حجم الخط: يتبع ارتفاع الحرف الأصلي. العربي بلا حروف كبيرة فيبدو أصغر عند نفس
    # الحجم، لذا داخل الفقاعة نسمح حتى ×1.7 (المضلّع يوقفه)، وفوق الرسم ×1.15 (الصندوق يوقفه)
    if inner_mask is not None:
        max_size = int(max(MIN_SIZE + 4, min(gh * 2.0, 110)))
        lay = fit_in_mask(text, inner_mask, region.box, max_size=max_size)
        if lay is not None:
            return lay
    max_size = int(max(MIN_SIZE + 4, min(gh * 1.15, 96)))
    return fit_in_box(text, region.box, max_size=max_size, image_size=image_size)


def draw_layout(image: Image.Image, layout: Layout, *, ink_light: bool, on_art: bool) -> None:
    draw = ImageDraw.Draw(image)
    f = font(layout.size)
    fill = (255, 255, 255) if ink_light else (16, 16, 16)
    stroke = (16, 16, 16) if ink_light else (255, 255, 255)
    stroke_w = max(2, layout.size // 9) if on_art else 0
    for line, (cx, base) in zip(layout.lines, layout.positions, strict=True):
        draw.text(
            (cx, base),
            line,
            font=f,
            fill=fill,
            anchor="ms",
            direction="rtl",
            language="ar",
            stroke_width=stroke_w,
            stroke_fill=stroke if stroke_w else None,
        )


def inner_mask_for(region: Region, rgb: np.ndarray, siblings: list[Region] | None = None) -> np.ndarray | None:
    """داخل الفقاعة المتآكل: هنا وحده يُرسم العربي. فقاعة تحمل جملتين تُقتسم:
    نصيب كل منطقة هو داخل الفقاعة بعيدًا عن صناديق شقيقاتها."""
    mask = None
    if region.bubble is not None:
        mask = region.bubble.mask
    elif region.bubble_box is not None:
        from .regions import flat_box_mask

        mask = flat_box_mask(rgb, region.bubble_box, region.box)
    if mask is None:
        return None
    gh = glyph_height_of(region)
    erode = max(6, int(gh * 0.45))
    inner = cv2.erode(mask, np.ones((erode * 2 + 1, erode * 2 + 1), np.uint8))
    for sib in siblings or []:
        sx1, sy1, sx2, sy2 = sib.box
        gap = max(4, gh // 2)
        # الحدّ بين الجملتين: منتصف المسافة بينهما، لا صندوق الشقيقة وحده
        _x1, y1, _x2, y2 = region.box
        if sy1 >= y2:  # الشقيقة تحت
            cut = (y2 + sy1) // 2
            inner[cut - gap // 2 :, :] = 0
        elif sy2 <= y1:  # الشقيقة فوق
            cut = (sy2 + y1) // 2
            inner[: cut + gap // 2, :] = 0
        else:
            inner[max(0, sy1 - gap) : sy2 + gap, max(0, sx1 - gap) : sx2 + gap] = 0
    return inner
