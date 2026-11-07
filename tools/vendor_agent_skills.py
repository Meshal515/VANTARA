#!/usr/bin/env python3
"""Vendor unmodified, pinned MIT/Apache agent skills into VANTARA."""
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
SOURCE_BASE = BASE / ".claude/vendor/sources"
SKILL_BASE = BASE / ".claude/skills"
MANIFEST = json.loads((BASE / ".claude/vendor/manifest.json").read_text())
SECRET = re.compile(r"-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|sk-(proj-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]+")
UNSAFE_EXT = {".ttf", ".otf", ".woff", ".woff2", ".eot"}


def run(*command):
    result = subprocess.run(command, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT)
    if result.returncode != 0:
        raise RuntimeError("Git command failed: " + " ".join(command[:6]) +
                           "\n" + result.stdout[-2000:])
    return result.stdout.strip()


def copy_path(src, dest, skipped):
    if src.is_file():
        files = [src]
    elif src.is_dir():
        files = [f for f in src.rglob("*") if f.is_file() or f.is_symlink()]
    else:
        raise RuntimeError("Source path missing: " + str(src))
    for f in files:
        relative = f.relative_to(src) if src.is_dir() else None
        output = dest / relative if relative is not None else dest
        if f.is_symlink() or f.suffix.lower() in UNSAFE_EXT:
            skipped.append([str(f), "symlink or separately licensed font"])
            continue
        if f.stat().st_size > 24000000:
            skipped.append([str(f), "size above 24MB"])
            continue
        payload = f.read_bytes()
        try:
            content = payload.decode("utf-8")
        except UnicodeDecodeError:
            content = None
        if content and SECRET.search(content):
            skipped.append([str(f), "credential-shaped content"])
            continue
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, output)


def main():
    SOURCE_BASE.mkdir(parents=True, exist_ok=True)
    SKILL_BASE.mkdir(parents=True, exist_ok=True)
    installed, skipped, names = [], [], set()
    with tempfile.TemporaryDirectory(prefix="vantara-vendor-") as temp:
        for index, item in enumerate(MANIFEST["sources"]):
            print(str(index + 1) + "/" + str(len(MANIFEST["sources"])) +
                  " Fetching " + item["repo"], flush=True)
            repo = item["repo"]
            owner, project = repo.split("/")
            local = Path(temp) / str(index)
            local.mkdir()
            run("git", "init", "-q", str(local))
            run("git", "-C", str(local), "remote", "add", "origin",
                "https://github.com/" + repo + ".git")
            run("git", "-C", str(local), "sparse-checkout", "set", "--cone",
                *item["roots"])
            run("git", "-C", str(local), "-c", "protocol.version=2",
                "fetch", "--quiet", "--depth=1", "--filter=blob:none",
                "origin", item["sha"])
            run("git", "-C", str(local), "checkout", "-q", "--detach", "FETCH_HEAD")
            if run("git", "-C", str(local), "rev-parse", "HEAD") != item["sha"]:
                raise RuntimeError("Pinned SHA mismatch for " + repo)

            license_path = local / item.get("license_file", "LICENSE")
            if item["license"] != "skill-MIT":
                if not license_path.is_file():
                    raise RuntimeError("Missing root or skill LICENSE: " + repo)
                license_text = license_path.read_text(errors="replace")
                if item["license"] == "MIT":
                    if "MIT License" not in license_text and "Permission is hereby granted" not in license_text:
                        raise RuntimeError("MIT not confirmed " + repo)
                elif "Apache License" not in license_text or "Version 2.0" not in license_text:
                    raise RuntimeError("Apache-2.0 not confirmed " + repo)

            target = SOURCE_BASE / owner / project
            if target.exists():
                shutil.rmtree(target)
            target.mkdir(parents=True)
            if license_path.is_file():
                copy_path(license_path, target / license_path.name, skipped)
            for notice in ("NOTICE", "NOTICE.md", "NOTICE.txt"):
                if (local / notice).is_file():
                    copy_path(local / notice, target / notice, skipped)
            for path in item["roots"]:
                copy_path(local / path, target / path, skipped)

            files = {}
            for pattern in item["patterns"]:
                for file in local.glob(pattern):
                    if file.is_file() and file.name == "SKILL.md":
                        files[str(file.relative_to(local))] = file
            if not files:
                raise RuntimeError("No SKILL.md files for " + repo)
            for relative in sorted(files):
                copied = target / relative
                if not copied.exists():
                    raise RuntimeError("Blocked original SKILL.md for " + repo + "/" + relative)
                original = copied.read_text(encoding="utf-8")
                if item["license"] == "skill-MIT":
                    if not re.search(r"(?m)^license:\s*['\"]?MIT['\"]?\s*$", original[:1600]):
                        raise RuntimeError("Skill MIT declaration missing: " + repo + "/" + relative)
                leaf = Path(relative).parent.name
                digest = hashlib.sha256((repo + "/" + relative).encode()).hexdigest()[:7]
                safe = re.sub(r"[^a-z0-9-]", "-", (owner + "-" + project + "-" + leaf).lower())
                skill_id = "ext-" + safe[:51].rstrip("-") + "-" + digest
                if skill_id in names:
                    raise RuntimeError("Duplicate skill id " + skill_id)
                names.add(skill_id)
                wrapper = SKILL_BASE / skill_id / "SKILL.md"
                wrapper.parent.mkdir(parents=True, exist_ok=True)
                canonical = ".claude/vendor/sources/" + repo + "/" + relative
                contents = (
                    "---\nname: " + skill_id + "\ndescription: \"Original upstream " +
                    leaf.replace('"', "")[:60] + " skill from " + repo +
                    " for related product engineering and design tasks.\"\n---\n" +
                    "# Upstream skill: " + leaf + "\n\n" +
                    "Open and read the complete original SKILL.md at " + canonical +
                    " before carrying out the task. Resolve all resource links relative " +
                    "to its original location. VANTARA CLAUDE.md and owner instructions " +
                    "take precedence. Source scripts, external downloads, telemetry, " +
                    "deployment and CLIs must not be executed without review and approval.\n\n" +
                    "Source: https://github.com/" + repo + "/blob/" +
                    item["sha"] + "/" + relative + "\n"
                )
                wrapper.write_text(contents, encoding="utf-8")
            installed.append({
                "repo": repo, "sha": item["sha"], "license": item["license"],
                "skill_count": len(files), "original_skill_paths": sorted(files)
            })
            print("  Found " + str(len(files)) + " skill packages", flush=True)

    total = sum(x["skill_count"] for x in installed)
    if total < 200:
        raise RuntimeError("Unexpectedly few skills: " + str(total))
    report = {
        "state": "original_skill_packages_copied",
        "upstream_skill_count": total,
        "repositories": installed,
        "skipped_files": skipped,
        "cli_runtimes_installed": False,
        "upstream_scripts_executed": False
    }
    (BASE / ".claude/vendor/installation-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (BASE / ".claude/vendor/README.md").write_text(
        "# Original third-party skills for VANTARA\n\n" +
        "Installed " + str(total) + " original SKILL.md packages from " +
        str(len(installed)) + " pinned repositories.\n\n" +
        "Original source and supporting files: .claude/vendor/sources/\n\n" +
        "Claude discovery entrypoints: .claude/skills/ext-*/SKILL.md\n\n" +
        "All license and notice files are retained. Check installation-report.json " +
        "and manifest.json for the upstream source SHA, license and any skipped assets.\n\n" +
        "Only source files were copied. gstack, Playwright and other CLIs require " +
        "separate runtime setup, and upstream scripts were NOT executed.\n",
        encoding="utf-8")
    print("COMPLETE: " + str(total) + " upstream skill packages", flush=True)


if __name__ == "__main__":
    main()
