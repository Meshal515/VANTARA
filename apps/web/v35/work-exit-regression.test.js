import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Exit correctness is about preserving the work's *rendered state* until fade
// completion, not merely matching a 400ms duration.
const source = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');

describe('Back from manga/anime/cinema', () => {
  it('keeps all four manga depth looks active on the outgoing frame', () => {
    const css = source('./manga.css');
    const selector = "#detail.mw:is(.active,.page-out)[data-scroll-depth='on']";
    expect(css.split(selector).length - 1).toBeGreaterThanOrEqual(8);
    expect(css).not.toContain("#detail.mw.active[data-scroll-depth='on']");
    const motion = source('./manga-work.js');
    expect(motion).toContain("if (page.classList.contains('page-out')) return;");
  });

  it('does not switch the cinema header from fixed to sticky during fade', () => {
    expect(source('./cinema.css')).toContain("#cinema:is(.active,.page-out) .cn-detail-bar");
  });

  it('invalidates cinema metadata fetches when leaving a work', () => {
    const shell = source('./shell.js');
    const cinema = source('./cinema.js');
    expect(shell).toContain("if (from === 'cinema' && id !== 'cinema') cinema.leaveDetail()");
    expect(cinema).toContain("leaveDetail: () => { state.token++; }");
    expect(cinema).toContain("if (token !== state.token) return;");
  });

  it('does not rebuild a hidden manga detail on late chapter updates', () => {
    const shell = source('./shell.js');
    expect(shell).toContain("if (state.current?.id !== work.id || currentPage() !== 'detail') return;");
  });

  it('keeps the destination dock hidden until the outgoing frame releases', () => {
    expect(source('./core.css')).toMatch(/:has\(#detail\.page-out, #anime\.page-out, #cinema\.page-out, \.uv-page\) \.dock/);
  });

  it('defers expensive Home rebuilds until the outgoing work motion completes', () => {
    const shell = source('./shell.js');
    expect(shell).toContain("const deferHomePaint = id === 'home'");
    expect(shell).toContain('scrollTop: sourceScroll, onComplete: onWorkExit');
    expect(shell).toContain("if (id === 'detail') q('detailTop').classList.remove('collapsed')");
  });
});
