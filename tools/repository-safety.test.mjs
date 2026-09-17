import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(path) {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function trackedFiles() {
  const output = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).trim();
  return output ? output.split('\n') : [];
}

function isForbiddenEnv(path) {
  const base = path.split('/').at(-1) ?? '';
  return base.startsWith('.env') && !base.endsWith('.example');
}

function assertCiGatedProductionWorkflow(path) {
  const workflow = read(path);
  assert.match(workflow, /workflow_run\s*:/m, `${path} must be triggered by completed CI, not directly by a branch push`);
  assert.match(workflow, /workflows:\s*\[['"]VANTARA CI['"]\]/m, `${path} must depend on the VANTARA CI workflow`);
  assert.match(workflow, /types:\s*\[completed\]/m, `${path} must wait for CI completion`);
  assert.match(workflow, /workflow_run\.conclusion\s*==\s*['"]success['"]/m, `${path} must require successful CI`);
  assert.match(workflow, /workflow_run\.head_branch\s*==\s*['"]main['"]/m, `${path} must only deploy a main CI run`);
  assert.match(workflow, /workflow_run\.head_sha/m, `${path} must deploy the exact commit that CI tested`);
  assert.doesNotMatch(workflow, /^\s*push\s*:/m, `${path} must not deploy directly on push`);
  assert.doesNotMatch(workflow, /workflow_dispatch\s*:/m, `${path} must not allow a feature-branch copy to be manually dispatched with production secrets`);
}

test('tracked repository contains no local env files or Python caches', () => {
  const tracked = trackedFiles();
  const forbidden = tracked.filter(
    (path) => isForbiddenEnv(path) || /(^|\/)__pycache__(\/|$)/.test(path) || /\.py[co]$/.test(path),
  );
  assert.deepEqual(forbidden, [], `forbidden tracked files:\n${forbidden.join('\n')}`);
});

test('root ignore rules prevent local env and Python cache files from returning', () => {
  const ignore = read('.gitignore');
  assert.match(ignore, /^\.env$/m, 'root .gitignore must ignore .env');
  assert.match(ignore, /^\.env\.\*$/m, 'root .gitignore must ignore .env.* variants');
  assert.match(ignore, /^!\.env\.example$/m, 'root .gitignore must keep .env.example trackable');
  assert.match(ignore, /^\*\.py\[cod\]$/m, 'root .gitignore must ignore compiled Python files');
  assert.match(ignore, /^\*\*\/__pycache__\/$/m, 'root .gitignore must ignore Python cache directories');
});

test('sync worker production deploy is CI-gated and main-only', () => {
  assertCiGatedProductionWorkflow('.github/workflows/sync-worker.yml');
});

test('Cloudflare Pages production deploy is CI-gated and main-only', () => {
  const workflow = read('.github/workflows/cloudflare-pages.yml');
  assertCiGatedProductionWorkflow('.github/workflows/cloudflare-pages.yml');
  assert.match(workflow, /^\s*CF_PRODUCTION_BRANCH:\s*main\s*$/m, 'Pages production branch must be explicit');
  assert.match(workflow, /--branch="\$CF_PRODUCTION_BRANCH"/m, 'Pages deploy must always identify the production branch explicitly');
  assert.doesNotMatch(workflow, /GITHUB_REF_NAME[^\n]*CF_PRODUCTION_BRANCH|branch="\$\{GITHUB_REF_NAME\}"/m, 'Pages deploy must not derive its deployment branch from an arbitrary pushed branch');
});

test('signed Android release workflow is tag-only and rejects tags outside main', () => {
  const workflow = read('.github/workflows/android-release.yml');
  assert.match(workflow, /push:\s*\n\s+tags:\s*\n\s+- ['"]v\*['"]/m, 'Android release must be tag-triggered');
  assert.doesNotMatch(workflow, /workflow_dispatch\s*:/m, 'signed release must not be manually dispatchable from a feature branch');
  assert.match(workflow, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/m, 'release must prove its tagged commit belongs to main before reading signing secrets');
});
