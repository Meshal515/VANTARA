"""قناع الفقاعة بكسلًا بكسلًا: YOLOv8m-seg المدرَّب على فقاعات المانجا والكوميكس.

النموذج `kitsumed/yolov8m_seg-speech-bubble` (GPL-3.0، أوزان فقط)، صنف واحد
«speech bubble». القياس على صفحات VANTARA: كل فقاعات الكلام والتفكير وُجدت
بأقنعة تتبع الحافة (بما فيها الفقاعتان الملتصقتان)، ولم يُنتج أي فقاعة على
نص السرد فوق الرسم — وهذا هو المطلوب: لا فقاعة = لا تبييض مسطّح.

صناديق السرد المستطيلة فاتته أحيانًا (2 من 4)؛ لتلك يُشتق القناع من صندوق
RT-DETR بالتعبئة (انظر `regions.flat_box_mask`).
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .. import models
from .common import Box, make_session, nms


@dataclass
class Bubble:
    box: Box
    score: float
    mask: np.ndarray  # HxW uint8، 255 داخل الفقاعة، بحجم الصورة الأصلية
    polygon: np.ndarray  # Nx2 int32


class BubbleSegmenter:
    def __init__(self, *, conf: float = 0.35, iou: float = 0.5, input_size: int = 1024):
        self.session = make_session(str(models.ensure("bubbleseg")))
        self.conf, self.iou, self.size = conf, iou, input_size

    def _infer(self, rgb: np.ndarray) -> list[Bubble]:
        H, W = rgb.shape[:2]
        S = self.size
        r = min(S / H, S / W)
        nw, nh = round(W * r), round(H * r)
        canvas = np.full((S, S, 3), 114, np.uint8)
        canvas[:nh, :nw] = cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_LINEAR)
        x = (canvas.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
        out0, protos = self.session.run(None, {"images": x})
        p = out0[0].T  # anchors × (cx, cy, w, h, conf, 32 mask coeffs)
        cand = p[p[:, 4] > self.conf]
        if not len(cand):
            return []
        boxes = np.stack(
            [cand[:, 0] - cand[:, 2] / 2, cand[:, 1] - cand[:, 3] / 2, cand[:, 0] + cand[:, 2] / 2, cand[:, 1] + cand[:, 3] / 2],
            1,
        )
        pr = protos[0]
        mh, mw = pr.shape[1:]
        flat = pr.reshape(32, -1)
        bubbles: list[Bubble] = []
        for i in nms(boxes, cand[:, 4], self.iou):
            m = 1 / (1 + np.exp(-(cand[i, 5:] @ flat).reshape(mh, mw)))
            m = cv2.resize(m, (S, S), interpolation=cv2.INTER_LINEAR)
            x1, y1, x2, y2 = (int(max(0, min(S, v))) for v in boxes[i])
            clipped = np.zeros_like(m)
            clipped[y1:y2, x1:x2] = m[y1:y2, x1:x2]
            full = cv2.resize(clipped[:nh, :nw], (W, H), interpolation=cv2.INTER_LINEAR)
            mask = ((full > 0.5) * 255).astype(np.uint8)
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not contours:
                continue
            biggest = max(contours, key=cv2.contourArea)
            if cv2.contourArea(biggest) < 200:
                continue
            # فقاعة واحدة = مكوّن واحد؛ الفتات حول القناع ليس فقاعة
            mask[:] = 0
            cv2.drawContours(mask, [biggest], -1, 255, -1)
            bx, by, bw, bh = cv2.boundingRect(biggest)
            bubbles.append(Bubble((bx, by, bx + bw, by + bh), float(cand[i, 4]), mask, biggest.reshape(-1, 2).astype(np.int32)))
        return bubbles

    def __call__(self, rgb: np.ndarray) -> list[Bubble]:
        H, W = rgb.shape[:2]
        if H <= W * 2.6:
            return self._infer(rgb)
        # ويبتون: شرائح مربعة تقريبًا متداخلة، ثم دمج الأقنعة المتكررة
        tile = int(W * 2.2)
        overlap = int(W * 0.4)
        found: list[Bubble] = []
        y = 0
        while True:
            y0 = min(y, H - tile)
            for b in self._infer(rgb[y0 : y0 + tile]):
                mask = np.zeros((H, W), np.uint8)
                mask[y0 : y0 + tile] = b.mask
                x1, y1, x2, y2 = b.box
                poly = b.polygon + np.array([0, y0], dtype=np.int32)
                found.append(Bubble((x1, y1 + y0, x2, y2 + y0), b.score, mask, poly))
            if y0 + tile >= H:
                break
            y = y0 + tile - overlap
        found.sort(key=lambda b: -b.score)
        kept: list[Bubble] = []
        for b in found:
            if any(_mask_iou(b.mask, k.mask) > 0.5 for k in kept):
                continue
            kept.append(b)
        return kept


def _mask_iou(a: np.ndarray, b: np.ndarray) -> float:
    inter = np.count_nonzero(a & b)
    union = np.count_nonzero(a | b)
    return inter / union if union else 0.0
