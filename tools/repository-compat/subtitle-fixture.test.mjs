import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const instrumentation = read('../../android/app/src/androidTest/java/com/vantara/addons/NativeAddonHttpPlaybackDeviceTest.kt');

test('the subtitle gate expects the cue of the very file it loads, at its own time', () => {
  // A phrase hard-coded in the test silently mismatched the fixture CI actually passes (run_app_integration.sh
  // serves another public VTT), so the gate failed with «No real external subtitle cue» while playback was fine.
  assert.doesNotMatch(instrumentation, /it\.text\.toString\(\)\.contains\("[^"]+"\)/, 'no hard-coded cue phrase');
  assert.match(instrumentation, /FirstCue\.of\(/, 'the expected cue is read from the loaded subtitle file');
  assert.match(instrumentation, /cueAt\.get\(\) in \(authored\.startMs - \d+\)\.\.\(authored\.endMs \+ \d+\)/, 'the cue must show inside its own time window');
});

test('every subtitle fixture the gate can load is pinned and has a first cue', () => {
  const asset = read('../../android/app/src/androidTest/assets/addon-http-proof.vtt');
  assert.match(asset, /^WEBVTT\s/m);
  assert.match(asset, /-->\s*[\d:.]+\s*\n\s*\S/, 'the authored asset has a cue with text');
  const ci = read('./run_app_integration.sh').match(/subtitle_fixture="([^"]+)"/)?.[1];
  assert.ok(ci, 'run_app_integration.sh names its subtitle fixture');
  assert.match(ci, /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\//, 'the CI fixture is pinned to a commit');
});
