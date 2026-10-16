import { describe, expect, it } from 'vitest';
import { canonicalIndex, normalizeTitle } from './catalog.js';
import { _reset, aliasMap, setTwinAliases } from './manga-alias-store.js';
import { twinAliases } from './manga-twins.js';

const row = (title, number) => [normalizeTitle(title), number];
const k = (t) => normalizeTitle(t);
const pairs = (out) => Object.entries(out).map(([o, names]) => [o, ...names].sort().join(' = ')).sort();
const pair = (...titles) => titles.map(k).sort().join(' = ');

/** أزواج حقيقية من الخط الزمني (16 أكتوبر 2026): نفس العمل بأسماء مصادر مختلفة. */
describe('twin works across sources', () => {
  it('pairs the duplicates seen live, by close names and the same top chapter', () => {
    expect(pairs(twinAliases([
      row('City Of Sin', 37), row('City of Sins', 37),
      row('Murim Psychopath', 47), row('Psychopath in murim', 47),
      row('Survival Story Of A Sword King In A Fantasy World', 304), row('Survivor Story of a Sword King in a Fantasy World', 304),
      row('The Novel’s Extra', 175), row('The novels extra', 175),
      row('Pick Me Up!', 223), row('Pick Me Up : Infinite Gacha', 223),
      row("Player Who Can't Level Up", 244), row("The Player That Can't Level Up", 247),
      row('The End of the World is Just a Game to Me', 22), row('The End is a Game to Me', 22),
      row('Shangri-La Frontier ~Kusoge Hunter, Kamige ni Idoman to su~', 283), row('Shangri-La Frontier', 283),
    ]))).toEqual([
      pair('City of Sins', 'City Of Sin'),
      pair('Murim Psychopath', 'Psychopath in murim'),
      pair('Pick Me Up!', 'Pick Me Up : Infinite Gacha'),
      pair("Player Who Can't Level Up", "The Player That Can't Level Up"),
      pair('Shangri-La Frontier ~Kusoge Hunter, Kamige ni Idoman to su~', 'Shangri-La Frontier'),
      pair('Survival Story Of A Sword King In A Fantasy World', 'Survivor Story of a Sword King in a Fantasy World'),
      pair('The End of the World is Just a Game to Me', 'The End is a Game to Me'),
      pair('The Novel’s Extra', 'The novels extra'),
    ].sort());
  });
  it('never pairs different works: spin-offs, sequels, seasons, a far chapter, or chance words', () => {
    expect(twinAliases([
      row('Shuumatsu no Harem', 6), row('Shuumatsu no Harem Fantasia', 6), // عمل جانبي بنفس الفصل الصغير
      row("I'll Spend My Fortune to Become the Strongest Before the Game Ends", 22), row('The End is a Game to Me', 22),
      row('Do Your Best and Regret', 11), row('Do Your Best to Regret', 45),
      row('Solo Leveling', 200), row('Solo Leveling: Ragnarok', 40),
      row('Tower of God Season 2', 30), row('Tower of God Season 3', 30),
      row('Return of the Mount Hua Sect', 120), row('Return of the Blossoming Blade', 120),
      row('أنتِ زهرة الحظ', 106), row('Kimi wa Yotsuba no Clover', 106),
    ])).toEqual({});
  });
  it('ignores a release year but keeps season numbers apart', () => {
    expect(Object.keys(twinAliases([row('Past Life Returner (2022)', 40), row('Past Life Returner', 40)]))).toHaveLength(1);
  });
});

it('turns server top chapters into one card for City of Sin / City of Sins across TeamX and MangaSwat', () => {
  _reset();
  setTwinAliases(twinAliases([row('City Of Sin', 37), row('City of Sins', 37)]));
  const index = canonicalIndex({ aliases: aliasMap() });
  index.add({ sourceId: 'eu.kanade.tachiyomi.extension.ar.teamx', label: 'Team X', manga: { title: 'City Of Sin', url: '/series/city-of-sin' } });
  index.add({ sourceId: 'eu.kanade.tachiyomi.extension.ar.mangaswat', label: 'MangaSwat', manga: { title: 'City of Sins', url: '1' } });
  expect(index.list()).toHaveLength(1);
  // نفس المصدر يعرضهما عملين: الحارس يمنع الدمج مهما قالت الأسماء
  const guard = canonicalIndex({ aliases: aliasMap() });
  guard.add({ sourceId: 'eu.kanade.tachiyomi.extension.ar.teamx', label: 'Team X', manga: { title: 'City Of Sin', url: '/a' } });
  guard.add({ sourceId: 'eu.kanade.tachiyomi.extension.ar.teamx', label: 'Team X', manga: { title: 'City of Sins', url: '/b' } });
  expect(guard.list()).toHaveLength(2);
});
