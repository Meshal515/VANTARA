#!/usr/bin/env python3
"""Decode check for every link the CloudStream reference extracted (measurement plan: "works" = ffprobe sees a
video frame, with the headers the engine gave, within 20 s). Writes verdicts.json and a Markdown summary.

The same checker is meant for VANTARA's links, so both sides are judged by one definition.
Header values stay in the CI artifact; the summary prints only hosts, counts and reasons.

usage: probe_links.py <reference-out dir> [--no-probe]
"""
import json
import pathlib
import re
import subprocess
import sys
import time
from urllib.parse import urlsplit

TIMEOUT_S = 20
NOT_PROBED = {"TORRENT", "MAGNET", "DASH"}


def probe_cmd(link):
    headers = dict(link.get("headers") or {})
    if link.get("referer"):
        headers.setdefault("Referer", link["referer"])
    ua = headers.pop("User-Agent", headers.pop("user-agent", None))
    cmd = ["ffprobe", "-v", "error", "-rw_timeout", str(15 * 1_000_000),
           "-protocol_whitelist", "file,http,https,tcp,tls,crypto,data"]
    if ua:
        cmd += ["-user_agent", ua]
    if headers:
        cmd += ["-headers", "".join(f"{k}: {v}\r\n" for k, v in headers.items())]
    cmd += ["-select_streams", "v:0", "-read_intervals", "%+#1",
            "-show_entries", "frame=pict_type:format=duration", "-of", "json", link["url"]]
    return cmd


def judge(output, code):
    if code != 0:
        return False, "ffprobe exit %d" % code
    try:
        data = json.loads(output or "{}")
    except json.JSONDecodeError:
        return False, "unreadable ffprobe output"
    if not data.get("frames"):
        return False, "no video frame"
    return True, None


def probe(link, run=subprocess.run):
    if str(link.get("type", "")).upper() in NOT_PROBED or not str(link.get("url", "")).startswith("http"):
        return {"ok": None, "reason": "not probed (%s)" % link.get("type")}
    age = None if link.get("at") is None else round(time.time() - link["at"] / 1000)
    t0 = time.time()
    try:
        r = run(probe_cmd(link), capture_output=True, text=True, timeout=TIMEOUT_S)
        ok, reason = judge(r.stdout, r.returncode)
        if not ok and r.stderr:
            # ffprobe prints the URL (with its tokens) in errors: only the error text, never the link
            last = re.sub(r"\S+://\S+", "", r.stderr.strip().splitlines()[-1]).strip(" :")
            reason = "%s: %s" % (reason, last[:120]) if last else reason
    except subprocess.TimeoutExpired:
        ok, reason = False, "TIMEOUT %ds" % TIMEOUT_S
    return {"ok": ok, "reason": reason, "ms": round((time.time() - t0) * 1000), "ageS": age}


def host(url):
    return (urlsplit(url).hostname or "?").lower()


def links_of(episode):
    for e in episode.get("embeds", []):
        for link in e.get("links", []):
            yield e["embed"], link
    for link in episode.get("direct", []):
        yield "direct:" + host(link["url"]), link


def summarize(reports):
    lines = ["## مرجع CloudStream — جولة", "",
             "| الإضافة | حُمّلت | أعمال حُمّلت | حلقات | سيرفرات (embed) | سيرفرات أعطت رابطًا | روابط | يُفك | لا يُفك | لم يُفحص |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    reasons = {}
    for r in reports:
        works = [w for p in r.get("providers", []) for w in p.get("works", [])]
        eps = [e for w in works for e in w.get("episodes", [])]
        embeds = [e for ep in eps for e in ep.get("embeds", [])]
        links = [l for ep in eps for _, l in links_of(ep)]
        ok = sum(1 for l in links if (l.get("probe") or {}).get("ok") is True)
        bad = [l for l in links if (l.get("probe") or {}).get("ok") is False]
        skipped = sum(1 for l in links if (l.get("probe") or {}).get("ok") is None)
        for l in bad:
            key = "%s · %s" % (host(l["url"]), (l["probe"].get("reason") or "?")[:80])
            reasons[key] = reasons.get(key, 0) + 1
        lines.append("| %s | %s | %d/%d | %d | %d | %d | %d | %d | %d | %d |" % (
            r.get("plugin"), "نعم" if r.get("loaded") else "لا — %s" % (r.get("error") or "?")[:60],
            sum(1 for w in works if not w.get("loadError")), len(works), len(eps), len(embeds),
            sum(1 for e in embeds if e.get("links")), len(links), ok, len(bad), skipped))
    # Evidence for VANTARA's header policy on redirects/CDNs (it scopes Cookie/Authorization and a Referer with a query
    # to the media origin): how many reference links need them, and how many of those decode.
    all_links = [l for r in reports for p in r.get("providers", []) for w in p.get("works", []) for ep in w.get("episodes", []) for _, l in links_of(ep)]
    def need(l, names):
        return any(k.lower() in names for k in (l.get("headers") or {}))
    creds = [l for l in all_links if need(l, {"cookie", "authorization"})]
    query_ref = [l for l in all_links if "?" in str(l.get("referer") or (l.get("headers") or {}).get("Referer") or "")]
    ok = lambda ls: sum(1 for l in ls if (l.get("probe") or {}).get("ok") is True)
    lines += ["", "**ترويسات الروابط (دليل لسياسة فانتارا عند التحويل):** "
              "Cookie/Authorization في %d رابطًا (يُفك منها %d) · Referer باستعلام في %d (يُفك منها %d)" % (len(creds), ok(creds), len(query_ref), ok(query_ref))]
    if reasons:
        lines += ["", "**أسباب عدم الفك (المضيف · السبب):**", ""]
        lines += ["- %s × %d" % (k, v) for k, v in sorted(reasons.items(), key=lambda kv: -kv[1])[:20]]
    lines += ["", "> المرجع على شبكة نظيفة. «يُفك» = ffprobe رأى إطار فيديو بترويسات المستخرج. هذه معايرة: لا حكم على فانتارا."]
    return "\n".join(lines)


def probe_episode(path):
    """Live mode: called by run_reference.sh as each episode file arrives; writes <file>.probed.json."""
    episode = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    results = {link["url"]: probe(link) for _, link in links_of(episode) if link.get("url")}
    target = pathlib.Path(str(path) + ".probed.json")
    tmp = target.with_suffix(".tmp")
    tmp.write_text(json.dumps(results), encoding="utf-8")
    tmp.replace(target)  # atomic: the summary never reads half a file


def main():
    if sys.argv[1] == "--episode":
        return probe_episode(sys.argv[2])
    root = pathlib.Path(sys.argv[1])
    run_probe = "--no-probe" not in sys.argv
    live = {}
    for f in root.glob("*.probed.json"):
        live.update(json.loads(f.read_text(encoding="utf-8")))
    reports = []
    for f in sorted(root.glob("*.json")):
        if f.name == "verdicts.json" or f.name == "run.json" or ".ep" in f.name:
            continue
        r = json.loads(f.read_text(encoding="utf-8"))
        if run_probe:
            for p in r.get("providers", []):
                for w in p.get("works", []):
                    for ep in w.get("episodes", []):
                        for _, link in links_of(ep):
                            # checked within seconds of extraction when the live probe saw it; else now, marked late
                            link["probe"] = live.get(link.get("url")) or dict(probe(link), late=True)
        reports.append(r)
    (root / "verdicts.json").write_text(json.dumps(reports, ensure_ascii=False, indent=1), encoding="utf-8")
    print(summarize(reports))


if __name__ == "__main__":
    main()
