// Criteri del casuale e "mood" salvati (es. Festa, Relax, Palestra).
import { genresOf, isFavorite, isForgotten, isRecent } from './library.js?v=4';

// Criteri vuoti = nessun filtro.
export const empty = () => ({
  source: 'all',          // 'all' | 'liked' | 'folder:<id>'
  genresIn: [], genresOut: [],
  artistsIn: [], artistsOut: [],
  yearFrom: null, yearTo: null,
  listen: 'any',          // 'any' | 'fav' | 'forgotten'
  skipRecent: false,      // salta i brani ascoltati da poco
});

export function filter(pool, c) {
  const gIn = new Set(c.genresIn), gOut = new Set(c.genresOut);
  const aIn = new Set(c.artistsIn), aOut = new Set(c.artistsOut);
  return pool.filter((t) => {
    if (c.yearFrom && (!t.year || t.year < c.yearFrom)) return false;
    if (c.yearTo && (!t.year || t.year > c.yearTo)) return false;
    const ids = t.artists.map((a) => a.id);
    if (aOut.size && ids.some((id) => aOut.has(id))) return false;
    if (aIn.size && !ids.some((id) => aIn.has(id))) return false;
    if (gIn.size || gOut.size) {
      const g = genresOf(t);
      if (gOut.size && g.some((x) => gOut.has(x))) return false;
      if (gIn.size && !g.some((x) => gIn.has(x))) return false;
    }
    if (c.listen === 'fav' && !isFavorite(t.uri)) return false;
    if (c.listen === 'forgotten' && !isForgotten(t.uri)) return false;
    if (c.skipRecent && isRecent(t.uri)) return false;
    return true;
  });
}

// Conta generi e artisti presenti, dal più frequente.
export function tally(pool) {
  const genres = new Map(), artists = new Map();
  for (const t of pool) {
    for (const g of genresOf(t)) genres.set(g, (genres.get(g) || 0) + 1);
    for (const a of t.artists) {
      const cur = artists.get(a.id) || { id: a.id, name: a.name, n: 0 };
      cur.n++;
      artists.set(a.id, cur);
    }
  }
  return {
    genres: [...genres.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })),
    artists: [...artists.values()].sort((a, b) => b.n - a.n),
  };
}

// ---------- Mood salvati ----------
const KEY = 'sp_moods';
export function moods() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
export function saveMood(name, criteria) {
  const list = moods().filter((m) => m.name.toLowerCase() !== name.toLowerCase());
  const m = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, criteria };
  localStorage.setItem(KEY, JSON.stringify([...list, m]));
  return m;
}
export function removeMood(id) {
  localStorage.setItem(KEY, JSON.stringify(moods().filter((m) => m.id !== id)));
}
