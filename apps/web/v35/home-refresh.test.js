import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// PF1/PF3: الرئيسية الظاهرة كانت تطلب «آخر التحديثات» من كل المصادر كل 60 ث، ومسح الفصول بمؤقت ثانٍ مستقل.
const shell = readFileSync(new URL('./shell.js', import.meta.url), 'utf8');

describe('manga home refresh pulse', () => {
  it('refreshes the visible home every 10 minutes, not every minute', () => {
    expect(shell).toContain('const HOME_REFRESH_MS = 10 * 60_000;');
    expect(shell).toMatch(/Date\.now\(\) - homeCheckedAt >= HOME_REFRESH_MS/);
    expect(shell).not.toMatch(/homeCheckedAt >= 60_000/);
  });
  it('runs the chapter sweep from the same pulse instead of a second interval', () => {
    expect(shell).not.toMatch(/setInterval\(\(\) => void sweepLatest\(\)/);
    const pulse = shell.slice(shell.indexOf('const refreshChapters = () => {'), shell.indexOf('const chapterRefreshTimer'));
    expect(pulse).toContain('void loadHome().finally(() => void sweepLatest())');
    expect(pulse).toContain('else void sweepLatest()');
  });
});

// RB1/RB2: تغيّر من المزامنة كان يعيد بناء ما تحت الإصبع (قائمة الفصول كلها، والرئيسية في الحال)
describe('sync changes do not rebuild what is under the finger', () => {
  const routing = shell.slice(shell.indexOf('const unsubscribe = sync.onChange'), shell.indexOf('/** زرّ الرجوع'));
  it('chapter marks patch the rendered rows instead of rebuilding the list', () => {
    expect(routing).toContain("tables.includes('chapter_marks') && currentPage() === 'detail' && state.current?._chapters) patchChapterMarks(state.current)");
    expect(routing).not.toMatch(/chapter_marks'\)[^\n]*renderChapters\(/);
    const patch = shell.slice(shell.indexOf('function patchChapterMarks(w) {'), shell.indexOf('// ── «علّم فصول»'));
    expect(patch).toContain('node._paintRead(read(node._chapterRow))');
    // «وصلت هنا» انتقل: إعادة بناء كاملة (الحالة النادرة)، وإلا لا replaceChildren
    expect(patch).toContain('!== state.chaptersPainted.nextKey) return renderChapters(w)');
    expect(patch).not.toContain('replaceChildren');
    expect(shell).toContain('row._paintRead = paint;');
    expect(shell).toMatch(/cell\._paintRead = \(value\) =>/);
  });
  it("a friend's reading repaints the home once, after touch and scroll go quiet", () => {
    expect(routing).toContain("tables.includes('work_views')) repaintHomeWhenIdle()");
    const idle = shell.slice(shell.indexOf('function repaintHomeWhenIdle() {'), shell.indexOf('/** بطاقة «مكتمل»'));
    expect(idle).toMatch(/if \(handsBusy\(\) \|\| motionActive\(q\('home'\)\)\) \{ homeRepaintTimer = setTimeout\(tick/);
    expect(idle).toContain('if (homeRepaintTimer) return;');
  });
});
