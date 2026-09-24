"""خادم HTTP للعامل: يستقبل الصفحة من apps/api ويرجع الصفحة المترجمة.

    POST /translate/page   JSON: { image: {mediaType, data(base64)}, seriesRef, seriesTitle,
                                   chapterKey, chapterNumber, pageIndex, sourceLang, debug? }
                           ترويسة Authorization تُمرَّر كما هي إلى sync-worker (Luna).
                           → { pageHash, width, height, engine, cached, error, translated,
                               regions: [...], image: "data:image/webp;base64,...", debug?: "data:image/jpeg;base64,..." }
    GET  /health           { ok, models, loadSeconds }

النماذج تُحمَّل مرة عند الإقلاع. المعالجة مقفلة بقفل واحد: نموذج واحد على CPU
واحد أسرع من اثنين يتنافسان، والطلبات تصطف.
"""

from __future__ import annotations

import base64
import os
import threading

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .pipeline import Pipeline, encode_webp
from .translate_client import NullTranslator, OpenAITranslator, PageMeta, SyncWorkerTranslator, Translator

MAX_IMAGE_BYTES = 12 * 1024 * 1024


class ImageIn(BaseModel):
    mediaType: str = "image/jpeg"
    data: str


class PageIn(BaseModel):
    image: ImageIn
    seriesRef: str = Field(min_length=1, max_length=200)
    seriesTitle: str | None = None
    chapterKey: str | None = None
    chapterNumber: float | None = None
    pageIndex: int = 0
    sourceLang: str = "auto"
    pageHash: str | None = None
    debug: bool = False


def build_app(pipeline: Pipeline | None = None) -> FastAPI:
    app = FastAPI(title="vantara-translation-worker")
    sync_url = os.environ.get("VANTARA_SYNC_URL", "").rstrip("/")
    lock = threading.Lock()
    state: dict[str, Pipeline | None] = {"pipe": pipeline}

    def pipe() -> Pipeline:
        if state["pipe"] is None:
            with lock:
                if state["pipe"] is None:
                    state["pipe"] = Pipeline(japanese=os.environ.get("VANTARA_JAPANESE", "") == "1")
        return state["pipe"]  # type: ignore[return-value]

    def translator_for(authorization: str | None) -> Translator:
        bearer = (authorization or "").removeprefix("Bearer ").strip()
        if sync_url and bearer:
            return SyncWorkerTranslator(sync_url, bearer)
        if os.environ.get("OPENAI_API_KEY"):
            return OpenAITranslator()
        return NullTranslator()

    @app.get("/health")
    def health() -> dict:
        p = state["pipe"]
        return {"ok": True, "loaded": p is not None, "loadSeconds": round(p.load_seconds, 1) if p else None, "sync": bool(sync_url)}

    @app.post("/translate/page")
    def translate_page(body: PageIn, authorization: str | None = Header(default=None)) -> dict:
        try:
            data = base64.b64decode(body.image.data, validate=False)
        except ValueError as e:
            raise HTTPException(400, "bad_image") from e
        if not data or len(data) > MAX_IMAGE_BYTES:
            raise HTTPException(413 if data else 400, "bad_image")
        meta = PageMeta(
            page_hash=body.pageHash or "",
            series_ref=body.seriesRef,
            series_title=body.seriesTitle,
            chapter_key=body.chapterKey,
            chapter_number=body.chapterNumber,
            page_index=body.pageIndex,
            source_lang=body.sourceLang if body.sourceLang in ("en", "ja", "ko", "zh", "auto") else "auto",
        )
        p = pipe()
        with lock:
            try:
                result = p.run(data, meta, translator_for(authorization))
            except ValueError as e:
                raise HTTPException(400, "bad_image") from e
            out = result.to_json()
            out["image"] = "data:image/webp;base64," + base64.b64encode(encode_webp(result.image)).decode()
            if body.debug:
                import cv2

                rgb, _ = p.decode(data)
                ok, buf = cv2.imencode(".jpg", cv2.cvtColor(p.debug_image(rgb, result), cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 80])
                if ok:
                    out["debug"] = "data:image/jpeg;base64," + base64.b64encode(bytes(buf)).decode()
        return out

    return app
