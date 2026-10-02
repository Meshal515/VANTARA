import { describe, expect, it } from 'vitest';
import { createStore } from '../cache/store.js';
import { createRegistry } from './registry.js';

/** محرك وهمي: سلوكه من التعريف نفسه (config.works = يعمل أم لا). */
const fake = {
  kind: 'fake',
  content: 'manga',
  create(def) {
    const ok = def.config?.works !== false;
    const fail = async () => {
      throw new Error('broken selectors');
    };
    return {
      search: ok ? async () => ({ mangas: [{ url: '1', title: 'One' }], hasNextPage: false }) : fail,
      popular: ok ? async () => ({ mangas: [{ url: '1', title: 'One' }], hasNextPage: false }) : fail,
      series: ok ? async () => ({ manga: { url: '1', title: 'One' }, chapters: [{ url: 'c1', name: '1' }] }) : fail,
      pages: ok ? async () => [{ index: 0, url: 'x', imageUrl: 'https://img.test/1.jpg' }] : fail,
      version: def.version,
    };
  },
};

const def = (version, works = true) => ({ id: 'src.a', label: 'A', content: 'manga', engine: 'fake', version, domain: 'a.test', config: { works } });

function setup() {
  const store = createStore({ indexedDB: null });
  let t = 1_000_000;
  const make = () => createRegistry({ engines: { fake }, store, ctx: {}, now: () => t });
  return { store, make, advance: (ms) => (t += ms) };
}

describe('source registry: stable / candidate / last known good', () => {
  it('uses a first-seen source at once and verifies it in the background', async () => {
    const { make } = setup();
    const r = make();
    await r.init([def(1)]);
    expect(r.source('src.a').version).toBe(1);
    expect(r.status()['src.a'].stable.verified).toBe(false);
    await r.verifyPending();
    expect(r.status()['src.a'].stable.verified).toBe(true);
  });

  it('a newer definition stays a candidate until its probe passes, then the old one becomes last known good', async () => {
    const { make } = setup();
    await make().init([def(1)]);
    const r = make();
    await r.init([def(2)]);
    expect(r.source('src.a').version).toBe(1);
    expect(r.status()['src.a'].candidate.status).toBe('pending');
    await r.verifyPending();
    const s = r.status()['src.a'];
    expect(r.source('src.a').version).toBe(2);
    expect(s.lkg.version).toBe(1);
    expect(s.candidate).toBeNull();
  });

  it('a broken candidate is never adopted, and is retried only after six hours', async () => {
    const { make, advance } = setup();
    await make().init([def(1)]);
    let r = make();
    await r.init([def(2, false)]);
    await r.verifyPending();
    expect(r.source('src.a').version).toBe(1);
    expect(r.status()['src.a'].candidate.status).toBe('failed');
    r = make();
    await r.init([def(2, false)]);
    expect(r.status()['src.a'].candidate.status).toBe('failed');
    advance(6 * 60 * 60 * 1000 + 1);
    r = make();
    await r.init([def(2, false)]);
    expect(r.status()['src.a'].candidate.status).toBe('pending');
  });

  it('rolls back to the last known good when the stable keeps failing for real', async () => {
    const { make } = setup();
    await make().init([def(1)]);
    const r = make();
    await r.init([def(2)]);
    await r.verifyPending();
    expect(r.source('src.a').version).toBe(2);
    for (let i = 0; i < 4; i += 1) await r.call('src.a', async () => { throw new Error('selector gone'); }).catch(() => {});
    expect(r.source('src.a').version).toBe(1);
    expect(r.status()['src.a'].candidate).toMatchObject({ version: 2, status: 'failed' });
  });

  it('a Cloudflare challenge cools the source down but never rolls it back', async () => {
    const { make, advance } = setup();
    await make().init([def(1)]);
    const r = make();
    await r.init([def(2)]);
    await r.verifyPending();
    const challenge = Object.assign(new Error('cf'), { code: 'challenge' });
    for (let i = 0; i < 5; i += 1) await r.call('src.a', async () => { throw challenge; }).catch(() => {});
    expect(r.source('src.a').version).toBe(2);
    expect(r.cooling('src.a')).toBe(true);
    advance(11 * 60 * 1000);
    expect(r.cooling('src.a')).toBe(false);
  });

  it('rejects an invalid definition instead of loading it', async () => {
    const { make } = setup();
    const r = make();
    await r.init([{ ...def(1), engine: 'nope' }, { ...def(1), id: 'src.b', domain: 'not a domain' }]);
    expect(r.list()).toEqual([]);
  });
});
