// Raccolta dei brani su cui fare il casuale con criteri, più i dati per filtrarli:
// generi degli artisti, brani più ascoltati, ascolti recenti e uno storico che cresce nel tempo.
import { spotify, getAll, playlistTracksCached } from './api.js?v=6';

// ---------- Brani ----------
// Brano "semplice" usato per i filtri.
function simple(t) {
  return {
    uri: t.uri,
    name: t.name,
    artists: (t.artists || []).map((a) => ({ id: a.id, name: a.name })),
    year: Number(String(t.album?.release_date || '').slice(0, 4)) || null,
    image: t.album?.images?.at(-1)?.url || '',
    explicit: !!t.explicit,
    ms: t.duration_ms || 0,
    added: Date.parse(t.added_at) || 0,               // quando l'hai messo nella playlist
    popularity: typeof t.popularity === 'number' ? t.popularity : null,
  };
}

let likedPromise = null;
let likedSet = null; // null = non ancora letti
export const isLiked = (uri) => !!likedSet?.has(uri);
export const likedKnown = () => !!likedSet;
export const markLiked = (uri) => likedSet?.add(uri);
export function likedTracks() {
  if (!likedPromise) {
    likedPromise = getAll('/me/tracks')
      .then((rows) => rows.map((r) => { const t = r.item ?? r.track; return t && { ...t, added_at: r.added_at }; })
        .filter((t) => t?.uri && !t.is_local))
      .then((list) => { likedSet = new Set(list.map((t) => t.uri)); return list; })
      .catch((e) => { likedPromise = null; throw e; });
  }
  return likedPromise;
}

// Unisce i brani di più playlist (e se richiesto dei Brani che ti piacciono), senza doppioni.
export async function buildPool(playlists, { liked = false } = {}) {
  const lists = await Promise.all([
    ...playlists.map((p) => playlistTracksCached(p)),
    liked ? likedTracks() : [],
  ]);
  const byUri = new Map();
  for (const t of lists.flat()) {
    if (!t?.uri) continue;
    const s = byUri.get(t.uri);
    if (!s) byUri.set(t.uri, simple(t));
    else s.added = Math.max(s.added, Date.parse(t.added_at) || 0);
  }
  return [...byUri.values()];
}

// ---------- Generi (si chiedono artista per artista e si ricordano sul telefono) ----------
const GKEY = 'sp_artist_genres';
let genreCache = null;
const loadGenres = () => (genreCache ??= (() => { try { return JSON.parse(localStorage.getItem(GKEY)) || {}; } catch { return {}; } })());
const saveGenres = () => localStorage.setItem(GKEY, JSON.stringify(genreCache));

export function genresOf(track) {
  const g = loadGenres();
  return [...new Set(track.artists.flatMap((a) => g[a.id] || []))];
}

export function missingArtists(pool) {
  const g = loadGenres();
  return [...new Set(pool.flatMap((t) => t.artists.map((a) => a.id)))].filter((id) => id && !(id in g));
}

// Spotify ha tolto la richiesta "più artisti insieme": si chiede uno alla volta, con calma.
// onProgress(fatti, totale). Si ferma da solo se Spotify dice che il limite è finito.
export async function fetchGenres(ids, onProgress, signal) {
  const g = loadGenres();
  let done = 0;
  const queue = [...ids];
  const worker = async () => {
    while (queue.length && !signal?.aborted) {
      const id = queue.shift();
      try {
        const a = await spotify(`/artists/${id}`);
        g[id] = a.genres || [];
      } catch (e) {
        if (e.reason === 'QUOTA_EXCEEDED') { queue.length = 0; throw e; }
        if (e.status === 404) g[id] = [];
      }
      done++;
      if (done % 10 === 0) saveGenres();
      onProgress?.(done, ids.length);
    }
  };
  try {
    await Promise.all([worker(), worker(), worker()]);
  } finally {
    saveGenres();
  }
}

// ---------- Ascolti ----------
// Spotify fa vedere solo gli ultimi 50 ascolti: a ogni apertura li aggiungiamo a uno storico
// sul telefono, così col tempo l'app sa quante volte e quando hai sentito ogni brano.
const HKEY = 'sp_history';
const readHistory = () => { try { return JSON.parse(localStorage.getItem(HKEY)) || { last: 0, tracks: {} }; } catch { return { last: 0, tracks: {} }; } };

let recentUris = new Set();
let recentTracks = [];          // brani completi degli ultimi ascolti
let recentFrom = new Map();      // id playlist -> quanti ultimi ascolti sono partiti da lì
export async function syncHistory() {
  const h = readHistory();
  const data = await spotify('/me/player/recently-played', { query: { limit: 50 } });
  recentUris = new Set();
  recentTracks = [];
  recentFrom = new Map();
  let newest = h.last;
  for (const it of data?.items || []) {
    const uri = it.track?.uri ?? it.item?.uri;
    if (!uri) continue;
    recentUris.add(uri);
    if (it.track ?? it.item) recentTracks.push(it.track ?? it.item);
    if (it.context?.type === 'playlist') {
      const pid = it.context.uri.split(':').pop();
      recentFrom.set(pid, (recentFrom.get(pid) || 0) + 1);
    }
    const at = Date.parse(it.played_at);
    if (at <= h.last) continue; // già contato
    const rec = (h.tracks[uri] ??= { n: 0, at: 0 });
    rec.n++;
    rec.at = Math.max(rec.at, at);
    newest = Math.max(newest, at);
  }
  h.last = newest;
  localStorage.setItem(HKEY, JSON.stringify(h));
}

export const historyOf = (uri) => readHistory().tracks[uri];
export const isRecent = (uri) => recentUris.has(uri);
export const recentList = () => recentTracks;
export const playsFrom = (playlistId) => recentFrom.get(playlistId) || 0;

// Brani più ascoltati secondo Spotify: ultimo mese, ultimi 6 mesi, ultimo anno circa.
let top = null;
export async function loadTop() {
  if (top) return top;
  const terms = ['short_term', 'medium_term', 'long_term'];
  const res = await Promise.all(terms.map((t) => spotify('/me/top/tracks', { query: { time_range: t, limit: 50 } }).catch(() => null)));

  top = { items: {} };
  terms.forEach((t, i) => {
    top.items[t] = res[i]?.items || [];
    top[t] = new Set(top.items[t].map((x) => x.uri));
  });
  return top;
}

const DAY = 86_400_000;

// "Preferito": tra i più ascoltati secondo Spotify, oppure sentito almeno 3 volte (storico dell'app).
export function isFavorite(uri) {
  const h = historyOf(uri);
  return !!(top && (top.short_term.has(uri) || top.medium_term.has(uri) || top.long_term.has(uri))) || (h?.n >= 3);
}

// "Non lo senti da tanto": non è tra i più ascoltati recenti né negli ultimi ascolti,
// e lo storico non lo ha visto negli ultimi 30 giorni.
export function isForgotten(uri) {
  if (recentUris.has(uri)) return false;
  if (top && (top.short_term.has(uri) || top.medium_term.has(uri))) return false;
  const h = historyOf(uri);
  return !h || Date.now() - h.at > 30 * DAY;
}
