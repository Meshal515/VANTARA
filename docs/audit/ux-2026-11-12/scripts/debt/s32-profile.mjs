// ملف معالج CDP لحظة الرجوع في الموحد: أثقل الدوال (self time) خلال 1.2 ثانية
import { launch, sleep } from '../harness.mjs';
const h = await launch({ section: 'anime', unified: true });
await sleep(4000);
await h.page.evaluate(() => window.__shell.openAnimeRef('anime:154587', { title: 'Frieren' }));
await sleep(5000);
const cdp = await h.page.context().newCDPSession(h.page);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
await h.page.evaluate(() => window.__shell.handleBack()); await sleep(1200);
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map(); const dt = profile.timeDeltas; 
profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log('total sampled ms', Math.round(total / 1000));
for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 16)) console.log(String(Math.round(us / 1000)).padStart(5), 'ms', k);
// المسؤول الأعلى (inclusive) من ملفات التطبيق
const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
const incl = new Map();
profile.samples.forEach((id, i) => { const seen = new Set(); let cur = id; while (cur) { const n = byId.get(cur); const u = n.callFrame.url; if (/\/v35\/|\/lib\//.test(u)) { const k = `${n.callFrame.functionName || '(anon)'} ${u.split('/').pop()}:${n.callFrame.lineNumber + 1}`; if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + (dt[i] || 0)); } } cur = parent.get(cur); } });
console.log('--- inclusive (app)');
for (const [k, us] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(String(Math.round(us / 1000)).padStart(5), 'ms', k);
await h.close();
