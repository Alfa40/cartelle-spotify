// Cartelle di playlist, salvate sul telefono (localStorage).
// Una cartella: { id, name, playlists: [idPlaylist...], off: [idPlaylist esclusi dal casuale] }
// La stessa playlist può stare in più cartelle.

const KEY = 'sp_folders';

export function list() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}

function save(folders) {
  localStorage.setItem(KEY, JSON.stringify(folders));
}

function update(id, fn) {
  const folders = list();
  const f = folders.find((x) => x.id === id);
  if (f) { fn(f); save(folders); }
  return f;
}

export const get = (id) => list().find((f) => f.id === id);

export function create(name, playlists = []) {
  const f = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, playlists, off: [] };
  save([...list(), f]);
  return f;
}

export const rename = (id, name) => update(id, (f) => { f.name = name; });

export function remove(id) {
  save(list().filter((f) => f.id !== id));
}

export function setMember(id, playlistId, inside) {
  return update(id, (f) => {
    f.playlists = f.playlists.filter((p) => p !== playlistId);
    f.off = f.off.filter((p) => p !== playlistId);
    if (inside) f.playlists.push(playlistId);
  });
}

// Spunta / togli la spunta a una playlist per il casuale della cartella.
export function setIncluded(id, playlistId, included) {
  return update(id, (f) => {
    f.off = f.off.filter((p) => p !== playlistId);
    if (!included) f.off.push(playlistId);
  });
}

export function setAllIncluded(id, included) {
  return update(id, (f) => { f.off = included ? [] : [...f.playlists]; });
}

// Toglie dalle cartelle le playlist che non esistono più su Spotify.
export function prune(existingIds) {
  const ok = new Set(existingIds);
  const folders = list();
  let changed = false;
  for (const f of folders) {
    const before = f.playlists.length;
    f.playlists = f.playlists.filter((p) => ok.has(p));
    f.off = f.off.filter((p) => ok.has(p));
    if (f.playlists.length !== before) changed = true;
  }
  if (changed) save(folders);
}
