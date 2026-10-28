"""Fetch only pinned GitHub build artifacts; inspect, never execute provider code."""
import argparse,hashlib,json,re,urllib.request
from pathlib import Path
from package_gate import inspect_package

def probe(observations,fetch):
    commit=observations['buildsCommit']
    if not re.fullmatch('[0-9a-f]{40}',commit):raise ValueError('INVALID_COMMIT_PIN')
    prefix=f'https://raw.githubusercontent.com/Abodabodd/re-3arabi/{commit}/'
    reports=[]
    for package in observations['packages']:
        url=package['url']
        if not url.startswith(prefix) or not re.fullmatch('[A-Za-z0-9_.-]+\\.cs3',url[len(prefix):]):raise ValueError('UNTRUSTED_ARTIFACT_URL')
        blob=fetch(url)
        report=inspect_package(blob,expected_sha256=package['sha256'])
        if report['manifest']['version']!=package['version'] or report['bytes']!=package['bytes']:raise ValueError('PACKAGE_METADATA_MISMATCH')
        entry='L'+report['manifest']['pluginClassName'].replace('.','/')+';'
        for expected in package.get('expectedInheritedHostLookups',[]):
            if not any(row['kind']==expected['kind'] and row['reference']==entry+'->'+expected['member'] and expected['externalAncestor'] in row['externalAncestors'] for row in report['inheritedMemberLookups']):
                raise ValueError('ABI_LOOKUP_OBSERVATION_MISMATCH')
        reports.append({'name':package['name'],'inspectionPassed':True,'executionTested':False,**report})
    return reports

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--observations',default='docs/repository-compat/PACKAGE_OBSERVATIONS.json');parser.add_argument('--output',required=True);args=parser.parse_args()
    def fetch(url):
        with urllib.request.urlopen(url,timeout=20) as response:
            # Pin remains required even if GitHub uses a CDN redirect.
            return response.read(8*1024*1024+1)
    results=probe(json.loads(Path(args.observations).read_text()),fetch)
    Path(args.output).write_text(json.dumps(results,indent=2)+'\n')
    for r in results:print(r['manifest']['name'],r['sha256'],'format verified; provider execution NOT tested')
