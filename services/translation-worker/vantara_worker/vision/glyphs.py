"""قناع الحروف نفسها: رأس UNet في comic-text-detector (dmMaze).

الأوزان `comictextdetector.pt.onnx` (GPL-3.0، تُشغَّل على الخادم فقط). النموذج
يخرج ثلاثة: صناديق YOLOv5، قناع الحروف `seg`، وخرائط DBNet للأسطر. نأخذ
القناع والأسطر؛ الصناديق تأتي من RT-DETR (أدق على فقاعات الويبتون).

يُشغَّل عبر OpenCV DNN لا onnxruntime: القياس أظهر أن onnxruntime يقضي 25 ثانية
في ConvTranspose لهذا الرسم البياني (35 ثانية للشريحة) بينما OpenCV يجريه في
3 ثوانٍ. الصفحة 1080×2316 = ثلاث شرائح 1024×1024 ≈ 10 ثوانٍ على CPU.

القياس على الصفحات الحقيقية: القناع ضيّق على الحروف داخل الفقاعات، ويلتقط
النص الأبيض فوق المطر والدخان والخلفية السوداء؛ وينتج بقعًا زائفة فوق بعض
النقوش (رمل، أعشاب). لذلك لا يُستعمل وحده أبدًا: يُقطع دائمًا داخل صندوق نصٍّ
من RT-DETR (انظر `regions`).
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .. import models
from .common import vertical_tiles

INPUT = 1024


@dataclass
class GlyphMaps:
    seg: np.ndarray  # HxW float32 في [0,1]: احتمال «حرف»
    lines: np.ndarray  # HxW float32: خريطة DBNet للأسطر


class GlyphSegmenter:
    def __init__(self) -> None:
        self.net = cv2.dnn.readNetFromONNX(str(models.ensure("ctd")))
        self.outputs = self.net.getUnconnectedOutLayersNames()

    def _tile(self, rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        h, w = rgb.shape[:2]
        r = min(INPUT / h, INPUT / w)
        nw, nh = round(w * r), round(h * r)
        canvas = np.zeros((INPUT, INPUT, 3), np.uint8)
        canvas[:nh, :nw] = cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_LINEAR)
        x = (canvas.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
        self.net.setInput(x)
        outs = dict(zip(self.outputs, self.net.forward(self.outputs), strict=True))
        seg = outs["seg"][0, 0, :nh, :nw]
        lines = outs["det"][0, 0, :nh, :nw]
        return (
            cv2.resize(seg, (w, h), interpolation=cv2.INTER_LINEAR),
            cv2.resize(lines, (w, h), interpolation=cv2.INTER_LINEAR),
        )

    def __call__(self, rgb: np.ndarray) -> GlyphMaps:
        H, W = rgb.shape[:2]
        # العرض → 1024، وشرائح مربعة رأسية متداخلة، والمتوسط في التداخل
        tile_h = int(W)  # مربع بدقة الصورة
        overlap = int(W * 0.12)
        seg_acc = np.zeros((H, W), np.float32)
        lines_acc = np.zeros((H, W), np.float32)
        count = np.zeros((H, W), np.float32)
        for y0, y1 in vertical_tiles(H, tile_h, overlap):
            seg, lines = self._tile(rgb[y0:y1])
            seg_acc[y0:y1] += seg
            lines_acc[y0:y1] += lines
            count[y0:y1] += 1
        count = np.maximum(count, 1)
        return GlyphMaps(seg_acc / count, lines_acc / count)


def glyph_mask(maps: GlyphMaps, thresh: float = 0.3) -> np.ndarray:
    """قناع ثنائي للحروف (255 = حرف)."""
    return ((maps.seg > thresh) * 255).astype(np.uint8)
