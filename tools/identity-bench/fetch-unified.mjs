// Rebuilds apps/web/lib/fixtures/unified-identity-bench.json (network; never run by tests).
// Usage: node tools/identity-bench/fetch-unified.mjs > out.json
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(url, init, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, init);
      if (r.status === 429) { await sleep(Number(r.headers.get('retry-after') ?? 30) * 1000 + 500); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(1000 * (i + 1)); }
  }
  return null;
}
const Q = `query($page:Int,$sort:[MediaSort],$ids:[Int]){Page(page:$page,perPage:50){media(type:ANIME,sort:$sort,id_in:$ids,isAdult:false){
 id idMal format seasonYear title{english romaji native} synonyms
 relations{edges{relationType node{id type format}}}}}}`;
const al = async (vars) => (await json('https://graphql.anilist.co', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ query: Q, variables: vars }) }))?.data?.Page?.media ?? [];
const anime = new Map();
const add = (m) => anime.set(m.id, m);
for (let p = 1; p <= 30; p++) { (await al({ page: p, sort: ['POPULARITY_DESC'] })).forEach(add); await sleep(2200); }
for (const p of [80, 81, 82, 140, 141, 142, 200, 201]) { (await al({ page: p, sort: ['POPULARITY_DESC'] })).forEach(add); await sleep(2200); }
// franchise members (seasons, movies, OVA, remakes) of the popular head
const want = new Set();
for (const m of anime.values()) for (const e of m.relations.edges) if (e.node.type === 'ANIME' && !anime.has(e.node.id)) want.add(e.node.id);
const ids = [...want].slice(0, 900);
for (let i = 0; i < ids.length; i += 50) { (await al({ page: 1, ids: ids.slice(i, i + 50) })).forEach(add); await sleep(2200); }
console.error('anime', anime.size);
// ani.zip
const zip = new Map();
const list = [...anime.keys()];
let k = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (k < list.length) {
    const id = list[k++];
    const d = await json(`https://api.ani.zip/mappings?anilist_id=${id}`);
    const imdb = /^tt\d+$/.test(d?.mappings?.imdb_id ?? '') ? d.mappings.imdb_id : null;
    const seasons = [...new Set(Object.entries(d?.episodes ?? {}).filter(([n]) => /^\d+$/.test(n)).map(([, e]) => Number(e?.seasonNumber)).filter((s) => Number.isInteger(s) && s > 0))].sort((a, b) => a - b);
    zip.set(id, { imdb, seasons, mal: d?.mappings?.mal_id ?? null, ar: d?.titles?.ar ?? null });
  }
}));
console.error('zip', zip.size);
// Cinemeta: top movies/series, animation, anime IMDb ids, name collisions
const cine = new Map();
const addC = (m) => { if (m?.imdb_id && /^tt\d+$/.test(m.imdb_id) && !cine.has(`${m.type}:${m.imdb_id}`)) cine.set(`${m.type}:${m.imdb_id}`, { type: m.type, imdb: m.imdb_id, name: m.name, year: m.releaseInfo ?? m.year ?? null, genres: m.genres ?? m.genre ?? [], country: m.country ?? null, seasons: Array.isArray(m.videos) ? new Set(m.videos.map((v) => v.season).filter((s) => s > 0)).size : null }); };
for (const type of ['movie', 'series']) {
  for (let s = 0; s < 1000; s += 100) { (await json(`https://v3-cinemeta.strem.io/catalog/${type}/top/skip=${s}.json`))?.metas?.forEach(addC); }
  for (let s = 0; s < 300; s += 100) { (await json(`https://v3-cinemeta.strem.io/catalog/${type}/top/genre=Animation&skip=${s}.json`))?.metas?.forEach(addC); }
}
const animeImdb = [...new Set([...zip.values()].map((z) => z.imdb).filter(Boolean))];
k = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (k < animeImdb.length) {
    const tt = animeImdb[k++];
    let m = (await json(`https://v3-cinemeta.strem.io/meta/series/${tt}.json`))?.meta;
    if (!m?.imdb_id || m.type !== 'series') m = (await json(`https://v3-cinemeta.strem.io/meta/movie/${tt}.json`))?.meta;
    if (m) addC(m);
  }
}));
for (const q of ['Death Note', 'Dune', 'Fargo', 'The Office', 'Shogun', 'Cowboy Bebop', 'One Piece', 'Ghost in the Shell', 'Akira', 'Oldboy', 'Solaris', 'Godzilla', 'Lupin', 'Alita', 'Avatar', 'Hellsing', 'Berserk', 'Dragon Ball', 'Speed Racer', 'Westworld', 'Battlestar Galactica', 'Scarface', 'The Thing', 'Planet of the Apes', 'Total Recall', 'Robocop', 'Insomnia', 'Psycho', 'The Departed', 'Infernal Affairs', 'Ringu', 'The Ring', 'Shall We Dance', 'Vanilla Sky', 'Let the Right One In', 'Let Me In', 'Parasyte', 'Bleach', 'Tokyo Ghoul', 'Rurouni Kenshin', 'Attack on Titan', 'Fullmetal Alchemist', 'City Hunter', 'Kingdom', 'Yu Yu Hakusho', 'Gintama', 'Kaguya', 'Kite', 'Wolf Children', 'Your Name', 'Fargo', 'Skins', 'House of Cards', 'Utopia', 'Shameless', 'The Killing', 'Doctor Who', 'Sherlock', 'Frozen', 'Crash', 'Heat', 'Lucy']) {
  for (const type of ['movie', 'series']) (await json(`https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(q)}.json`))?.metas?.slice(0, 12).forEach(addC);
}
console.error('cine', cine.size);
const out = {
  $comment: 'Pinned unified identity benchmark. a=AniList anime [al, mal, format, year, [en, romaji, native], synonyms, arabic(ani.zip), imdb(ani.zip), [ani.zip seasons], [[relatedAniList, relation, type]]]; c=Cinemeta [type, imdb, name, year, seasons|null, isAnimation]. Truth: AniList id within anime, IMDb within cinema, ani.zip imdb_id across. Rebuild: node tools/identity-bench/fetch-unified.mjs',
  fetchedAt: new Date().toISOString().slice(0, 10),
  a: [...anime.values()].map((m) => { const z = zip.get(m.id) ?? {}; return [m.id, m.idMal ?? z.mal ?? null, m.format, m.seasonYear ?? null, [m.title.english, m.title.romaji, m.title.native], m.synonyms ?? [], z.ar ?? null, z.imdb ?? null, z.seasons ?? [], m.relations.edges.filter((e) => ['ANIME', 'MANGA'].includes(e.node.type)).map((e) => [e.node.id, e.relationType, e.node.type[0]])]; }),
  c: [...cine.values()].map((c) => [c.type === 'series' ? 'S' : 'M', c.imdb, c.name, c.year, c.seasons, (c.genres ?? []).includes('Animation') ? 1 : 0]),
};
process.stdout.write(JSON.stringify(out));
