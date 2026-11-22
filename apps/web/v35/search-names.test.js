/**
 * توسيع البحث بأسماء العمل (بلاغ المالك 22 نوفمبر): المصادر لا تعرف العمل باسمه الياباني أو المختصر، فيُسأل القاموس ثم
 * AniList عن أسمائه. الحراس: اسم يطابق أكثر من عمل لا يوسَّع (لا دمج بالتخمين)، والكبار لا يوسَّعون، وبلا شبكة يبقى
 * البحث بما كُتب، وطلب واحد للعبارة.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _reset as resetAliases, learnAliases } from '../lib/manga-alias-store.js';
import { _resetQueryNames, queryNames } from './works.js';

beforeEach(() => { resetAliases(); _resetQueryNames(); });

describe('queryNames', () => {
  it('a name the device dictionary knows for exactly one work expands to its other names, without asking AniList', async () => {
    learnAliases('fullmetal alchemist', ['Hagane no Renkinjutsushi', '鋼の錬金術師']);
    const fetchMatches = vi.fn();
    expect(await queryNames('鋼の錬金術師', { fetchMatches })).toEqual(['fullmetal alchemist', 'Hagane no Renkinjutsushi']);
    expect(fetchMatches).not.toHaveBeenCalled();
  });

  it('a name two works share in the dictionary is not expanded', async () => {
    learnAliases('monster', ['モンスター']);
    learnAliases('monster 2', ['モンスター']);
    expect(await queryNames('モンスター', { fetchMatches: vi.fn() })).toEqual([]);
  });

  it('AniList: one exact work gives its names; an adult work or no unique match gives none; once per phrase', async () => {
    const fetchMatches = vi.fn(async ([q]) => new Map([[q, q === 'OHSHC'
      ? { identity: { id: 1, names: ['Ouran Koukou Host Club', 'Ouran High School Host Club', 'OHSHC'] }, verdict: 'clean' }
      : q === 'Secret' ? { identity: { id: 2, names: ['Secret Taste'] }, verdict: 'adult' } : { identity: null, verdict: 'unknown' }]]));
    expect(await queryNames('OHSHC', { fetchMatches })).toEqual(['Ouran Koukou Host Club', 'Ouran High School Host Club']);
    await queryNames('ohshc', { fetchMatches });
    expect(fetchMatches).toHaveBeenCalledTimes(1);
    expect(await queryNames('Secret', { fetchMatches })).toEqual([]);
    expect(await queryNames('one pie', { fetchMatches })).toEqual([]);
  });

  it('offline: searching by what was typed still works', async () => {
    expect(await queryNames('銀魂', { fetchMatches: async () => { throw new Error('offline'); } })).toEqual([]);
  });
});
