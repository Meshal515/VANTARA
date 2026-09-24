"""سطر الأوامر: تنزيل النماذج، ترجمة صفحات محليًّا، وإخراج العرض التشخيصي.

    python -m vantara_worker.cli models                 # ينزّل ويتحقق
    python -m vantara_worker.cli translate page.jpg ... --out out/ [--debug] [--translator none|openai|fake]
    python -m vantara_worker.cli serve --port 8765

`--translator fake --table table.json` يترجم من جدول ثابت (للقياس بلا مفتاح).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import cv2


def cmd_models(args: argparse.Namespace) -> int:
    from . import models

    names = models.CORE + (models.JAPANESE if args.japanese else ())
    for n in names:
        p = models.ensure(n)
        print(f"{n:18s} {models.SPECS[n].license:12s} {p}")
    return 0


def cmd_translate(args: argparse.Namespace) -> int:
    from .pipeline import Pipeline, encode_webp
    from .translate_client import FakeTranslator, NullTranslator, OpenAITranslator, PageMeta

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    if args.translator == "openai":
        translator = OpenAITranslator()
    elif args.translator == "fake":
        translator = FakeTranslator(json.loads(Path(args.table).read_text(encoding="utf-8")))
    else:
        translator = NullTranslator()
    pipe = Pipeline(japanese=args.lang == "ja")
    print(f"models loaded in {pipe.load_seconds:.1f}s", file=sys.stderr)
    for i, path in enumerate(args.pages):
        data = Path(path).read_bytes()
        t = time.time()
        meta = PageMeta(page_hash="", series_ref=args.series, series_title=args.series, page_index=i, source_lang=args.lang)
        res = pipe.run(data, meta, translator)
        stem = Path(path).stem
        (out / f"{stem}.webp").write_bytes(encode_webp(res.image))
        (out / f"{stem}.json").write_text(json.dumps(res.to_json(), ensure_ascii=False, indent=1), encoding="utf-8")
        if args.debug:
            rgb, _ = pipe.decode(data)
            dbg = pipe.debug_image(rgb, res)
            cv2.imwrite(str(out / f"{stem}.debug.jpg"), cv2.cvtColor(dbg, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 85])
        statuses = {}
        for r in res.regions:
            statuses[r.status] = statuses.get(r.status, 0) + 1
        print(f"{stem}: {time.time() - t:.1f}s regions={len(res.regions)} {statuses} timings={ {k: round(v, 1) for k, v in res.timings.items()} }")
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    from .server import build_app

    uvicorn.run(build_app(), host=args.host, port=args.port, log_level="info")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="vantara_worker")
    sub = p.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("models")
    m.add_argument("--japanese", action="store_true")
    m.set_defaults(fn=cmd_models)
    t = sub.add_parser("translate")
    t.add_argument("pages", nargs="+")
    t.add_argument("--out", default="out")
    t.add_argument("--debug", action="store_true")
    t.add_argument("--translator", choices=["none", "openai", "fake"], default="none")
    t.add_argument("--table", default=None)
    t.add_argument("--series", default="local")
    t.add_argument("--lang", default="en")
    t.set_defaults(fn=cmd_translate)
    s = sub.add_parser("serve")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8765)
    s.set_defaults(fn=cmd_serve)
    args = p.parse_args(argv)
    return int(args.fn(args))


if __name__ == "__main__":
    raise SystemExit(main())
