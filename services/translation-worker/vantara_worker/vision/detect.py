"""كشف الفقاعات وصناديق النص: RT-DETR-v2 المدرَّب على المانجا والويبتون والكوميكس.

النموذج `ogkalu/comic-text-and-bubble-detector` (Apache-2.0)، النسخة int8 الصغيرة:
0.3 ثانية للصفحة على CPU. ثلاث فئات: `bubble` (فقاعة/صندوق سرد)، `text_bubble`
(نص داخل فقاعة)، `text_free` (نص فوق الرسم أو مؤثر صوتي).

القياس على صفحات VANTARA الحقيقية (2026-09-24): كل الفقاعات وصناديق النص
وُجدت في التسع صفحات؛ المؤثرات الصوتية جاءت `text_free` بثقة منخفضة (0.37–0.46)
وهذا مفيد لتمييزها؛ والمؤثر الكوري الضخم أنتج «فقاعات» زائفة داخل فراغات
الحروف بثقة 0.36–0.53 — تُرشَّح لاحقًا لأن لا حروف فيها.

الصفحة الطويلة (ويبتون) تُقسَّم شرائح بنسبة ≤ 2.2 مع تداخل، لأن النموذج يرى
640×640 مشوَّهة: شريط 800×12000 مضغوط في مربع يُسقط النص الصغير.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .. import models
from .common import Box, make_session, run_tiled

LABELS = {0: "bubble", 1: "text_bubble", 2: "text_free"}


@dataclass(frozen=True)
class Detection:
    box: Box
    score: float
    label: str  # bubble | text_bubble | text_free


class TextBubbleDetector:
    def __init__(self, *, conf: float = 0.3, input_size: int = 640, max_ratio: float = 2.2):
        self.session = make_session(str(models.ensure("rtdetr")))
        self.conf = conf
        self.size = input_size
        self.max_ratio = max_ratio

    def _tile(self, rgb: np.ndarray) -> list[tuple[Box, float, str]]:
        h, w = rgb.shape[:2]
        im = cv2.resize(rgb, (self.size, self.size), interpolation=cv2.INTER_AREA)
        x = (im.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
        labels, boxes, scores = self.session.run(
            None, {"images": x, "orig_target_sizes": np.array([[w, h]], dtype=np.int64)}
        )[:3]
        out: list[tuple[Box, float, str]] = []
        for lab, box, sc in zip(labels[0], boxes[0], scores[0], strict=True):
            if sc < self.conf:
                continue
            x1, y1, x2, y2 = (round(float(v)) for v in box)
            x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w, x2), min(h, y2)
            if x2 - x1 < 4 or y2 - y1 < 4:
                continue
            out.append(((x1, y1, x2, y2), float(sc), LABELS.get(int(lab), "text_free")))
        return out

    def __call__(self, rgb: np.ndarray) -> list[Detection]:
        _h, w = rgb.shape[:2]
        tile_h = int(w * self.max_ratio)
        overlap = int(w * 0.35)
        dets = run_tiled(rgb, tile_h, overlap, self._tile, iou_thr=0.5)
        return [Detection(b, s, lab) for b, s, lab in dets]
