"""أدوات مشتركة: جلسة onnxruntime، NMS، تقسيم الصفحة الطويلة."""

from __future__ import annotations

from collections.abc import Callable, Iterator

import numpy as np

Box = tuple[int, int, int, int]  # x1, y1, x2, y2 بإحداثيات الصورة الأصلية


def make_session(path: str, threads: int = 4):
    import onnxruntime as ort

    so = ort.SessionOptions()
    so.log_severity_level = 3
    so.intra_op_num_threads = threads
    providers = ["CPUExecutionProvider"]
    try:
        available = ort.get_available_providers()
        if "CUDAExecutionProvider" in available:
            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    except Exception:
        pass
    return ort.InferenceSession(path, sess_options=so, providers=providers)


def nms(boxes: np.ndarray, scores: np.ndarray, iou_thr: float) -> list[int]:
    """Non-maximum suppression على صناديق xyxy؛ يرجع فهارس المحتفظ بها بترتيب الثقة."""
    if len(boxes) == 0:
        return []
    x1, y1, x2, y2 = boxes.T
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size:
        i = order[0]
        keep.append(int(i))
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-9)
        order = order[1:][iou < iou_thr]
    return keep


def iou(a: Box, b: Box) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def contains_ratio(outer: Box, inner: Box) -> float:
    """أي جزء من `inner` يقع داخل `outer`."""
    x1, y1 = max(outer[0], inner[0]), max(outer[1], inner[1])
    x2, y2 = min(outer[2], inner[2]), min(outer[3], inner[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    area = (inner[2] - inner[0]) * (inner[3] - inner[1])
    return inter / area if area > 0 else 0.0


def vertical_tiles(height: int, tile: int, overlap: int) -> Iterator[tuple[int, int]]:
    """يقسّم ارتفاعًا إلى شرائح متداخلة `(y0, y1)`؛ الأخيرة تُسحب لأعلى لتبقى كاملة."""
    if height <= tile:
        yield 0, height
        return
    y = 0
    while True:
        y0 = min(y, height - tile)
        yield y0, y0 + tile
        if y0 + tile >= height:
            return
        y = y0 + tile - overlap


def run_tiled(
    image: np.ndarray,
    tile_h: int,
    overlap: int,
    fn: Callable[[np.ndarray], list[tuple[Box, float, str]]],
    iou_thr: float = 0.5,
) -> list[tuple[Box, float, str]]:
    """يشغّل كاشف صناديق على شرائح رأسية ويدمج التكرار في التداخل."""
    out: list[tuple[Box, float, str]] = []
    for y0, y1 in vertical_tiles(image.shape[0], tile_h, overlap):
        for (x1, ya, x2, yb), score, label in fn(image[y0:y1]):
            out.append(((x1, ya + y0, x2, yb + y0), score, label))
    merged: list[tuple[Box, float, str]] = []
    for label in sorted({d[2] for d in out}):
        same = [d for d in out if d[2] == label]
        boxes = np.array([d[0] for d in same], dtype=np.float32)
        scores = np.array([d[1] for d in same], dtype=np.float32)
        merged += [same[i] for i in nms(boxes, scores, iou_thr)]
    return merged
