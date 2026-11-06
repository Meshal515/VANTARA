import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('the real subtitle cue assertion matches the authored public CI fixture', () => {
  const fixture=readFileSync(new URL('../../android/app/src/androidTest/assets/addon-http-proof.vtt',import.meta.url),'utf8');
  const instrumentation=readFileSync(new URL('../../android/app/src/androidTest/java/com/vantara/addons/NativeAddonHttpPlaybackDeviceTest.kt',import.meta.url),'utf8');
  const expected=instrumentation.match(/it\.text\.toString\(\)\.contains\("([^"\n]+)"\)/)?.[1];
  assert.ok(expected,'the playback test must require its specific decoded subtitle cue');
  assert.match(fixture,/^WEBVTT\s/m);
  assert.ok(fixture.split(/\r?\n/).some(line=>!line.includes('-->')&&line.includes(expected)),
    'The Android player cannot emit a phrase absent from its pinned subtitle fixture');
});
