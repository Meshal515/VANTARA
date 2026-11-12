import { launch, snap, sleep, instrument } from './harness.mjs';
const out = process.env.VANTARA_SHOTS ?? 'audit-shots';
import { mkdir } from 'node:fs/promises';
await mkdir(out, { recursive: true });
for (const [name, opts] of [['manga', { section: 'manga' }], ['anime', { section: 'anime' }], ['cinema', { section: 'cinema' }], ['unified', { unified: true }]]) {
  const h = await launch(opts);
  await instrument(h.page);
  await sleep(6000);
  await h.page.screenshot({ path: `${out}/boot-${name}.png` });
  const s = await snap(h.page);
  const cls = await h.page.evaluate(() => ({ cls: window.__cls, long: window.__long }));
  const hosts = {};
  for (const r of h.log.requests) { const k = new URL(r.u).host; hosts[k] = (hosts[k] || 0) + 1; }
  console.log(name, JSON.stringify(s), 'errors', h.log.errors.length, JSON.stringify(h.log.errors.slice(0, 4)));
  console.log('  console', JSON.stringify(h.log.console.slice(0, 6)));
  console.log('  hosts', JSON.stringify(hosts), 'failed', h.log.failed.length, JSON.stringify(h.log.failed.slice(0, 5)));
  console.log('  CLS total', cls.cls.reduce((a, b) => a + b.v, 0).toFixed(3), 'n', cls.cls.length, JSON.stringify(cls.cls.slice(0, 8)), 'long', JSON.stringify(cls.long.slice(0, 10)));
  await h.close();
}
