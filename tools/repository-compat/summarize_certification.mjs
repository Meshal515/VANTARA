#!/usr/bin/env node
/**
 * جدول اعتماد المصادر من سطور VANTARA_CERT (ملف أو مجلد ملفات cert.jsonl).
 * لكل مصدر: التغطية (مشهور/متوسط/نادر: وُجد ← اشتغل)، الاحتياط (أعمال فيها سيرفران جاهزان فأكثر)،
 * صدق «جاهز» (سيرفرات قيل إنها جاهزة ثم فشلت)، زمن أول إطار، والإطارات المفكوكة والساقطة.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(path) {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) => files(join(path, name))).filter((f) => f.endsWith('.jsonl'));
}

export function parse(text) {
  return text.split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

const tierCell = (t) => (t ? `${t.playable}/${t.found}` : '—');

export function verdict(s) {
  if (s.code) return `لم يكتمل: ${s.code}`;
  if (!s.worksTested) return 'لا أعمال في الكتالوج';
  if (s.falseReady > 0) return 'جاهز يكذب';
  const rate = s.worksPlayable / s.worksTested;
  if (rate >= 0.9 && s.worksWithBackup / s.worksTested >= 0.5) return 'معتمد';
  if (rate >= 0.6) return 'يعمل جزئيًا';
  return 'لا يعتمد';
}

export function table(records) {
  const sources = records.filter((r) => r.type === 'source');
  const lines = [
    '### اعتماد المصادر: 30 عملًا لكل مصدر (مشهور/متوسط/نادر) حتى أول إطار في المشغّل الأصلي',
    '',
    '| المصدر | النوع | الحكم | مشهور | متوسط | نادر | فيها احتياط | سيرفرات فُتحت | جاهز فشل | أول إطار (وسيط) | إطارات مفكوكة/ساقطة |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const s of sources.sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
    lines.push(`| ${s.name} | ${s.kind}/${s.content ?? '?'} | ${verdict(s)} | ${tierCell(s.tiers?.popular)} | ${tierCell(s.tiers?.mid)} | ${tierCell(s.tiers?.obscure)} | ${s.worksWithBackup ?? 0}/${s.worksTested ?? 0} | ${s.serversOpened ?? 0} | ${s.falseReady ?? 0}${s.falseReadyCodes?.length ? ` (${s.falseReadyCodes.join('، ')})` : ''} | ${s.ttffMedianMs > 0 ? `${(s.ttffMedianMs / 1000).toFixed(1)} ث` : '—'} | ${s.decodedFrames ?? 0}/${s.droppedFrames ?? 0} |`);
  }
  lines.push('', 'الخلية «اشتغل/وُجد». «جاهز فشل» = سيرفر عرضته ورقة السيرفرات جاهزًا ثم لم يصل لأول إطار أو توقف أو انتقل المشغّل لغيره. الإطارات الساقطة هنا من فك برمجي على المحاكي؛ السلاسة تُعتمد على جهاز فعلي.');
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2] ?? '.';
  const records = files(target).flatMap((f) => parse(readFileSync(f, 'utf8')));
  process.stdout.write(`${table(records)}\n`);
}
