// Criteri del casuale e mix salvati (es. Festa, Relax, Palestra).
import { genresOf, isFavorite, isForgotten, isRecent, isLiked } from './library.js?v=14';
import { familiesOf, moodsOf, isItalian, isVersion, voteOf } from './tags.js?v=14';

// Criteri vuoti = nessun filtro.
export const empty = () => ({
  source: 'all',          // 'all' | 'liked' | 'folder:<id>'
  decades: [], years: [], // es. [1980, 1990] e [2016, 2017]: basta che il brano sia in uno di questi
  yearFrom: null, yearTo: null,
  famIn: [], famOut: [],  // generi semplici (rap, trap, jazz...)
  genresIn: [], genresOut: [], // generi precisi di Spotify
  moodsIn: [], moodsOut: [],
  artistsIn: [], artistsOut: [],
  origin: 'any',          // 'any' | 'it' | 'foreign'
  explicit: 'any',        // 'any' | 'no' | 'only'
  lengths: [],            // 'short' (< 3 min) | 'mid' (3–5) | 'long' (> 5)
  versions: 'any',        // 'any' | 'orig' | 'only' (live, remix, sped up...)
  feat: 'any',            // 'any' | 'solo' | 'feat'
  liked: 'any',           // 'any' | 'yes' | 'no' (nei Brani che ti piacciono)
  vote: 'nodown',         // 'any' | 'nodown' (niente 👎) | 'up' (solo 👍)
  added: 'any',           // 'any' | 'month' | 'half' | 'old' (quando l'hai messo in playlist)
  pop: 'any',             // 'any' | 'hit' | 'niche' (se Spotify dà la popolarità)
  listen: 'any',          // 'any' | 'fav' | 'forgotten'
  skipRecent: false,      // salta i brani ascoltati da poco
  limit: 0,               // quanti brani al massimo (0 = tutti)
  minutes: 0,             // durata della sessione (0 = senza limite)
  spread: true,           // mai lo stesso artista due volte di fila
});

const DAY = 86_400_000;
export const lengthOf = (t) => (!t.ms ? null : t.ms < 180_000 ? 'short' : t.ms <= 300_000 ? 'mid' : 'long');
export const NO_GENRE = '_none';
export const famsOf = (t) => { const f = familiesOf(t); return f.length ? f : [NO_GENRE]; };

export function filter(pool, c) {
  const has = (a) => a && a.length;
  const gIn = new Set(c.genresIn), gOut = new Set(c.genresOut);
  const fIn = new Set(c.famIn), fOut = new Set(c.famOut);
  const mIn = new Set(c.moodsIn), mOut = new Set(c.moodsOut);
  const aIn = new Set(c.artistsIn), aOut = new Set(c.artistsOut);
  const now = Date.now();
  return pool.filter((t) => {
    if (has(c.decades) || has(c.years)) {
      if (!t.year) return false;
      if (!c.decades.includes(Math.floor(t.year / 10) * 10) && !c.years.includes(t.year)) return false;
    }
    if (c.yearFrom && (!t.year || t.year < c.yearFrom)) return false;
    if (c.yearTo && (!t.year || t.year > c.yearTo)) return false;

    const ids = t.artists.map((a) => a.id);
    if (aOut.size && ids.some((id) => aOut.has(id))) return false;
    if (aIn.size && !ids.some((id) => aIn.has(id))) return false;

    if (fIn.size || fOut.size) {
      const f = famsOf(t);
      if (fOut.size && f.some((x) => fOut.has(x))) return false;
      if (fIn.size && !f.some((x) => fIn.has(x))) return false;
    }
    if (gIn.size || gOut.size) {
      const g = genresOf(t);
      if (gOut.size && g.some((x) => gOut.has(x))) return false;
      if (gIn.size && !g.some((x) => gIn.has(x))) return false;
    }
    if (mIn.size || mOut.size) {
      const m = moodsOf(t);
      if (mOut.size && m.some((x) => mOut.has(x))) return false;
      if (mIn.size && !m.some((x) => mIn.has(x))) return false;
    }

    if (c.origin === 'it' && !isItalian(t)) return false;
    if (c.origin === 'foreign' && isItalian(t)) return false;
    if (c.explicit === 'no' && t.explicit) return false;
    if (c.explicit === 'only' && !t.explicit) return false;
    if (has(c.lengths) && !c.lengths.includes(lengthOf(t))) return false;
    if (c.versions === 'orig' && isVersion(t)) return false;
    if (c.versions === 'only' && !isVersion(t)) return false;
    if (c.feat === 'solo' && t.artists.length > 1) return false;
    if (c.feat === 'feat' && t.artists.length < 2) return false;
    if (c.liked === 'yes' && !isLiked(t.uri)) return false;
    if (c.liked === 'no' && isLiked(t.uri)) return false;

    const v = voteOf(t.uri);
    if (c.vote === 'nodown' && v < 0) return false;
    if (c.vote === 'up' && v <= 0) return false;

    if (c.added !== 'any') {
      if (!t.added) return false;
      const age = now - t.added;
      if (c.added === 'month' && age > 31 * DAY) return false;
      if (c.added === 'half' && age > 183 * DAY) return false;
      if (c.added === 'old' && age < 365 * DAY) return false;
    }
    if (c.pop === 'hit' && !(t.popularity >= 60)) return false;
    if (c.pop === 'niche' && !(t.popularity != null && t.popularity < 40)) return false;

    if (c.listen === 'fav' && !isFavorite(t.uri)) return false;
    if (c.listen === 'forgotten' && !isForgotten(t.uri)) return false;
    if (c.skipRecent && isRecent(t.uri)) return false;
    return true;
  });
}

// Mescola, evita lo stesso artista di fila, poi taglia per numero o per durata.
export function pick(list, c, max) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  let out = a;
  if (c.spread && a.length > 2) {
    const main = (t) => t?.artists[0]?.id;
    out = [];
    let wait = [];
    for (const t of a) {
      if (out.length && main(t) === main(out.at(-1))) { wait.push(t); continue; }
      out.push(t);
      const k = wait.findIndex((w) => main(w) !== main(out.at(-1)));
      if (k >= 0) out.push(wait.splice(k, 1)[0]);
    }
    // quelli rimasti si infilano dove non toccano lo stesso artista, se c'è posto
    for (const t of wait) {
      const k = out.findIndex((x, i) => main(x) !== main(t) && main(out[i + 1]) !== main(t));
      out.splice(k >= 0 ? k + 1 : out.length, 0, t);
    }
  }
  if (c.limit) out = out.slice(0, c.limit);
  if (c.minutes) {
    let ms = 0;
    const cut = [];
    for (const t of out) { if (ms >= c.minutes * 60_000) break; cut.push(t); ms += t.ms || 210_000; }
    out = cut;
  }
  return out.slice(0, max);
}

// Conta generi, famiglie, mood, anni e artisti presenti, dal più frequente.
export function tally(pool) {
  const genres = new Map(), fams = new Map(), moods = new Map(), artists = new Map(), years = new Map();
  const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const t of pool) {
    for (const g of genresOf(t)) inc(genres, g);
    for (const f of famsOf(t)) inc(fams, f);
    for (const m of moodsOf(t)) inc(moods, m);
    if (t.year) inc(years, t.year);
    for (const a of t.artists) {
      const cur = artists.get(a.id) || { id: a.id, name: a.name, n: 0 };
      cur.n++;
      artists.set(a.id, cur);
    }
  }
  const sorted = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
  return {
    genres: sorted(genres), fams: sorted(fams), moods, years,
    artists: [...artists.values()].sort((a, b) => b.n - a.n),
  };
}

// ---------- Mix salvati ----------
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
