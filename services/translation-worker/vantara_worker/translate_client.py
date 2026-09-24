"""اللغة والسياق: Luna. الهندسة عندنا، والكلمات عندها.

ثلاثة عملاء بنفس الواجهة `translate(page_jpeg, meta, regions) -> TranslationReply`:

  * `SyncWorkerTranslator` — الإنتاج. يرسل النصوص بمعرّفاتها (وصورة الصفحة
    للسياق) إلى `POST /v1/translate/text` في sync-worker، حيث المفتاح وذاكرة
    العمل (القاموس والشخصيات وملخص الفصل) والحد الأسبوعي. توكن المستخدم
    يُمرَّر كما وصل من الجوال.
  * `OpenAITranslator` — للتشغيل المحلي والقياس بمفتاح مباشر (`OPENAI_API_KEY`)،
    بنفس التعليمات والمخطط.
  * `NullTranslator` — للاختبار: لا ترجمة، فتبقى كل منطقة كما هي (وهذا بحد
    ذاته اختبار: بلا عربي لا تبييض).

الرد لكل معرّف: `source` (النص الأصلي المصحَّح)، `arabic` (أو null للمؤثرات
وما لا يُترجم)، `kind`، `speaker`. المعرّفات التي لا يعرفها الرد تبقى كما هي.
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass, field
from typing import Protocol

import httpx

KINDS = ("speech", "thought", "narration", "sign", "sfx", "credit")


@dataclass
class RegionInput:
    id: str
    source: str
    kind: str  # تخمين الهندسة: speech | narration | free | sfx
    box: tuple[int, int, int, int]
    ocr_confidence: float


@dataclass
class RegionReply:
    id: str
    source: str
    arabic: str | None
    kind: str
    speaker: str | None


@dataclass
class TranslationReply:
    regions: dict[str, RegionReply] = field(default_factory=dict)
    summary: str | None = None
    engine: str = "none"
    cached: bool = False
    error: str | None = None


@dataclass
class PageMeta:
    page_hash: str
    series_ref: str
    series_title: str | None = None
    chapter_key: str | None = None
    chapter_number: float | None = None
    page_index: int = 0
    source_lang: str = "auto"


class Translator(Protocol):
    def translate(self, page_jpeg: bytes, meta: PageMeta, regions: list[RegionInput], *, width: int, height: int) -> TranslationReply: ...


class NullTranslator:
    def translate(self, page_jpeg: bytes, meta: PageMeta, regions: list[RegionInput], *, width: int, height: int) -> TranslationReply:
        return TranslationReply(engine="none")


class FakeTranslator:
    """للاختبارات: قاموس ثابت من النص الأصلي (بعد تطبيع) إلى العربي."""

    def __init__(self, table: dict[str, str | None]) -> None:
        self.table = {self.norm(k): v for k, v in table.items()}

    @staticmethod
    def norm(s: str) -> str:
        return " ".join("".join(ch for ch in s.lower() if ch.isalnum() or ch.isspace()).split())

    def translate(self, page_jpeg: bytes, meta: PageMeta, regions: list[RegionInput], *, width: int, height: int) -> TranslationReply:
        reply = TranslationReply(engine="fake")
        for r in regions:
            key = self.norm(r.source)
            if key in self.table:
                arabic = self.table[key]
                reply.regions[r.id] = RegionReply(r.id, r.source, arabic, "sfx" if arabic is None else "speech", None)
        return reply


def regions_payload(regions: list[RegionInput], width: int, height: int) -> list[dict]:
    return [
        {"id": r.id, "source": r.source, "kind": r.kind, "box": list(r.box), "ocrConfidence": round(r.ocr_confidence, 3)}
        for r in regions
    ]


def parse_reply(body: dict, engine: str) -> TranslationReply:
    reply = TranslationReply(engine=engine, cached=bool(body.get("cached")), summary=body.get("summary"))
    for r in body.get("regions") or []:
        rid = str(r.get("id") or "")
        if not rid:
            continue
        kind = r.get("kind") if r.get("kind") in KINDS else "speech"
        arabic = r.get("arabic")
        arabic = arabic.strip() if isinstance(arabic, str) and arabic.strip() else None
        if kind in ("sfx", "credit"):
            arabic = None
        reply.regions[rid] = RegionReply(rid, str(r.get("source") or ""), arabic, kind, r.get("speaker") or None)
    return reply


class SyncWorkerTranslator:
    def __init__(self, base_url: str, bearer: str, *, timeout: float = 120.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.bearer = bearer
        self.timeout = timeout

    def translate(self, page_jpeg: bytes, meta: PageMeta, regions: list[RegionInput], *, width: int, height: int) -> TranslationReply:
        payload = {
            "pageHash": meta.page_hash,
            "seriesRef": meta.series_ref,
            "seriesTitle": meta.series_title,
            "chapterKey": meta.chapter_key,
            "chapterNumber": meta.chapter_number,
            "pageIndex": meta.page_index,
            "sourceLang": meta.source_lang,
            "image": {"mediaType": "image/jpeg", "data": base64.b64encode(page_jpeg).decode(), "width": width, "height": height},
            "regions": regions_payload(regions, width, height),
        }
        try:
            res = httpx.post(
                f"{self.base_url}/v1/translate/text",
                json=payload,
                headers={"authorization": f"Bearer {self.bearer}"},
                timeout=self.timeout,
            )
        except httpx.HTTPError as e:
            return TranslationReply(engine="sync", error=f"upstream:{type(e).__name__}")
        try:
            body = res.json()
        except ValueError:
            return TranslationReply(engine="sync", error=f"http_{res.status_code}")
        if res.status_code != 200:
            return TranslationReply(engine="sync", error=str(body.get("error") or f"http_{res.status_code}"))
        return parse_reply(body, str(body.get("engine") or "sync"))


TEXT_SYSTEM_PROMPT = """You are the lead translator of VANTARA's Arabic fan-translation team. You translate one comic page (manga, manhwa, manhua, webtoon) into clear, light Modern Standard Arabic (فصحى سلسة) that reads as if written in Arabic: meaning and tone, never word for word; Arabic sentence order; short enough to fit the original bubble; correct gender and number agreement; no dialect; Arabic punctuation (، ؛ ؟) with ! and … kept; Western digits kept.

You receive the page image and a list of text regions found by the detector, each with an id, a draft OCR reading, and a box. For every region return, by its id:
- source: the original text exactly as written on the page (fix OCR mistakes by reading the image).
- kind: speech, thought, narration, sign, sfx, credit.
- arabic: the translation. null for sfx (sound effects like BOOM, CLANG, large stylised Korean/Japanese onomatopoeia drawn into the art) and credit (scanlator credits, watermarks). Signs only when the reader needs them.
- speaker: the character name or null.
Never invent regions. Never merge two ids. Keep ids exactly as given. Also return summary: one or two Arabic sentences about the page."""

TEXT_OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["regions", "summary"],
    "properties": {
        "regions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "source", "kind", "arabic", "speaker"],
                "properties": {
                    "id": {"type": "string"},
                    "source": {"type": "string"},
                    "kind": {"type": "string", "enum": list(KINDS)},
                    "arabic": {"type": ["string", "null"]},
                    "speaker": {"type": ["string", "null"]},
                },
            },
        },
        "summary": {"type": "string"},
    },
}


class OpenAITranslator:
    def __init__(self, api_key: str | None = None, model: str | None = None, *, timeout: float = 120.0) -> None:
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        self.model = model or os.environ.get("TRANSLATE_MODEL", "gpt-6-luna")
        self.timeout = timeout
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")

    def translate(self, page_jpeg: bytes, meta: PageMeta, regions: list[RegionInput], *, width: int, height: int) -> TranslationReply:
        context = [
            f"Work: {meta.series_title or 'unknown'}" + (f" — chapter {meta.chapter_number}" if meta.chapter_number is not None else "") + f", page {meta.page_index + 1}.",
            f"Source language: {'detect it' if meta.source_lang == 'auto' else meta.source_lang}.",
            "Regions (id, draft OCR, geometry guess, box x1,y1,x2,y2):",
            *[f"- {r.id}: {json.dumps(r.source, ensure_ascii=False)} [{r.kind}] box={list(r.box)}" for r in regions],
            "Translate this page.",
        ]
        body = {
            "model": self.model,
            "instructions": TEXT_SYSTEM_PROMPT,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_image", "image_url": f"data:image/jpeg;base64,{base64.b64encode(page_jpeg).decode()}", "detail": "high"},
                        {"type": "input_text", "text": "\n".join(context)},
                    ],
                }
            ],
            "reasoning": {"effort": os.environ.get("TRANSLATE_EFFORT", "low")},
            "text": {"format": {"type": "json_schema", "name": "page_text_translation", "schema": TEXT_OUTPUT_SCHEMA, "strict": True}},
            "max_output_tokens": 8000,
            "store": False,
        }
        try:
            res = httpx.post("https://api.openai.com/v1/responses", json=body, headers={"authorization": f"Bearer {self.api_key}"}, timeout=self.timeout)
        except httpx.HTTPError as e:
            return TranslationReply(engine=self.model, error=f"upstream:{type(e).__name__}")
        if res.status_code != 200:
            return TranslationReply(engine=self.model, error=f"http_{res.status_code}")
        payload = res.json()
        text = ""
        for o in payload.get("output", []):
            if o.get("type") != "message":
                continue
            for c in o.get("content", []):
                if c.get("type") == "refusal":
                    return TranslationReply(engine=self.model, error="refused")
                if c.get("type") == "output_text":
                    text = c.get("text", "")
        try:
            parsed = json.loads(text)
        except ValueError:
            return TranslationReply(engine=self.model, error="bad_output")
        return parse_reply(parsed, str(payload.get("model") or self.model))
