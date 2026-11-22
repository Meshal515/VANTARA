import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { hostServerSuggestion, renderLobby, serverKey } from './lobby.js';

const roster = [
  { userId: 'u-host', name: 'المضيف', host: true, state: 'ready', source: 'OKRU', server: 'anime4up|okru' },
  { userId: 'u-me', name: 'أنا', host: false, state: 'ready', source: 'Mega', server: 'anime4up|mega' },
];
const available = [{ id: 'r1', key: 'anime4up|mega', label: 'Mega' }, { id: 'r2', key: 'anime4up|okru', label: 'OKRU' }];

describe('host server suggestion (owner decision, 19 Nov)', () => {
  it('suggests the host server only when it is available here and differs from mine', () => {
    expect(hostServerSuggestion({ roster, me: 'u-me', mine: 'anime4up|mega', available })).toEqual({ key: 'anime4up|okru', id: 'r2', label: 'OKRU' });
    expect(hostServerSuggestion({ roster, me: 'u-me', mine: 'anime4up|okru', available })).toBeNull();
    expect(hostServerSuggestion({ roster, me: 'u-me', mine: 'anime4up|mega', available: available.slice(0, 1) })).toBeNull();
    expect(hostServerSuggestion({ roster, me: 'u-host', mine: 'anime4up|okru', available })).toBeNull();
    // «لا» مرة: لا يُعاد الاقتراح نفسه
    expect(hostServerSuggestion({ roster, me: 'u-me', mine: 'anime4up|mega', available, declined: ['anime4up|okru'] })).toBeNull();
  });

  it('server identity is the source id plus the server code, the same on every device', () => {
    expect(serverKey({ sourceId: 'anime4up', code: 'OKRU' })).toBe('anime4up|okru');
    expect(serverKey({ sourceId: 'anime4up', server: 'Mega' })).toBe('anime4up|mega');
    expect(serverKey({ code: 'OKRU' })).toBeNull();
  });

  it('the lobby shows a persistent yes/no notice; each answer calls its action', () => {
    const { document } = parseHTML('<!doctype html><html><body><div id="h"></div></body></html>');
    globalThis.document = document;
    const host = document.getElementById('h');
    const calls = [];
    const m = { host: false, me: 'u-me', roster, pending: [], connection: 'live', prepared: true, art: { banner: null, logo: null, title: 'x' }, kindText: '', episodeText: '', offset: 0,
      suggestion: { key: 'anime4up|okru', id: 'r2', label: 'OKRU' } };
    const a = { avatar: () => document.createElement('span'), leave() {}, changeServer() {}, setOffset() {}, acceptSuggestion: () => calls.push('yes'), declineSuggestion: () => calls.push('no') };
    renderLobby(host, m, a);
    const note = host.querySelector('.pl-suggest');
    expect(note.textContent).toContain('OKRU');
    const [yes, no] = note.querySelectorAll('button');
    yes.click(); no.click();
    expect(calls).toEqual(['yes', 'no']);
    // بلا اقتراح: لا إشعار
    renderLobby(host, { ...m, suggestion: null }, a);
    expect(host.querySelector('.pl-suggest')).toBeNull();
  });
});
