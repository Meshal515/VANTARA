"""الترميم: LaMa المدرَّب على الأنمي والمانجا (`anime-manga-big-lama`، ONNX من ogkalu).

يُستدعى على قطعة حول المنطقة (بهامش سياق) لا على الصفحة كلها: أسرع، وأدق
لأن الشبكة ترى الرسم المجاور بدقته. القناع 255 = يُعاد رسمه. البكسلات خارج
القناع تُعاد من الأصل حرفيًّا بعد الاستدلال، فالنموذج لا يلمس ما لم نطلبه.

القياس على الصفحات الحقيقية: المطر يستمر خلف النص الممسوح، والدخان يلتئم؛
1–2 ثانية للقطعة على CPU.
"""

from __future__ import annotations

import cv2
import numpy as np

from .. import models
from .common import Box, make_session

PAD_MOD = 8
CONTEXT = 96  # هامش الرسم حول المنطقة الذي يراه النموذج
MAX_EDGE = 1536  # قطعة أكبر تُصغَّر للاستدلال ثم تُعاد


class Inpainter:
    def __init__(self) -> None:
        self.session = make_session(str(models.ensure("lama")))

    def _forward(self, rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
        H, W = rgb.shape[:2]
        ph, pw = (PAD_MOD - H % PAD_MOD) % PAD_MOD, (PAD_MOD - W % PAD_MOD) % PAD_MOD
        im = cv2.copyMakeBorder(rgb, 0, ph, 0, pw, cv2.BORDER_REFLECT)
        mk = cv2.copyMakeBorder(mask, 0, ph, 0, pw, cv2.BORDER_CONSTANT, value=0)
        x = (im.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
        m = (mk > 0).astype(np.float32)[None, None]
        y = self.session.run(None, {"image": x, "mask": m})[0][0]
        return np.clip(y.transpose(1, 2, 0) * 255, 0, 255).astype(np.uint8)[:H, :W]

    def inpaint_box(self, rgb: np.ndarray, mask: np.ndarray, box: Box, context: int = CONTEXT) -> np.ndarray:
        """يرمّم ما داخل `mask` ضمن `box` (مع هامش سياق) ويرجع الصورة كاملة معدَّلة نسخةً."""
        H, W = rgb.shape[:2]
        x1, y1, x2, y2 = box
        cx1, cy1 = max(0, x1 - context), max(0, y1 - context)
        cx2, cy2 = min(W, x2 + context), min(H, y2 + context)
        crop = rgb[cy1:cy2, cx1:cx2]
        cmask = mask[cy1:cy2, cx1:cx2]
        if not cmask.any():
            return rgb
        ch, cw = crop.shape[:2]
        scale = min(1.0, MAX_EDGE / max(ch, cw))
        if scale < 1.0:
            small = cv2.resize(crop, (int(cw * scale), int(ch * scale)), interpolation=cv2.INTER_AREA)
            smask = cv2.resize(cmask, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST)
            filled = cv2.resize(self._forward(small, smask), (cw, ch), interpolation=cv2.INTER_CUBIC)
        else:
            filled = self._forward(crop, cmask)
        out = rgb.copy()
        region = out[cy1:cy2, cx1:cx2]
        sel = cmask > 0
        region[sel] = filled[sel]
        return out
