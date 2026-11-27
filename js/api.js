// Chiamate alla Web API di Spotify, con rinnovo automatico dell'accesso e attesa sui limiti.
import { getAccessToken, refresh } from './auth.js?v=11';

const BASE = 'https://api.spotify.com/v1';

export class SpotifyError extends Error {
  constructor(status, message, reason) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function spotify(path, { method = 'GET', body, query } = {}) {
  const url = new URL(path.startsWith('http') ? path : BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);

  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await getAccessToken()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && attempt === 0) { await refresh(); continue; }

    const text = await res.text();
    const data = text ? safeJson(text) : null;

    if (res.status === 429) {
      const reason = data?.error?.reason;
      if (reason === 'QUOTA_EXCEEDED') {
        throw new SpotifyError(429, 'Limite di richieste a Spotify raggiunto per oggi.', reason);
      }
      await sleep(Math.min((Number(res.headers.get('Retry-After')) || 2 ** attempt), 30) * 1000);
      continue;
    }
    if (res.status >= 500 && attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }

    if (!res.ok) {
      const msg = data?.error?.message || `Errore ${res.status}`;
      throw new SpotifyError(res.status, msg, data?.error?.reason);
    }
    return data;
  }
  throw new SpotifyError(0, 'Spotify non risponde, riprova tra poco.');
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// Scorre tutte le pagine di un elenco (playlist, brani...) e restituisce tutti gli elementi.
// Le pagine dopo la prima si chiedono 3 alla volta (molto più veloce con migliaia di brani).
export async function getAll(path, query = {}) {
  const first = await spotify(path, { query: { limit: 50, ...query } });
  const items = [...(first?.items || [])];
  if (!first?.next) return items;
  const total = first.total;
  if (typeof total !== 'number') {
    let next = first.next;
    while (next) { const d = await spotify(next); items.push(...d.items); next = d.next; }
    return items;
  }
  const offsets = [];
  for (let o = 50; o < total; o += 50) offsets.push(o);
  const pages = await mapLimit(offsets, 3, (offset) => spotify(path, { query: { limit: 50, ...query, offset } }));
  for (const d of pages) items.push(...(d?.items || []));
  return items;
}

// Esegue fn su ogni elemento, al massimo `limit` alla volta, e restituisce i risultati in ordine.
export async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  const worker = async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); } };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

export const me = () => spotify('/me');
export const myPlaylists = () => getAll('/me/playlists');
export const devices = async () => (await spotify('/me/player/devices')).devices;

// Numero di brani di una playlist (Spotify ha rinominato "tracks" in "items" nel 2026).
export const trackCount = (p) => p.items?.total ?? p.tracks?.total ?? 0;

// Brani di una playlist (solo per le playlist proprie o in collaborazione).
// Spotify nel 2026 ha rinominato "track" in "item": si leggono tutti e due.
export async function playlistTracks(playlistId) {
  const rows = await getAll(`/playlists/${playlistId}/items`);
  return rows
    .map((r) => { const t = r.item ?? r.track; return t && { ...t, added_at: r.added_at }; })
    .filter((t) => t && t.type === 'track' && t.uri && !t.is_local);
}

// Come playlistTracks, ma ricorda i brani finché la playlist non cambia (snapshot_id).
const trackCache = new Map();
export function playlistTracksCached(p) {
  const key = `${p.id}:${p.snapshot_id}`;
  if (!trackCache.has(key)) {
    trackCache.set(key, playlistTracks(p.id).catch((e) => { trackCache.delete(key); throw e; }));
  }
  return trackCache.get(key);
}

// Fa partire un elenco di brani scelto da noi (per il casuale su più playlist).
export async function playUris(uris, deviceId) {
  await spotify('/me/player/play', { method: 'PUT', query: { device_id: deviceId }, body: { uris } });
}

// Fa partire una playlist da un brano preciso.
export async function playFromTrack(playlist, trackUri, deviceId) {
  await spotify('/me/player/play', {
    method: 'PUT', query: { device_id: deviceId },
    body: { context_uri: playlist.uri, offset: { uri: trackUri } },
  });
}

// Fa partire una playlist intera in ordine casuale: si parte da un brano a caso e poi si attiva lo shuffle
// (lo shuffle si può attivare solo dopo, quando il dispositivo è già in riproduzione).
export async function playShuffled(playlist, deviceId) {
  const total = trackCount(playlist);
  const body = { context_uri: playlist.uri };
  if (total > 1) body.offset = { position: Math.floor(Math.random() * total) };
  await spotify('/me/player/play', { method: 'PUT', query: { device_id: deviceId }, body });
  await spotify('/me/player/shuffle', { method: 'PUT', query: { state: true, device_id: deviceId } }).catch(() => {});
}

// Brano in ascolto adesso (null se non suona niente).
export async function nowPlaying() {
  const d = await spotify('/me/player/currently-playing');
  return d?.item ?? d?.track ?? null;
}

export const nextTrack = () => spotify('/me/player/next', { method: 'POST' });

// Aggiunge ai Brani che ti piacciono. Dal 2026 si usa /me/library con gli URI; se non va, il modo vecchio.
export async function saveToLibrary(uris) {
  try {
    await spotify('/me/library', { method: 'PUT', query: { uris: uris.join(',') } });
  } catch (e) {
    if (e.status !== 404 && e.status !== 400 && e.status !== 403) throw e;
    await spotify('/me/tracks', { method: 'PUT', query: { ids: uris.map((u) => u.split(':').pop()).join(',') } });
  }
}
