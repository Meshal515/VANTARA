import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

/**
 * خيط Capacitor واحد لكل الإضافات (Bridge.taskHandler «CapacitorPlugins»): أي نداء يقرأ القرص أو ينتظر عليه يؤخر كل
 * ما خلفه، ومنه `pick` و`play` عند ضغط سيرفر («يبدأ…» يبقى والمشغّل لا يُفتح). كتابة نسخة الحساب كاملة (تحليل JSON
 * ثم fsync) كانت تقع بعد 1.5 ث من آخر لمسة، أي وأنت تنتظر في ورقة السيرفرات، و`FollowTime.pending` ينتظر حتى ثانية.
 */
const root = fileURLToPath(new URL('../../../android/app/src/main/kotlin/', import.meta.url));
const source = (path) => readFileSync(root + path, 'utf8');
const body = (text, name) => {
  const at = text.search(new RegExp(`fun ${name}\\(call: PluginCall\\)`));
  expect(at, name).toBeGreaterThan(-1);
  return text.slice(at, at + 400);
};

it('نسخة الحساب تُقرأ وتُكتب على خيطها الخاص بالترتيب، لا على خيط Capacitor', () => {
  const text = source('com/vantara/plugins/AccountBackupPlugin.kt');
  expect(text).toMatch(/newSingleThreadExecutor/);
  for (const name of ['read', 'write']) expect(body(text, name)).toMatch(/^fun \w+\(call: PluginCall\) = io\.execute \{/);
});

it('وقت المتابعة يُقرأ ويُؤكَّد على طابور كتابته نفسه بلا drain على الخيط المشترك', () => {
  const text = source('com/vantara/usage/UsagePlugin.kt');
  for (const name of ['pending', 'acknowledge']) {
    const fn = body(text, name);
    expect(fn).toMatch(/io\.execute \{/);
    expect(fn).not.toMatch(/drain\(/);
  }
});

it('إغلاق الجلسة (إطلاق التورنت وحفظ الصحة) وصندوق المشغّل خارج خيط Capacitor', () => {
  const text = source('com/vantara/anime/bridge/AnimeEnginePlugin.kt');
  expect(body(text, 'closeSession')).toMatch(/= offBridge\(call\)/);
  expect(body(text, 'outbox')).toMatch(/= offBridge\(call\)/);
});
