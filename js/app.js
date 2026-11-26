import * as auth from './auth.js?v=3';
import * as api from './api.js?v=3';
import * as folders from './folders.js?v=3';

const app = document.getElementById('app');
const btnLogout = document.getElementById('btn-logout');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, ms = 3500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), ms);
}

btnLogout.addEventListener('click', () => {
  auth.logout();
  start();
});

// ---------- Schermata 1: inserire il Client ID ----------
function showSetup(message) {
  btnLogout.hidden = true;
  const uri = auth.redirectUri();
  app.innerHTML = `
    <section class="card">
      <h2>Collega la tua app Spotify</h2>
      ${message ? `<p class="error">${esc(message)}</p>` : ''}
      <ol class="steps">
        <li>Apri <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> ed entra con il tuo account Spotify.</li>
        <li>Premi <b>Create app</b>. Nome e descrizione come vuoi.</li>
        <li>In <b>Redirect URIs</b> incolla questo indirizzo e premi <b>Add</b>:
          <div class="copy"><code id="uri">${esc(uri)}</code><button id="btn-copy" class="small">Copia</button></div>
        </li>
        <li>In <b>Which API/SDKs</b> spunta <b>Web API</b>, accetta le condizioni e salva.</li>
        <li>Apri <b>Settings</b> dell'app, copia il <b>Client ID</b> e incollalo qui sotto.</li>
      </ol>
      <label for="client-id">Client ID</label>
      <input id="client-id" autocomplete="off" spellcheck="false" placeholder="es. 1a2b3c4d…" value="${esc(auth.getClientId())}">
      <button id="btn-save" class="primary">Salva e collegati</button>
    </section>`;

  document.getElementById('btn-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(uri); toast('Indirizzo copiato'); }
    catch { toast('Tieni premuto sull\'indirizzo per copiarlo'); }
  };
  document.getElementById('btn-save').onclick = () => {
    const id = document.getElementById('client-id').value.trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) {
      toast('Il Client ID è fatto di 32 caratteri (numeri e lettere a-f)');
      return;
    }
    auth.setClientId(id);
    auth.login();
  };
}

// ---------- Schermata 2: collegarsi ----------
function showLogin(message) {
  btnLogout.hidden = true;
  app.innerHTML = `
    <section class="card center">
      <h2>Accedi a Spotify</h2>
      ${message ? `<p class="error">${esc(message)}</p>` : ''}
      <p class="muted">L'app ti chiederà il permesso di leggere le tue playlist, i tuoi ascolti e di comandare la riproduzione.</p>
      <button id="btn-login" class="primary">Collegati a Spotify</button>
      <button id="btn-change" class="link">Cambia Client ID</button>
    </section>`;
  document.getElementById('btn-login').onclick = () => auth.login();
  document.getElementById('btn-change').onclick = () => showSetup();
}

// ---------- Riproduzione: trova un dispositivo, se non c'è apre Spotify ----------
// Spotify si può comandare solo dove la sua app è accesa. Se non c'è nessun dispositivo,
// apriamo l'app Spotify e, quando l'utente torna qui, facciamo partire la musica.
let pendingPlay = null; // { run: (deviceId) => Promise, label }

const SPOTIFY_APP = 'intent://open#Intent;scheme=spotify;package=com.spotify.music;S.browser_fallback_url=https%3A%2F%2Fopen.spotify.com%2F;end';

function pickDevice(list) {
  return list.find((d) => d.is_active)
    || list.find((d) => d.type === 'Smartphone')
    || list[0];
}

async function play(run, label) {
  try {
    const device = pickDevice(await api.devices());
    if (!device) {
      pendingPlay = { run, label, since: Date.now() };
      toast('Apro Spotify… torna qui e la musica parte da sola', 6000);
      location.href = SPOTIFY_APP;
      return;
    }
    const msg = await run(device.id);
    toast(msg || `▶ ${label}`);
  } catch (e) {
    toast(e.reason === 'PREMIUM_REQUIRED' ? 'Per far partire la musica serve Spotify Premium' : `Non parte: ${e.message}`);
  }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !pendingPlay) return;
  const job = pendingPlay;
  pendingPlay = null;
  if (Date.now() - job.since > 5 * 60_000) return; // richiesta troppo vecchia, lasciamo stare
  toast('Cerco Spotify…', 10000);
  // Appena aperta, l'app Spotify può metterci qualche secondo a farsi vedere.
  for (let i = 0; i < 8; i++) {
    try {
      const device = pickDevice(await api.devices());
      if (device) {
        const msg = await job.run(device.id);
        toast(msg || `▶ ${job.label}`);
        return;
      }
    } catch (e) {
      toast(`Non parte: ${e.message}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  toast('Spotify non risponde: fai partire un brano qualsiasi in Spotify e riprova');
});

// ---------- Dati dell'account ----------
let state = { profile: null, playlists: [] };

const isMine = (p) => p.owner?.id === state.profile.id || p.collaborative;
const byId = (id) => state.playlists.find((p) => p.id === id);
const cover = (images, cls = 'cover') => images?.length
  ? `<img class="${cls}" src="${esc((cls === 'big-cover' ? images[0] : images.at(-1)).url)}" alt="" loading="lazy">`
  : `<div class="${cls}"></div>`;
const plSub = (p) => `${api.trackCount(p)} brani${isMine(p) ? '' : ' · di ' + esc(p.owner?.display_name || 'altri')}`;
const nPlaylist = (n) => `${n} playlist`;

async function loadAccount() {
  app.innerHTML = '<p class="muted center">Leggo il tuo account…</p>';
  const [profile, playlists] = await Promise.all([api.me(), api.myPlaylists()]);
  state = { profile, playlists };
  folders.prune(playlists.map((p) => p.id));
}

// ---------- Casuale su più playlist ----------
const MAX_MIX = 400; // brani mandati a Spotify in una volta

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Mescola i brani delle playlist scelte e li fa partire. Le playlist di altri non si possono
// leggere: se ci sono solo quelle se ne fa partire una a caso, altrimenti si saltano.
async function playMix(pls, deviceId) {
  if (pls.length === 1) { await api.playShuffled(pls[0], deviceId); return null; }
  const readable = pls.filter(isMine);
  const skipped = pls.length - readable.length;
  if (!readable.length) {
    const p = pls[Math.floor(Math.random() * pls.length)];
    await api.playShuffled(p, deviceId);
    return `▶ ${p.name} (scelta a caso: le playlist di altri non si possono mescolare)`;
  }
  const lists = await Promise.all(readable.map((p) => api.playlistTracksCached(p)));
  const uris = shuffle([...new Set(lists.flat().map((t) => t.uri))]).slice(0, MAX_MIX);
  if (!uris.length) return 'Le playlist scelte sono vuote';
  await api.playUris(uris, deviceId);
  return `▶ ${uris.length} brani mescolati da ${nPlaylist(readable.length)}`
    + (skipped ? ` · ${skipped} di altri ${skipped === 1 ? 'saltata' : 'saltate'}` : '');
}

function playFolder(f) {
  const pls = f.playlists.filter((id) => !f.off.includes(id)).map(byId).filter(Boolean);
  if (!pls.length) { toast('Spunta almeno una playlist della cartella'); return; }
  if (pls.length > 1) toast('Preparo il mix…', 10000);
  play((d) => playMix(pls, d), `${f.name} in casuale`);
}

// ---------- Finestrelle (nome cartella, conferme, scelta playlist) ----------
function sheet(html) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.append(wrap);
  document.body.classList.add('no-scroll');
  const close = () => { wrap.remove(); document.body.classList.remove('no-scroll'); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  return { el: wrap.querySelector('.sheet'), close };
}

function askName(title, initial = '') {
  return new Promise((resolve) => {
    const s = sheet(`
      <h3>${esc(title)}</h3>
      <input id="sheet-name" maxlength="60" placeholder="es. Palestra, Viaggio, Relax" value="${esc(initial)}">
      <div class="row"><button class="ghost" data-x>Annulla</button><button class="primary" data-ok>Salva</button></div>`);
    const input = s.el.querySelector('input');
    const done = (v) => { s.close(); resolve(v); };
    s.el.querySelector('[data-x]').onclick = () => done(null);
    s.el.querySelector('[data-ok]').onclick = () => { const v = input.value.trim(); if (v) done(v); else input.focus(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') s.el.querySelector('[data-ok]').click(); });
    setTimeout(() => input.focus(), 50);
  });
}

function confirmSheet(text, okLabel) {
  return new Promise((resolve) => {
    const s = sheet(`<p>${esc(text)}</p>
      <div class="row"><button class="ghost" data-x>Annulla</button><button class="primary danger" data-ok>${esc(okLabel)}</button></div>`);
    s.el.querySelector('[data-x]').onclick = () => { s.close(); resolve(false); };
    s.el.querySelector('[data-ok]').onclick = () => { s.close(); resolve(true); };
  });
}

// Elenco di tutte le playlist con le spunte: scegli quali stanno nella cartella.
function pickPlaylists(f) {
  return new Promise((resolve) => {
    const inside = new Set(f.playlists);
    const s = sheet(`
      <h3>Playlist in “${esc(f.name)}”</h3>
      <input id="pick-filter" placeholder="Cerca…" autocomplete="off">
      <ul class="list pick">
        ${state.playlists.map((p) => `
          <li data-name="${esc(p.name.toLowerCase())}">
            <label class="check">
              <input type="checkbox" value="${esc(p.id)}" ${inside.has(p.id) ? 'checked' : ''}>
              ${cover(p.images)}
              <span class="txt"><span class="name">${esc(p.name)}</span><span class="muted small-text">${plSub(p)}</span></span>
            </label>
          </li>`).join('')}
      </ul>
      <div class="row"><button class="primary" data-ok>Fatto</button></div>`);
    s.el.querySelector('#pick-filter').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      s.el.querySelectorAll('.pick li').forEach((li) => { li.hidden = q && !li.dataset.name.includes(q); });
    });
    s.el.querySelector('[data-ok]').onclick = () => {
      for (const cb of s.el.querySelectorAll('.pick input[type=checkbox]')) {
        if (cb.checked !== inside.has(cb.value)) folders.setMember(f.id, cb.value, cb.checked);
      }
      s.close();
      resolve();
    };
  });
}

async function newFolder(withPlaylist) {
  const name = await askName('Nuova cartella');
  if (!name) return null;
  const f = folders.create(name, withPlaylist ? [withPlaylist] : []);
  toast(`Cartella “${name}” creata`);
  return f;
}

// ---------- Pagina principale ----------
function showHome() {
  btnLogout.hidden = false;
  const { profile, playlists } = state;
  const all = folders.list();
  app.innerHTML = `
    <section class="card profile slim">
      ${profile.images?.[0]?.url ? `<img src="${esc(profile.images[0].url)}" alt="">` : '<div class="avatar"></div>'}
      <div><b>${esc(profile.display_name || profile.id)}</b> <span class="muted small-text">· collegato a Spotify ✓</span></div>
    </section>

    <section class="card">
      <h3>Cartelle</h3>
      ${all.length ? '' : '<p class="muted small-text">Crea una cartella e mettici le playlist che vuoi: la stessa playlist può stare in più cartelle.</p>'}
      <ul class="list folders">
        ${all.map((f) => `
          <li data-f="${esc(f.id)}" class="tap">
            <div class="cover folder-ico">📁</div>
            <div class="txt">
              <span class="name">${esc(f.name)}</span>
              <span class="muted small-text">${nPlaylist(f.playlists.length)}${f.off.length ? ` · ${f.playlists.length - f.off.length} spuntate` : ''}</span>
            </div>
            <button class="play" data-play-f="${esc(f.id)}" aria-label="Casuale su ${esc(f.name)}">▶</button>
          </li>`).join('')}
      </ul>
      <button id="btn-new" class="small">+ Nuova cartella</button>
    </section>

    <section class="card">
      <h3>Tutte le playlist (${playlists.length})</h3>
      <ul class="list playlists">
        ${playlists.map((p, i) => `
          <li data-i="${i}" class="tap">
            ${cover(p.images)}
            <div class="txt"><span class="name">${esc(p.name)}</span><span class="muted small-text">${plSub(p)}</span></div>
            <button class="play" data-play="${i}" aria-label="Fai partire ${esc(p.name)} in casuale">▶</button>
          </li>`).join('')}
      </ul>
    </section>`;

  document.getElementById('btn-new').onclick = async () => {
    const f = await newFolder();
    if (f) location.hash = `#/cartella/${f.id}`;
  };
  app.querySelector('.folders').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-play-f]');
    if (btn) { playFolder(folders.get(btn.dataset.playF)); return; }
    const row = ev.target.closest('li[data-f]');
    if (row) location.hash = `#/cartella/${row.dataset.f}`;
  });
  app.querySelector('.playlists').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-play]');
    if (btn) {
      const p = playlists[btn.dataset.play];
      play((id) => api.playShuffled(p, id), `${p.name} in casuale`);
      return;
    }
    const row = ev.target.closest('li[data-i]');
    if (row) location.hash = `#/playlist/${playlists[row.dataset.i].id}`;
  });
}

// ---------- Pagina di una cartella ----------
function showFolder(id) {
  btnLogout.hidden = false;
  const f = folders.get(id);
  if (!f) { location.hash = ''; return; }
  const pls = f.playlists.map(byId).filter(Boolean);
  const on = pls.filter((p) => !f.off.includes(p.id));
  const others = on.filter((p) => !isMine(p)).length;

  app.innerHTML = `
    <button class="link back" onclick="location.hash=''">← Home</button>
    <section class="card">
      <h2>📁 ${esc(f.name)}</h2>
      <p class="muted small-text">${nPlaylist(pls.length)} · ${on.length} spuntate per il casuale</p>
      <button id="btn-play" class="primary" ${on.length ? '' : 'disabled'}>▶ Casuale ${on.length === pls.length ? 'su tutto' : `su ${nPlaylist(on.length)}`}</button>
      ${others && on.length > 1 ? `<p class="muted small-text note">${others === 1 ? '1 playlist spuntata è' : `${others} playlist spuntate sono`} di altri: Spotify non ci fa leggere i loro brani, quindi nel mix vengono saltate.</p>` : ''}
      <div class="row tools">
        <button id="btn-edit" class="small">+ Aggiungi / togli playlist</button>
        <button id="btn-rename" class="small">Rinomina</button>
        <button id="btn-delete" class="small">Elimina</button>
      </div>
    </section>

    ${pls.length ? `
    <section class="card">
      <div class="row between">
        <h3>Playlist</h3>
        <span><button class="link" id="btn-all">Tutte</button><button class="link" id="btn-none">Nessuna</button></span>
      </div>
      <ul class="list in-folder">
        ${pls.map((p) => `
          <li>
            <label class="check-only" aria-label="Includi ${esc(p.name)} nel casuale">
              <input type="checkbox" value="${esc(p.id)}" ${f.off.includes(p.id) ? '' : 'checked'}>
            </label>
            <a class="row-link" href="#/playlist/${esc(p.id)}">
              ${cover(p.images)}
              <span class="txt"><span class="name">${esc(p.name)}</span><span class="muted small-text">${plSub(p)}</span></span>
            </a>
          </li>`).join('')}
      </ul>
    </section>` : '<section class="card"><p class="muted">La cartella è vuota: premi “+ Aggiungi / togli playlist”.</p></section>'}`;
  window.scrollTo(0, 0);

  document.getElementById('btn-play').onclick = () => playFolder(folders.get(id));
  document.getElementById('btn-edit').onclick = async () => { await pickPlaylists(folders.get(id)); showFolder(id); };
  document.getElementById('btn-rename').onclick = async () => {
    const name = await askName('Rinomina cartella', f.name);
    if (name) { folders.rename(id, name); showFolder(id); }
  };
  document.getElementById('btn-delete').onclick = async () => {
    if (await confirmSheet(`Eliminare la cartella “${f.name}”? Le playlist su Spotify non vengono toccate.`, 'Elimina')) {
      folders.remove(id);
      location.hash = '';
    }
  };
  if (!pls.length) return;
  document.getElementById('btn-all').onclick = () => { folders.setAllIncluded(id, true); showFolder(id); };
  document.getElementById('btn-none').onclick = () => { folders.setAllIncluded(id, false); showFolder(id); };
  app.querySelector('.in-folder').addEventListener('change', (ev) => {
    folders.setIncluded(id, ev.target.value, ev.target.checked);
    const y = window.scrollY;
    showFolder(id);
    window.scrollTo(0, y);
  });
}

// ---------- Pagina di una playlist ----------
async function showPlaylist(id) {
  btnLogout.hidden = false;
  const p = byId(id);
  if (!p) { location.hash = ''; return; }

  app.innerHTML = `
    <button class="link back" onclick="history.length > 1 ? history.back() : (location.hash='')">← Indietro</button>
    <section class="card pl-head">
      ${cover(p.images, 'big-cover')}
      <div>
        <h2>${esc(p.name)}</h2>
        <p class="muted small-text">${plSub(p)}</p>
        <button id="btn-shuffle" class="primary">▶ Casuale</button>
      </div>
    </section>
    <section class="card">
      <h3>Nelle cartelle</h3>
      <div id="chips" class="chips"></div>
    </section>
    <p id="loading" class="muted center">Carico i brani…</p>`;
  window.scrollTo(0, 0);
  document.getElementById('btn-shuffle').onclick = () => play((d) => api.playShuffled(p, d), `${p.name} in casuale`);

  const renderChips = () => {
    const box = document.getElementById('chips');
    if (!box) return;
    box.innerHTML = folders.list().map((f) => `
      <button class="chip ${f.playlists.includes(p.id) ? 'on' : ''}" data-f="${esc(f.id)}" aria-pressed="${f.playlists.includes(p.id)}">
        ${f.playlists.includes(p.id) ? '✓ ' : ''}${esc(f.name)}</button>`).join('')
      + '<button class="chip add" data-new>+ Nuova</button>';
  };
  renderChips();
  document.getElementById('chips').addEventListener('click', async (ev) => {
    const chip = ev.target.closest('button');
    if (!chip) return;
    if (chip.dataset.new !== undefined) { await newFolder(p.id); renderChips(); return; }
    const f = folders.get(chip.dataset.f);
    folders.setMember(f.id, p.id, !f.playlists.includes(p.id));
    renderChips();
  });

  if (!isMine(p)) {
    document.getElementById('loading').outerHTML = `<section class="card"><p class="muted">Questa playlist è di ${esc(p.owner?.display_name || 'un altro utente')}: dal 2026 Spotify non fa più vedere i brani delle playlist di altri alle app come questa. Puoi comunque farla partire con ▶ Casuale.</p></section>`;
    return;
  }

  let tracks;
  try {
    tracks = await api.playlistTracksCached(p);
  } catch (e) {
    const el = document.getElementById('loading');
    if (el) el.textContent = `Non riesco a leggere i brani: ${e.message}`;
    return;
  }
  const loading = document.getElementById('loading');
  if (!loading || location.hash !== `#/playlist/${id}`) return; // l'utente è già andato altrove

  loading.outerHTML = `
    <section class="card">
      <h3>Brani</h3>
      <ul class="list tracks">
        ${tracks.map((t, i) => `
          <li data-t="${i}" class="tap">
            ${cover(t.album?.images)}
            <div class="txt">
              <span class="name">${esc(t.name)}</span>
              <span class="muted small-text">${esc(t.artists?.map((a) => a.name).join(', '))}</span>
            </div>
            <span class="muted small-text">${fmtTime(t.duration_ms)}</span>
          </li>`).join('') || '<li class="muted">Playlist vuota</li>'}
      </ul>
    </section>`;

  app.querySelector('.tracks').addEventListener('click', (ev) => {
    const row = ev.target.closest('li[data-t]');
    if (!row) return;
    const t = tracks[row.dataset.t];
    play((d) => api.playFromTrack(p, t.uri, d), t.name);
  });
}

function fmtTime(ms) {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function route() {
  const h = location.hash;
  let m;
  if ((m = h.match(/^#\/playlist\/(\w+)/))) showPlaylist(m[1]);
  else if ((m = h.match(/^#\/cartella\/(\w+)/))) showFolder(m[1]);
  else showHome();
}

async function showConnected() {
  await loadAccount();
  window.onhashchange = route;
  route();
}

// ---------- Avvio ----------
async function start() {
  const redirectError = await auth.handleRedirect();
  if (!auth.getClientId()) return showSetup(redirectError);
  if (!auth.isLoggedIn()) return showLogin(redirectError);
  try {
    await showConnected();
  } catch (e) {
    if (!auth.isLoggedIn()) return showLogin('Il collegamento è scaduto, collegati di nuovo.');
    app.innerHTML = `<section class="card"><p class="error">Errore: ${esc(e.message)}</p><button id="btn-retry" class="primary">Riprova</button></section>`;
    document.getElementById('btn-retry').onclick = start;
  }
}

start();
