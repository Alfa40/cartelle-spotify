// Catalogo per remix e mashup: controlla quali brani si possono comprare e scaricare su iTunes Italia.
// I risultati si ricordano sul telefono, così una ricerca interrotta riparte da dove era arrivata.

const KEY = 'sp_itunes';
let cache = null;
const load = () => (cache ??= (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })());
const save = () => localStorage.setItem(KEY, JSON.stringify(cache));

export const resultOf = (uri) => load()[uri];
export const isChecked = (uri) => !!load()[uri] && !load()[uri].error;

// Toglie dal titolo le parti che cambiano da un negozio all'altro: (feat. ...), [Remastered], " - Live"...
export const norm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s*[\(\[].*?[\)\]]/g, '')
  .replace(/\s+-\s+.*$/, '')
  .replace(/\b(feat|ft|featuring)\.?\b.*$/, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Parole che indicano una versione diversa dall'originale (live, remix, cover…).
const VERSION = /\b(live|remix|rmx|acoustic|acustic[ao]|instrumental|strumentale|karaoke|cover|sped up|slowed|performance|reprise|demo|unplugged|orchestral|piano version|radio edit|extended|tribute)\b/;
const versionWords = (s) => new Set((String(s || '').toLowerCase().match(new RegExp(VERSION.source, 'g')) || []));

export function bestMatch(track, results) {
  const title = norm(track.name);
  const artists = (track.artists || []).map((a) => norm(a.name ?? a));
  const wanted = versionWords(track.name);
  let best = null;
  for (const r of results) {
    if (r.kind !== 'song') continue;
    const rt = norm(r.trackName);
    const ra = norm(r.artistName);
    const titleOk = rt && (rt === title || rt.startsWith(title) || title.startsWith(rt));
    const artistOk = artists.some((a) => a && (ra.includes(a) || a.includes(ra)));
    if (!titleOk || !artistOk) continue;
    // Versione diversa (es. live o remix) quando tu ascolti l'originale: va bene solo se non c'è di meglio.
    const extra = [...versionWords(`${r.trackName} ${r.collectionName}`)].filter((w) => !wanted.has(w));
    const diff = Math.abs((r.trackTimeMillis || 0) - (track.duration_ms || 0)) / 1000;
    const score = (rt === title ? 2 : 1) + (diff < 4 ? 2 : diff < 15 ? 1 : 0) + (r.trackPrice > 0 ? 1 : 0) - (extra.length ? 4 : 0);
    if (!best || score > best.score) best = { score, r, diff, variant: extra.length > 0 };
  }
  return best;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(term) {
  const url = `https://itunes.apple.com/search?${new URLSearchParams({ term, entity: 'song', country: 'IT', limit: '25' })}`;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 403 || res.status === 429) { await sleep(60_000); continue; }
      const text = await res.text();
      if (!text) { await sleep(20_000); continue; } // iTunes a volte risponde vuoto quando vuole una pausa
      return JSON.parse(text).results || [];
    } catch {
      await sleep(5000);
    }
  }
  return null; // non è stato possibile chiedere
}

export async function check(track) {
  const c = load();
  if (c[track.uri] && !c[track.uri].error) return c[track.uri];
  // 1ª ricerca: artista + titolo. Se non trova niente, 2ª ricerca: solo titolo (filtrando per artista).
  let results = await search(`${track.artists?.[0]?.name || ''} ${norm(track.name)}`.trim());
  let m = results && bestMatch(track, results);
  if (results && !m) {
    await sleep(PAUSE_MS);
    const more = await search(norm(track.name));
    if (more) m = bestMatch(track, more);
    else results = null;
  }
  const out = !results
    ? { error: true }
    : m
      ? { found: true, price: m.r.trackPrice > 0 ? m.r.trackPrice : null, url: String(m.r.trackViewUrl || '').replace(/[?&]uo=4/, ''), sameLength: m.diff < 4, variant: m.variant }
      : { found: false };
  c[track.uri] = out;
  save();
  return out;
}

// Pausa tra una ricerca e l'altra: iTunes accetta circa 20 ricerche al minuto.
export const PAUSE_MS = 3200;

const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// File da aprire con Excel (separatore ";" e virgola decimale, come piace a Excel in italiano).
export function csv(rows) {
  const head = ['Artista', 'Brano', 'Anno', 'ISRC', 'Da dove', 'Su iTunes', 'Prezzo €', 'Versione', 'Link'];
  const lines = rows.map(({ t, sources }) => {
    const r = resultOf(t.uri) || {};
    return [
      (t.artists || []).map((a) => a.name).join(', '), t.name, String(t.album?.release_date || '').slice(0, 4),
      t.external_ids?.isrc || '', sources.join(' | '), r.found ? 'sì' : 'no',
      r.price ? String(r.price).replace('.', ',') : '', r.found ? (r.variant ? 'versione diversa (live/remix)' : r.sameLength ? 'sì' : 'da verificare') : '', r.url || '',
    ].map(cell).join(';');
  });
  return '﻿' + [head.map(cell).join(';'), ...lines].join('\r\n');
}
