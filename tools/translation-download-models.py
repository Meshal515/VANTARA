#!/usr/bin/env python3
"""Download the APK's pinned original models for native runtime verification."""
import concurrent.futures
import hashlib
import pathlib
import re
import sys
import urllib.request

repo = pathlib.Path(__file__).resolve().parent.parent
root = pathlib.Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
source = (repo / 'android/app/src/main/kotlin/com/vantara/plugins/translation/ModelStore.kt').read_text()
models = re.findall(r'Spec\("([^\"]+)", "([^\"]+)",\s*"([a-f0-9]{64})", "([^\"]+)", ([0-9_]+)', source)
assert len(models) == 6, 'Pinned model schema changed: review the verification downloader'


def download(item):
    name, url, sha, filename, size = item
    assert pathlib.Path(filename).name == filename
    size = int(size.replace('_', ''))
    target = root / filename
    if target.exists() and target.stat().st_size == size and hashlib.sha256(target.read_bytes()).hexdigest() == sha:
        return name + ' cached and verified'
    temporary = target.with_suffix('.download')
    digest = hashlib.sha256()
    written = 0
    with urllib.request.urlopen(url.replace('$HF', 'https://huggingface.co'), timeout=120) as response, temporary.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
            digest.update(chunk)
            written += len(chunk)
    assert written == size and digest.hexdigest() == sha, name + ' hash/size mismatch'
    temporary.replace(target)
    return name + ' verified ' + str(written)


with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    for future in concurrent.futures.as_completed([pool.submit(download, model) for model in models]):
        print(future.result(), flush=True)  # Any failed verification fails CI.
(root / 'version').write_text(re.search(r'const val VERSION = "([^"]+)"', source).group(1) + '\n')
