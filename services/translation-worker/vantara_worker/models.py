"""سجلّ الأوزان: كل نموذج باسمه ورابطه وبصمته وترخيصه.

الأوزان لا تدخل المستودع (نصف جيجابايت)؛ تُنزَّل مرة إلى `VANTARA_MODELS_DIR`
(الافتراضي `~/.cache/vantara/models`) وتُتحقَّق ببصمة sha256 قبل أي استعمال.
ملف ببصمة مختلفة يُحذف ويُرفض: نموذج مبدَّل بصمت أسوأ من نموذج مفقود.

المصادر كلها مفتوحة، وكلٌّ بترخيصه (انظر `docs/UPSTREAMS.md` §3):
  * RT-DETR-v2 comic text+bubble (ogkalu)      — Apache-2.0
  * comic-text-detector (dmMaze) ONNX           — GPL-3.0 (أوزان تُشغَّل على الخادم فقط)
  * YOLOv8m-seg speech-bubble (kitsumed) ONNX   — GPL-3.0 (أوزان تُشغَّل على الخادم فقط)
  * LaMa manga (ogkalu ONNX من anime-manga-big-lama) — Apache-2.0
  * PP-OCRv5 en mobile rec (ogkalu ONNX)        — Apache-2.0
  * manga-ocr (kha-white، ogkalu ONNX int8)      — Apache-2.0
"""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class ModelSpec:
    name: str
    url: str
    sha256: str
    filename: str
    license: str
    size_mb: int


HF = "https://huggingface.co"

SPECS: dict[str, ModelSpec] = {
    spec.name: spec
    for spec in [
        ModelSpec(
            "rtdetr",
            f"{HF}/ogkalu/comic-text-and-bubble-detector/resolve/main/detector-v4-s_int8.onnx",
            "5fe9e4f576e49d4e7e8b0e029d6d3cdc252abd4694113e1cae120e62c931ea79",
            "rtdetr-v4-s_int8.onnx",
            "Apache-2.0",
            11,
        ),
        ModelSpec(
            "ctd",
            "https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.3/comictextdetector.pt.onnx",
            "1a86ace74961413cbd650002e7bb4dcec4980ffa21b2f19b86933372071d718f",
            "comictextdetector.onnx",
            "GPL-3.0",
            95,
        ),
        ModelSpec(
            "bubbleseg",
            f"{HF}/kitsumed/yolov8m_seg-speech-bubble/resolve/main/model_dynamic.onnx",
            "36c26bdefe150226acd9669772e9ff5a011fa0dd4622469b49d3d5e359f3251c",
            "yolov8m-seg-speech-bubble.onnx",
            "GPL-3.0",
            109,
        ),
        ModelSpec(
            "lama",
            f"{HF}/ogkalu/lama-manga-onnx-dynamic/resolve/main/lama-manga-dynamic.onnx",
            "de31ffa5ba26916b8ea35319f6c12151ff9654d4261bccf0583a69bb095315f9",
            "lama-manga-dynamic.onnx",
            "Apache-2.0",
            206,
        ),
        ModelSpec(
            "ppocr_en_rec",
            f"{HF}/ogkalu/ppocr-v5-onnx/resolve/main/en_PP-OCRv5_rec_mobile_infer.onnx",
            "c3461add59bb4323ecba96a492ab75e06dda42467c9e3d0c18db5d1d21924be8",
            "ppocrv5-en-rec.onnx",
            "Apache-2.0",
            8,
        ),
        ModelSpec(
            "ppocr_en_dict",
            f"{HF}/ogkalu/ppocr-v5-onnx/resolve/main/ppocrv5_en_dict.txt",
            "e025a66d31f327ba0c232e03f407ae8d105e1e709e7ccb3f408aa778c24e70d6",
            "ppocrv5-en-dict.txt",
            "Apache-2.0",
            1,
        ),
        ModelSpec(
            "mangaocr_encoder",
            f"{HF}/ogkalu/manga-ocr-onnx/resolve/main/encoder_model_int8.onnx",
            "0eaf2b867292a44700ce38ef028b90639a2e36fc4c18c2bcdd1de7409488adb3",
            "manga-ocr-encoder-int8.onnx",
            "Apache-2.0",
            87,
        ),
        ModelSpec(
            "mangaocr_decoder",
            f"{HF}/ogkalu/manga-ocr-onnx/resolve/main/decoder_model_int8.onnx",
            "3ff0d4c34c4a66613d98ff93e0b17f22a7b09dfbeec195c3e4d6f595af3a6b6c",
            "manga-ocr-decoder-int8.onnx",
            "Apache-2.0",
            30,
        ),
        ModelSpec(
            "mangaocr_vocab",
            f"{HF}/ogkalu/manga-ocr-onnx/resolve/main/vocab.txt",
            "5cb5c5586d98a2f331d9f8828e4586479b0611bfba5d8c3b6dadffc84d6a36a3",
            "manga-ocr-vocab.txt",
            "Apache-2.0",
            1,
        ),
    ]
}

# ما يلزم صفحةً إنجليزية/كورية كاملة. اليابانية تضيف manga-ocr.
CORE = ("rtdetr", "ctd", "bubbleseg", "lama", "ppocr_en_rec", "ppocr_en_dict")
JAPANESE = ("mangaocr_encoder", "mangaocr_decoder", "mangaocr_vocab")


def models_dir() -> Path:
    return Path(os.environ.get("VANTARA_MODELS_DIR") or Path.home() / ".cache" / "vantara" / "models")


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def path_of(name: str) -> Path:
    return models_dir() / SPECS[name].filename


def is_present(name: str) -> bool:
    return path_of(name).exists()


def ensure(name: str, *, download: bool = True) -> Path:
    """يرجع مسار النموذج المتحقَّق منه؛ ينزّله إن غاب و`download` مسموح."""
    spec = SPECS[name]
    target = path_of(name)
    if target.exists():
        # قبل أي استعمال: البصمة لا الوجود. تُحسب مرة لكل نسخة من الملف (حجمه ووقته
        # محفوظان بجانبه)، وملف تالف أو مبدَّل يُحذف ويُنزَّل من جديد
        if _verified(target, spec.sha256):
            return target
        target.unlink()
        if not download:
            raise FileNotFoundError(f"model {name!r} at {target} failed its checksum and was removed")
    if not download:
        raise FileNotFoundError(f"model {name!r} missing at {target}; run `python -m vantara_worker.cli models`")
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_fd, tmp_name = tempfile.mkstemp(dir=target.parent, prefix=f".{spec.filename}.")
    os.close(tmp_fd)
    tmp = Path(tmp_name)
    try:
        with urlopen(Request(spec.url, headers={"User-Agent": "vantara-translation-worker"})) as res, tmp.open("wb") as out:
            shutil.copyfileobj(res, out, length=1 << 20)
        digest = sha256_of(tmp)
        if digest != spec.sha256:
            raise RuntimeError(f"model {name!r} checksum mismatch: got {digest}, expected {spec.sha256}")
        tmp.replace(target)
        _remember(target, digest)
    finally:
        if tmp.exists():
            tmp.unlink()
    return target


def _stamp_file(target: Path) -> Path:
    return target.with_name(f".{target.name}.sha256")


def _remember(target: Path, digest: str) -> None:
    st = target.stat()
    _stamp_file(target).write_text(f"{st.st_size}:{st.st_mtime_ns}:{digest}")


def _verified(target: Path, expected: str) -> bool:
    """بصمة الملف مطابقة؟ تُحسب مرة لكل (حجم، وقت تعديل) ثم تُقرأ من الختم."""
    st = target.stat()
    stamp = _stamp_file(target)
    try:
        size, mtime, digest = stamp.read_text().strip().split(":")
        if int(size) == st.st_size and int(mtime) == st.st_mtime_ns:
            return digest == expected
    except (OSError, ValueError):
        pass
    digest = sha256_of(target)
    _remember(target, digest)
    return digest == expected


def ensure_all(names: tuple[str, ...] = CORE, *, download: bool = True) -> dict[str, Path]:
    return {n: ensure(n, download=download) for n in names}


def verify(name: str) -> bool:
    """بصمة الملف الموجود مطابقة؟ (للفحص اليدوي؛ التنزيل يتحقق دائمًا)."""
    p = path_of(name)
    return p.exists() and sha256_of(p) == SPECS[name].sha256
