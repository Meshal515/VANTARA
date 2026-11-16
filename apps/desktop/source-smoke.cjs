'use strict';
// وضع إثبات صريح (سطر أوامر فقط: --source-smoke-report=<ملف>): طلبات مصادر المانجا كما يطلبها ويندوز فعلًا، عبر
// خدمات VANTARA (Node ثم المتصفح المخفي عند صفحة تحقق). على آلة GitHub (عنوان مركز بيانات) ترد مواقع Madara بصفحة
// «One moment, please» وبعض المواقع بتحقق Cloudflare: هذا ما يثبت أن المتصفح المخفي يعبرها على ويندوز الحقيقي.
// لا يغيّر سلوك التطبيق العادي.
const fs = require('node:fs/promises');

const TARGETS = Object.freeze([
  { name: 'mangalek', url: 'https://mangalik.net/' },
  { name: 'mangaspark', url: 'https://sparkmanga.net/' },
  { name: 'mangastarz', url: 'https://starzmanga.net/' },
  { name: 'azora', url: 'https://azorafly.com/' },
  { name: 'teamx', url: 'https://olympustaff.com/' },
  { name: 'hijala', url: 'https://hijala.com/' },
  { name: 'mangadex-api', url: 'https://api.mangadex.org/manga?limit=1', json: true },
]);

async function runSourceSmoke({ services, reportPath }) {
  const rows = [];
  for (const target of TARGETS) {
    const started = Date.now();
    try {
      const out = await services.requestResource({ url: target.url, json: target.json === true, timeout: 60_000 });
      const text = String(out.text ?? '');
      const title = /<title>([^<]{0,80})/i.exec(text)?.[1]?.trim() ?? null;
      const challenged = /<title>\s*(?:just a moment|one moment|attention required)/i.test(text);
      rows.push({ ...target, ok: out.status >= 200 && out.status < 300 && !challenged, status: out.status, title, viaBrowser: out.viaBrowser === true, challenged, ms: Date.now() - started });
    } catch (error) {
      rows.push({ ...target, ok: false, error: String(error?.message ?? error).slice(0, 200), ms: Date.now() - started });
    }
  }
  const report = { passed: rows.filter((r) => r.ok).length, total: rows.length, rows };
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  return report;
}

module.exports = { runSourceSmoke, TARGETS };
