"""قراءة النص الأصلي داخل كل منطقة.

  * اللاتيني (إنجليزي وما يشبهه): PP-OCRv5 mobile rec (Apache-2.0) على كل سطر.
    الأسطر تُشتق من قناع الحروف نفسه (إسقاط أفقي داخل صندوق النص) لا من
    نموذج آخر: ما اعتبره القناع حرفًا هو ما يُقرأ، فلا سطر يضيع.
  * الياباني: manga-ocr (Apache-2.0، ONNX int8) على المنطقة كاملة؛ يفهم العمودي.

القياس على الصفحات الحقيقية: 10 من 10 فقاعات إنجليزية قُرئت حرفيًا بثقة ≥ 0.93،
في 0.05–0.10 ثانية للصفحة.

القراءة هنا «مسودّة»: Luna ترى الصورة أيضًا وتصحّح ما أخطأه OCR، لكن وجود
نص مقروء محليًّا يعطي عتبة أمان: منطقة بلا حروف مقروءة لا تُبيَّض.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from . import models
from .vision.common import Box, make_session


@dataclass
class OcrLine:
    box: Box
    text: str
    confidence: float


@dataclass
class OcrResult:
    text: str
    confidence: float
    lines: list[OcrLine]


def split_lines(glyph: np.ndarray, box: Box, min_gap: int = 3) -> list[Box]:
    """أسطر النص من الإسقاط الأفقي لقناع الحروف داخل الصندوق."""
    x1, y1, x2, y2 = box
    sub = glyph[y1:y2, x1:x2] > 0
    if not sub.any():
        return []
    rows = sub.sum(axis=1)
    lines: list[Box] = []
    inside = False
    start = 0
    gap = 0
    for y, v in enumerate(rows):
        if v > 0:
            if not inside:
                inside, start = True, y
            gap = 0
        elif inside:
            gap += 1
            if gap >= min_gap:
                lines.append((y1 + start, y1 + y - gap))
                inside = False
    if inside:
        lines.append((y1 + start, y1 + len(rows)))
    out: list[Box] = []
    heights = [b - a for a, b in lines]
    typical = float(np.median(heights)) if heights else 0
    for a, b in lines:
        if b - a < max(4, typical * 0.35):  # نقطة أو شرطة وحدها ليست سطرًا
            continue
        cols = np.where(sub[a - y1 : b - y1].any(axis=0))[0]
        out.append((x1 + int(cols[0]), a, x1 + int(cols[-1]) + 1, b))
    return out


class LatinOcr:
    """PP-OCRv5 CTC recognition، سطرٌ سطرًا."""

    HEIGHT = 48

    def __init__(self) -> None:
        self.session = make_session(str(models.ensure("ppocr_en_rec")), threads=2)
        self.input = self.session.get_inputs()[0].name
        with open(models.ensure("ppocr_en_dict"), encoding="utf-8") as f:
            self.chars = [line.rstrip("\n") for line in f]

    def recognize(self, bgr_line: np.ndarray) -> tuple[str, float]:
        h, w = bgr_line.shape[:2]
        if h < 4 or w < 4:
            return "", 0.0
        W = max(16, int(np.ceil(self.HEIGHT * w / h)))
        x = cv2.resize(bgr_line, (W, self.HEIGHT), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
        x = ((x - 0.5) / 0.5).transpose(2, 0, 1)[None]
        logits = self.session.run(None, {self.input: x})[0][0]
        vocab = ["", *self.chars, " "] if logits.shape[-1] == len(self.chars) + 2 else ["", *self.chars]
        if logits.max() > 1.0 or logits.min() < 0.0:
            e = np.exp(logits - logits.max(-1, keepdims=True))
            logits = e / e.sum(-1, keepdims=True)
        idx = logits.argmax(-1)
        chars: list[str] = []
        confs: list[float] = []
        last = -1
        for t, i in enumerate(idx):
            if i != 0 and i != last and i < len(vocab):
                chars.append(vocab[i])
                confs.append(float(logits[t, i]))
            last = int(i)
        return "".join(chars).strip(), float(np.mean(confs)) if confs else 0.0

    def read(self, rgb: np.ndarray, glyph: np.ndarray, box: Box, pad: int = 4) -> OcrResult:
        H, W = rgb.shape[:2]
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        lines: list[OcrLine] = []
        for lx1, ly1, lx2, ly2 in split_lines(glyph, box):
            crop = bgr[max(0, ly1 - pad) : min(H, ly2 + pad), max(0, lx1 - pad) : min(W, lx2 + pad)]
            text, conf = self.recognize(crop)
            if text:
                lines.append(OcrLine((lx1, ly1, lx2, ly2), text, conf))
        text = " ".join(line.text for line in lines)
        conf = float(np.mean([line.confidence for line in lines])) if lines else 0.0
        return OcrResult(text, conf, lines)


class MangaOcr:
    """manga-ocr: ترميز الصورة 224×224 ثم فكّ تسلسلي greedy."""

    def __init__(self) -> None:
        self.encoder = make_session(str(models.ensure("mangaocr_encoder")), threads=2)
        self.decoder = make_session(str(models.ensure("mangaocr_decoder")), threads=2)
        with open(models.ensure("mangaocr_vocab"), encoding="utf-8") as f:
            self.vocab = f.read().splitlines()
        self.enc_in = self.encoder.get_inputs()[0].name
        names = [i.name for i in self.decoder.get_inputs()]
        self.dec_tokens = next((n for n in names if "input_ids" in n or "token" in n), names[0])
        self.dec_hidden = next((n for n in names if "encoder" in n), names[-1])

    def read(self, rgb: np.ndarray, glyph: np.ndarray, box: Box, pad: int = 6) -> OcrResult:
        H, W = rgb.shape[:2]
        x1, y1, x2, y2 = box
        crop = rgb[max(0, y1 - pad) : min(H, y2 + pad), max(0, x1 - pad) : min(W, x2 + pad)]
        gray = cv2.cvtColor(cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY), cv2.COLOR_GRAY2RGB)
        im = cv2.resize(gray, (224, 224), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
        x = ((im - 0.5) / 0.5).transpose(2, 0, 1)[None]
        hidden = self.encoder.run(None, {self.enc_in: x})[0]
        tokens = [2]
        for _ in range(300):
            logits = self.decoder.run(None, {self.dec_tokens: np.array([tokens], dtype=np.int64), self.dec_hidden: hidden})[0]
            nxt = int(np.argmax(logits[0, -1]))
            tokens.append(nxt)
            if nxt == 3:
                break
        text = "".join(self.vocab[t] for t in tokens if t >= 5 and t < len(self.vocab))
        text = "".join(text.split()).replace("…", "...")
        return OcrResult(text, 1.0 if text else 0.0, [OcrLine(box, text, 1.0 if text else 0.0)])
