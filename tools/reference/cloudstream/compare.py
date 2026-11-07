#!/usr/bin/env python3
"""Reference comparison (measurement plan, phase 1, small): the original CloudStream vs VANTARA on the same .cs3 and
the same episodes, server by server, judged by one checker (ffprobe, probe_links.py).

  compare.py plan <reference-out> <certification-sources.txt>   -> prints ref-episodes.json for VANTARA's run
  compare.py judge <reference-out> <vantara-out>                 -> verdicts + Markdown summary

Units: each server page (embed) a provider handed to an extractor, keyed by host+path; links the provider produced
itself are one unit per media host. Verdicts (only these): PASS, VANTARA_FAULT, VANTARA_BETTER, BOTH_FAIL,
INCONCLUSIVE, NOT_RUN, NOT_COMPARABLE. A single round with no repetition is labelled preliminary.
"""
import json
import pathlib
import sys
from urllib.parse import urlsplit

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import probe_links  # noqa: E402

VERDICTS = ["PASS", "VANTARA_FAULT", "VANTARA_BETTER", "BOTH_FAIL", "INCONCLUSIVE", "NOT_RUN", "NOT_COMPARABLE"]
AR = {"PASS": "ناجح", "VANTARA_FAULT": "عطل فانتارا", "VANTARA_BETTER": "فانتارا أفضل", "BOTH_FAIL": "يفشل في الاثنين",
      "INCONCLUSIVE": "غير حاسم", "NOT_RUN": "لم يُنفّذ", "NOT_COMPARABLE": "غير قابل للمقارنة"}


def unit_key(embed=None, link_url=None):
    if embed:
        u = urlsplit(embed)
        return "embed:%s%s" % ((u.hostname or "?").lower().removeprefix("www."), u.path.rstrip("/"))
    return "direct:%s" % (urlsplit(link_url).hostname or "?").lower()


def units(episode):
    """{key: {"links": [...], "reason": str|None}} for one episode, in the reference's shape."""
    out = {}
    for e in episode.get("embeds", []):
        u = out.setdefault(unit_key(embed=e["embed"]), {"links": [], "reason": None})
        u["links"] += e.get("links", [])
        u["reason"] = u["reason"] or e.get("reason")
    for link in episode.get("direct", []):
        out.setdefault(unit_key(link_url=link["url"]), {"links": [], "reason": None})["links"].append(link)
    return out


def status(unit):
    """ok | fail | inconclusive, with the reason a fault report needs."""
    if unit is None:
        return "missing", "السيرفر لم يظهر"
    links = unit["links"]
    if not links:
        return "fail", unit.get("reason") or "لا رابط"
    probes = [(l.get("probe") or {}).get("ok") for l in links]
    if any(p is True for p in probes):
        return "ok", None
    if all(p is None for p in probes):
        return "inconclusive", "لم يُفحص"
    reasons = [(l.get("probe") or {}).get("reason") for l in links if (l.get("probe") or {}).get("ok") is False]
    return "fail", "لا يُفك: %s" % (reasons[0] if reasons else "?")


def verdict(ref, van):
    r, _ = status(ref)
    v, why = status(van)
    if r == "inconclusive":
        return "INCONCLUSIVE", "المرجع لم يُفحص"
    if r == "ok":
        return ("PASS", None) if v == "ok" else ("VANTARA_FAULT", why)
    return ("VANTARA_BETTER", None) if v == "ok" else ("BOTH_FAIL", None)


def episodes_of(report):
    for p in report.get("providers", []):
        for w in p.get("works", []):
            for ep in w.get("episodes", []):
                yield w.get("title"), ep


def plan(ref_dir, sources_file):
    content = {}
    for line in pathlib.Path(sources_file).read_text(encoding="utf-8").splitlines():
        parts = line.strip().split(":")
        if len(parts) == 3 and parts[0] == "cs3":
            content[parts[1]] = parts[2]
    run = json.loads((ref_dir / "run.json").read_text(encoding="utf-8"))
    sha = {p["name"]: p.get("sha256") for p in run.get("plugins", [])}
    out = []
    for report in json.loads((ref_dir / "verdicts.json").read_text(encoding="utf-8")):
        name = report["plugin"].replace("_", " ")
        eps = [{"data": ep["data"], "label": ep.get("label")} for _, ep in episodes_of(report) if ep.get("data")]
        out.append({"name": name, "content": content.get(name, "anime"), "sha256": sha.get(name), "episodes": eps})
    return {"plugins": out}


def load_vantara(van_dir):
    live = {}
    for f in van_dir.glob("*.probed.json"):
        live.update(json.loads(f.read_text(encoding="utf-8")))
    plugins = {}
    for f in sorted(van_dir.glob("*.vantara.json")):
        s = json.loads(f.read_text(encoding="utf-8"))
        plugins[s["plugin"]] = {"summary": s, "episodes": {}}
    for f in sorted(van_dir.glob("*.vep*.json")):
        if f.name.endswith(".probed.json"):
            continue
        ep = json.loads(f.read_text(encoding="utf-8"))
        name = f.name.split(".vep")[0]
        for _, link in probe_links.links_of(ep):
            link["probe"] = live.get(link.get("url")) or dict(probe_links.probe(link), late=True)
        plugins.setdefault(name, {"summary": {}, "episodes": {}})["episodes"][ep["data"]] = ep
    return plugins


def judge(ref_reports, van):
    rows = []
    for report in ref_reports:
        name = report["plugin"].replace("_", " ")
        v = van.get(name, {"summary": {}, "episodes": {}})
        comparable = v["summary"].get("comparable", True)
        for title, ep in episodes_of(report):
            vep = v["episodes"].get(ep.get("data"))
            ref_units = units(ep)
            van_units = units(vep) if vep else {}
            for key in sorted(set(ref_units) | set(van_units)):
                if not comparable:
                    verdict_, why = "NOT_COMPARABLE", "حزمة غير الحزمة المرجعية"
                elif vep is None:
                    verdict_, why = "NOT_RUN", v["summary"].get("error") or "الحلقة لم تُشغَّل في فانتارا"
                else:
                    verdict_, why = verdict(ref_units.get(key), van_units.get(key))
                rows.append({"plugin": name, "work": title, "data": ep.get("data"), "unit": key, "verdict": verdict_, "why": why,
                             "dropped": len((vep or {}).get("dropped", []))})
    return rows


def summarize(rows, van):
    lines = ["## المقارنة: CloudStream الأصلي مقابل فانتارا (جولة واحدة بلا تكرار: أولية)", "",
             "| الإضافة | " + " | ".join(AR[v] for v in VERDICTS) + " |", "|---|" + "---|" * len(VERDICTS)]
    for name in sorted({r["plugin"] for r in rows}):
        mine = [r for r in rows if r["plugin"] == name]
        lines.append("| %s | %s |" % (name, " | ".join(str(sum(1 for r in mine if r["verdict"] == v)) for v in VERDICTS)))
    faults = {}
    for r in rows:
        if r["verdict"] == "VANTARA_FAULT":
            key = "%s · %s · %s" % (r["plugin"], r["unit"].split("/")[0], (r["why"] or "?")[:90])
            faults[key] = faults.get(key, 0) + 1
    if faults:
        lines += ["", "**أعطال فانتارا (الإضافة · السيرفر · السبب):**", ""]
        lines += ["- %s × %d" % (k, n) for k, n in sorted(faults.items(), key=lambda kv: -kv[1])[:25]]
    dropped = {}
    for name, v in van.items():
        for ep in v["episodes"].values():
            for d in ep.get("dropped", []):
                k = "%s · %s:%s" % (d.get("host"), d.get("scheme"), d.get("port"))
                dropped[k] = dropped.get(k, 0) + 1
    if dropped:
        lines += ["", "**روابط أسقطها فانتارا قبل الورقة (المضيف · المخطط:المنفذ):**", ""]
        lines += ["- %s × %d" % (k, n) for k, n in sorted(dropped.items(), key=lambda kv: -kv[1])[:15]]
    lines += ["", "> «عطل فانتارا» = المرجع فكّ رابطًا من السيرفر وفانتارا لم يفعل، بالفاحص نفسه. جولة واحدة: يلزم التكرار قبل الحكم النهائي."]
    return "\n".join(lines)


def main():
    cmd = sys.argv[1]
    if cmd == "plan":
        print(json.dumps(plan(pathlib.Path(sys.argv[2]), sys.argv[3]), ensure_ascii=False))
    elif cmd == "judge":
        ref = json.loads((pathlib.Path(sys.argv[2]) / "verdicts.json").read_text(encoding="utf-8"))
        van_dir = pathlib.Path(sys.argv[3])
        van = load_vantara(van_dir)
        rows = judge(ref, van)
        (van_dir / "comparison.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
        print(summarize(rows, van))
        # A comparison that did not run is not a result: NOT_RUN or NOT_COMPARABLE fails the job (plan: must be 0).
        missing = [r for r in rows if r["verdict"] in ("NOT_RUN", "NOT_COMPARABLE")]
        if missing or not rows:
            print("\n::error::%d of %d cases were not run or not comparable" % (len(missing), len(rows)))
            sys.exit(1)


if __name__ == "__main__":
    main()
