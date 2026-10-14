const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { assetPath, isAppFrame, configuredAddonUrl } = require('./security.cjs');

test('local assets keep their fixed app origin and cannot read outside the bundle', () => {
  const root = path.resolve('/tmp/vantara-assets');
  assert.equal(assetPath(root, 'vantara://app/desktop/index.html'), path.join(root, 'desktop/index.html'));
  assert.equal(assetPath(root, 'vantara://app/'), path.join(root, 'desktop/index.html'));
  for (const url of ['file:///etc/passwd', 'vantara://other/app.js', 'vantara://app/%2e%2e%2fsecret', 'vantara://app/%5c..%5csecret', 'vantara://app/%00x']) {
    assert.throws(() => assetPath(root, url));
  }
});

test('only the local app frame receives native IPC access', () => {
  assert.equal(isAppFrame('vantara://app/desktop/index.html'), true);
  assert.equal(isAppFrame('vantara://app/index.html'), true);
  for (const url of ['https://app/', 'vantara://app.evil/', 'vantara://remote/', 'about:blank', null]) assert.equal(isAppFrame(url), false);
});

test('configured Stremio links retain their exact parameters and reject non-manifests', () => {
  assert.equal(configuredAddonUrl('stremio://torrentio.strem.fun/providers=one%2Ctwo/manifest.json?key=abc%2Bdef'), 'https://torrentio.strem.fun/providers=one%2Ctwo/manifest.json?key=abc%2Bdef');
  for (const url of ['stremio://127.0.0.1/manifest.json', 'stremio://localhost/manifest.json', 'stremio://user:pass@addon.example/manifest.json', 'stremio://addon.example/configure', 'javascript:alert(1)']) assert.throws(() => configuredAddonUrl(url));
});
