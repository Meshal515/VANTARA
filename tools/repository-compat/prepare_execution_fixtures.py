"""Prepare hash-pinned external DEX for isolated offline tests; never execute or contact source sites."""
import argparse, hashlib, io, json, urllib.request, zipfile
from pathlib import Path
from probe_pinned_packages import probe

def prepare(observations, fetch, destination):
    blobs = {}
    def remember(url):
        blob = fetch(url)
        blobs[url] = blob
        return blob
    reports = probe(observations, remember)  # Full bounded archive/DEX/hash gate before any extraction.
    rows = []
    for package, report in zip(observations['packages'], reports):
        with zipfile.ZipFile(io.BytesIO(blobs[package['url']])) as archive:
            dex_names = [name for name in archive.namelist() if name.startswith('classes') and name.endswith('.dex')]
            if dex_names != ['classes.dex']:
                raise ValueError('EXECUTION_FIXTURE_REQUIRES_SINGLE_DEX')
            if report['manifest'].get('requiresResources'):
                raise ValueError('RESOURCE_PROFILE_UNSUPPORTED')
            raw = archive.read('classes.dex')
        rows.append((package['internalName'], raw, {
            'name': package['internalName'], 'packageSha256': package['sha256'],
            'dexSha256': hashlib.sha256(raw).hexdigest(),
            'entry': report['manifest']['pluginClassName'],
            'sourceTrafficAllowed': False, 'sourceFunctionsTested': False,
        }))
    # Only after every package passes validation is a runnable test asset produced.
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    for name, raw, metadata in rows:
        (destination / (name + '.dex')).write_bytes(raw)
        (destination / (name + '.json')).write_text(json.dumps(metadata, indent=2) + '\n')
    return len(rows)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--observations', default='docs/repository-compat/PACKAGE_OBSERVATIONS.json')
    parser.add_argument('--output', required=True)
    parser.add_argument('--local-cache')
    args = parser.parse_args()
    def fetch(url):
        if args.local_cache:
            return (Path(args.local_cache) / url.rsplit('/', 1)[1]).read_bytes()
        with urllib.request.urlopen(url, timeout=20) as response:
            return response.read(8*1024*1024+1)
    count = prepare(json.loads(Path(args.observations).read_text()), fetch, args.output)
    print(f'{count} pinned external packages prepared for isolated offline execution; no source-site requests')
