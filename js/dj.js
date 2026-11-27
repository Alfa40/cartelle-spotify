// DJ AI: collegamento tra l'app e il PC di casa.
// - Col PC acceso: si parla direttamente col PC tramite Tailscale (indirizzo e chiave stanno nella cartella privata GitHub).
// - Col PC spento: la richiesta va nella cartella privata GitHub Alfa40/dj-coda e il PC la prende appena si accende.
// - I remix scaricati restano sul telefono (IndexedDB) e si ascoltano anche col PC spento.

const REPO = 'Alfa40/dj-coda';
const K = { token: 'sp_dj_token', cfg: 'sp_dj_cfg', brani: 'sp_dj_brani', preset: 'sp_dj_preset', remix: 'sp_dj_remix', attesa: 'sp_dj_attesa' };
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

export const PRESET_BASE = [
  ['sporca', 'Sporca', 'edit'], ['edit-dj', 'Edit per DJ', 'edit'], ['remix-drill', 'Remix drill', 'remix'],
  ['remix-trap', 'Remix trap', 'remix'], ['remix-afrohouse', 'Remix afro house', 'remix'], ['remix-reggaeton', 'Remix reggaeton', 'remix'],
  ['remix-jerseyclub', 'Remix jersey club', 'remix'], ['remix-techno', 'Remix techno', 'remix'], ['remix-house', 'Remix house', 'remix'],
  ['mashup', 'Mashup', 'mashup'], ['sped-up', 'Sped up', 'velocita'], ['slowed-reverb', 'Slowed + reverb', 'velocita'], ['bassi', 'Bassi pesanti', 'velocita'],
].map(([id, nome, tipo]) => ({ id, nome, tipo, descrizione: '' }));

export const token = () => localStorage.getItem(K.token) || '';
export const configured = () => !!token() && !!read(K.cfg, null);
export const cached = {
  brani: () => read(K.brani, []),
  preset: () => read(K.preset, null) || PRESET_BASE,
  remix: () => read(K.remix, []),
  attesa: () => read(K.attesa, []),
};

// ---------- GitHub (cartella privata) ----------
async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const msg = res.status === 401 ? 'la chiave GitHub non è valida o è scaduta'
      : res.status === 404 ? 'la chiave GitHub non vede la cartella dj-coda (controlla i permessi)'
        : `GitHub risponde ${res.status}`;
    throw new Error(msg);
  }
  return res.json();
}
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

// Salva la chiave GitHub e legge da lì indirizzo del PC e chiave del servizio.
export async function setToken(t) {
  localStorage.setItem(K.token, t.trim());
  try {
    const f = await gh('contents/config.json');
    write(K.cfg, JSON.parse(unb64(f.content)));
  } catch (e) {
    localStorage.removeItem(K.token);
    throw e;
  }
}
export function forget() { Object.values(K).forEach((k) => localStorage.removeItem(k)); }

// ---------- PC (tramite Tailscale) ----------
async function pc(path, { method = 'GET', body, timeout = 6000, raw = false } = {}) {
  const cfg = read(K.cfg, null);
  if (!cfg) throw new Error('DJ AI non configurato');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(cfg.pc + path, {
      method, signal: ctl.signal,
      headers: { 'X-Chiave': cfg.chiave, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Il PC risponde ${res.status}`);
    return raw ? res : res.json();
  } finally { clearTimeout(t); }
}

// Il PC è acceso? Se sì aggiorna anche brani, preset, remix e stato delle richieste.
export async function refresh() {
  try {
    await pc('/api/stato', { timeout: 4000 });
  } catch { return false; }
  const [brani, preset, remix, richieste] = await Promise.all([pc('/api/brani'), pc('/api/preset'), pc('/api/remix'), pc('/api/richieste')]);
  write(K.brani, brani);
  write(K.preset, preset);
  write(K.remix, remix);
  const stato = new Map(richieste.map((r) => [r.id, r]));
  write(K.attesa, cached.attesa().map((a) => (stato.has(a.id) ? { ...a, ...pick(stato.get(a.id)) } : a)));
  return true;
}
const pick = (r) => ({ stato: r.stato, messaggio: r.messaggio || '', remix: r.remix || null });

// Manda una richiesta: al PC se è acceso, altrimenti nella cartella GitHub.
export async function send(req, online) {
  const r = { ...req, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), creata: new Date().toISOString() };
  let via = 'pc';
  if (online) {
    try { await pc('/api/richiesta', { method: 'POST', body: r }); } catch { via = 'github'; }
  } else via = 'github';
  if (via === 'github') {
    await gh(`contents/richieste/${r.id}.json`, { method: 'PUT', body: JSON.stringify({ message: 'Richiesta dal telefono', content: b64(JSON.stringify(r)) }) });
  }
  const a = { ...r, stato: via === 'pc' ? 'in coda' : 'in attesa del PC', via };
  write(K.attesa, [a, ...cached.attesa()].slice(0, 60));
  return a;
}
export function dismiss(id) { write(K.attesa, cached.attesa().filter((a) => a.id !== id)); }

// ---------- Audio salvato sul telefono ----------
let dbp = null;
const db = () => (dbp ??= new Promise((ok, ko) => {
  const r = indexedDB.open('dj-ai', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('audio');
  r.onsuccess = () => ok(r.result);
  r.onerror = () => ko(r.error);
}));
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((ok, ko) => {
    const t = d.transaction('audio', mode);
    const req = fn(t.objectStore('audio'));
    t.oncomplete = () => ok(req?.result);
    t.onerror = () => ko(t.error);
  });
};
export const savedFiles = async () => new Set(await tx('readonly', (s) => s.getAllKeys()));
export async function audioUrl(file) {
  let blob = await tx('readonly', (s) => s.get(file));
  if (!blob) {
    const res = await pc(`/api/audio/${file}`, { raw: true, timeout: 120000 });
    blob = await res.blob();
    await tx('readwrite', (s) => s.put(blob, file));
  }
  return URL.createObjectURL(blob);
}
export const removeAudio = (file) => tx('readwrite', (s) => s.delete(file));
