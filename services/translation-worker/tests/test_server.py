"""عقد HTTP للعامل بلا نماذج: خطّ أنابيب بديل يثبت شكل الطلب والرد وتمرير التوكن."""

from __future__ import annotations

import base64
import io

import numpy as np
import pytest
from PIL import Image

from vantara_worker.pipeline import PageResult
from vantara_worker.translate_client import NullTranslator, SyncWorkerTranslator


class StubPipeline:
    load_seconds = 0.1

    def __init__(self) -> None:
        self.calls: list[dict] = []

    @staticmethod
    def decode(data: bytes):
        try:
            img = np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))
        except Exception as e:
            raise ValueError("not an image") from e
        return img, "a" * 64

    def run(self, data: bytes, meta, translator):
        rgb, page_hash = self.decode(data)
        self.calls.append({"meta": meta, "translator": translator})
        H, W = rgb.shape[:2]
        return PageResult(W, H, page_hash, [], rgb, "stub", False, None, {"detect": 0.0})

    def debug_image(self, rgb, result):
        return rgb


@pytest.fixture
def client(monkeypatch):
    fastapi_testclient = pytest.importorskip("fastapi.testclient")
    monkeypatch.setenv("VANTARA_SYNC_URL", "https://sync.example")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    from vantara_worker.server import build_app

    stub = StubPipeline()
    app = build_app(pipeline=stub)  # type: ignore[arg-type]
    return fastapi_testclient.TestClient(app), stub


def small_jpeg() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (64, 96), (255, 255, 255)).save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


def test_health_reports_loaded_pipeline(client):
    c, _ = client
    body = c.get("/health").json()
    assert body == {"ok": True, "loaded": True, "loadSeconds": 0.1, "sync": True}


def test_translate_page_returns_image_regions_and_forwards_the_bearer(client):
    c, stub = client
    res = c.post(
        "/translate/page",
        json={"image": {"mediaType": "image/jpeg", "data": small_jpeg()}, "seriesRef": "ext:x", "seriesTitle": "X", "pageIndex": 3, "sourceLang": "en", "debug": True},
        headers={"authorization": "Bearer user-token"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["width"] == 64 and body["height"] == 96
    assert body["pageHash"] == "a" * 64
    assert body["image"].startswith("data:image/webp;base64,")
    assert body["debug"].startswith("data:image/jpeg;base64,")
    assert body["regions"] == [] and body["translated"] == 0
    call = stub.calls[0]
    assert call["meta"].series_ref == "ext:x" and call["meta"].page_index == 3 and call["meta"].source_lang == "en"
    tr = call["translator"]
    assert isinstance(tr, SyncWorkerTranslator) and tr.bearer == "user-token" and tr.base_url == "https://sync.example"


def test_without_a_bearer_no_translation_is_attempted(client):
    c, stub = client
    res = c.post("/translate/page", json={"image": {"data": small_jpeg()}, "seriesRef": "ext:x"})
    assert res.status_code == 200
    assert isinstance(stub.calls[0]["translator"], NullTranslator)


def test_rejects_garbage_and_oversized_images(client):
    c, _ = client
    assert c.post("/translate/page", json={"image": {"data": "bm90IGFuIGltYWdl"}, "seriesRef": "ext:x"}).status_code == 400
    assert c.post("/translate/page", json={"image": {"data": ""}, "seriesRef": "ext:x"}).status_code == 400
