import * as auth from './auth.js?v=7';
import * as api from './api.js?v=7';
import * as folders from './folders.js?v=7';
import * as lib from './library.js?v=7';
import * as crit from './criteria.js?v=7';
import * as catalog from './catalog.js?v=7';
import * as tags from './tags.js?v=7';
import { ICONS } from './icons.js?v=8';

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

const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const SPOTIFY_APP = IS_IOS
  ? 'spotify:'
  : 'intent://open#Intent;scheme=spotify;package=com.spotify.music;S.browser_fallback_url=https%3A%2F%2Fopen.spotify.com%2F;end';

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
      // Su iPhone Spotify in secondo piano a volte non risponde subito ("dispositivo non trovato"): si riprova.
      if (!(e.status === 404 || e.status === 502 || e.status === 503) || i === 7) {
        toast(`Non parte: ${e.message}`);
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  toast(IS_IOS
    ? 'Spotify non risponde: aprilo, fai partire un brano qualsiasi, torna qui e premi di nuovo ▶'
    : 'Spotify non risponde: fai partire un brano qualsiasi in Spotify e riprova');
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
// Colore pastello sempre uguale per lo stesso nome.
const hue = (s) => [...String(s)].reduce((h, ch) => (h * 31 + ch.codePointAt(0)) % 360, 7);

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
  const hour = new Date().getHours();
  const hi = hour < 6 ? 'Buonanotte' : hour < 13 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const firstName = String(profile.display_name || profile.id).split(' ')[0];
  const mixes = crit.moods();
  app.innerHTML = `
    <section class="hello">
      ${profile.images?.[0]?.url ? `<img src="${esc(profile.images[0].url)}" alt="">` : `<div class="avatar">${ICONS.headphones}</div>`}
      <div>
        <h2>${hi}, ${esc(firstName)}</h2>
        <p class="muted small-text online">Collegato a Spotify</p>
      </div>
    </section>

    <div class="tiles">
      <button id="btn-criteria" class="tile t1"><span class="ico">${ICONS.dice}</span><b>Casuale con filtri</b><small>anni, generi, mood…</small></button>
      <button id="btn-rate" class="tile t2"><span class="ico">${ICONS.headphones}</span><b>Valuta</b><small>il brano in ascolto</small></button>
      <button id="btn-new" class="tile t3"><span class="ico">${ICONS.folderPlus}</span><b>Nuova cartella</b><small>di playlist</small></button>
      <button id="btn-catalog" class="tile t4"><span class="ico">${ICONS.deck}</span><b>Remix</b><small>${catalogRun ? 'ricerca in corso…' : 'catalogo da scaricare'}</small></button>
    </div>

    <section class="card">
      <div class="card-head"><h3>Cartelle <span class="count">${all.length || ''}</span></h3><button class="small" data-go="#/casuale">🎛️ Filtri</button></div>
      ${all.length ? '' : '<p class="muted small-text">Crea una cartella e mettici le playlist che vuoi: la stessa playlist può stare in più cartelle.</p>'}
      <ul class="list folders">
        ${all.map((f) => `
          <li data-f="${esc(f.id)}" class="tap">
            <div class="cover folder-ico" style="--h:${hue(f.name)}">${ICONS.folder}</div>
            <div class="txt">
              <span class="name">${esc(f.name)}</span>
              <span class="muted small-text">${nPlaylist(f.playlists.length)}${f.off.length ? ` · ${f.playlists.length - f.off.length} spuntate` : ''}</span>
            </div>
            <button class="play" data-play-f="${esc(f.id)}" aria-label="Casuale su ${esc(f.name)}">▶</button>
          </li>`).join('')}
      </ul>
    </section>

    <section class="card" ${mixes.length ? '' : 'hidden'}>
      <div class="card-head"><h3>I tuoi mix <span class="count">${mixes.length || ''}</span></h3></div>
      <ul class="list moods">
        ${mixes.map((m) => `
          <li data-m="${esc(m.id)}" class="tap">
            <div class="cover folder-ico" style="--h:${hue(m.name)}">${ICONS.dice}</div>
            <div class="txt"><span class="name">${esc(m.name)}</span><span class="muted small-text">${esc(describe(m.criteria))}</span></div>
            <button class="play" data-play-m="${esc(m.id)}" aria-label="Fai partire ${esc(m.name)}">▶</button>
          </li>`).join('')}
      </ul>
    </section>

    <section class="card">
      <div class="card-head"><h3>Le tue playlist <span class="count">${playlists.length}</span></h3></div>
      <ul class="list playlists">
        ${playlists.map((p, i) => `
          <li data-i="${i}" class="tap">
            ${cover(p.images)}
            <div class="txt"><span class="name">${esc(p.name)}</span><span class="muted small-text">${plSub(p)}</span></div>
            <button class="play" data-play="${i}" aria-label="Fai partire ${esc(p.name)} in casuale">▶</button>
          </li>`).join('')}
      </ul>
    </section>`;

  document.getElementById('btn-criteria').onclick = () => { location.hash = '#/casuale'; };
  app.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => { location.hash = b.dataset.go; }; });
  document.getElementById('btn-rate').onclick = () => rateNowPlaying();
  document.getElementById('btn-catalog').onclick = () => { location.hash = '#/catalogo'; };
  app.querySelector('.moods').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-play-m]');
    if (btn) { playMood(crit.moods().find((m) => m.id === btn.dataset.playM)); return; }
    const row = ev.target.closest('li[data-m]');
    if (row) location.hash = `#/casuale/${row.dataset.m}`;
  });
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
      <button id="btn-filters" class="primary soft" ${pls.length ? '' : 'disabled'}>🎛️ Casuale con filtri</button>
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
  document.getElementById('btn-filters').onclick = () => { location.hash = `#/casuale/cartella/${id}`; };
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

// ---------- Casuale con criteri ----------
const LAST_KEY = 'sp_last_criteria';
const readLast = () => { try { return JSON.parse(localStorage.getItem(LAST_KEY)) || {}; } catch { return {}; } };

const DECADE_LABEL = (d) => (d < 2000 ? `Anni '${String(d).slice(2)}` : `Anni ${d}`);
const yearsText = (c) => [...(c.decades || []).map((d) => (d < 2000 ? `'${String(d).slice(2)}` : String(d).slice(0, 3) + '0')), ...(c.years || [])].join(', ');

const OPTIONS = {
  origin: [['any', 'Indifferente'], ['it', '🇮🇹 Italiani'], ['foreign', '🌍 Stranieri']],
  explicit: [['any', 'Indifferente'], ['no', 'Senza parolacce'], ['only', 'Solo espliciti 🅴']],
  versions: [['any', 'Tutte'], ['orig', 'Solo originali'], ['only', 'Solo remix, live, sped up…']],
  feat: [['any', 'Indifferente'], ['solo', 'Artista da solo'], ['feat', 'Solo collaborazioni (feat.)']],
  liked: [['any', 'Indifferente'], ['yes', '💚 Solo quelli che ti piacciono'], ['no', 'Solo quelli non salvati']],
  vote: [['nodown', 'Salta i 👎'], ['up', 'Solo i 👍'], ['any', 'Tutti']],
  added: [['any', 'Indifferente'], ['month', 'Nell\'ultimo mese'], ['half', 'Negli ultimi 6 mesi'], ['old', 'Più di un anno fa']],
  pop: [['any', 'Indifferente'], ['hit', '🔝 Successi'], ['niche', '💎 Poco conosciuti']],
  listen: [['any', 'Indifferente'], ['fav', '⭐ I miei preferiti'], ['forgotten', '💤 Non li sento da tanto']],
  lengths: [['short', 'Corti (meno di 3 min)'], ['mid', 'Medi (3–5 min)'], ['long', 'Lunghi (più di 5 min)']],
  limit: [[0, 'Tutti'], [20, '20'], [50, '50'], [100, '100'], [200, '200']],
  minutes: [[0, 'Senza limite'], [30, '30 min'], [60, '1 ora'], [120, '2 ore'], [180, '3 ore']],
};
const optLabel = (k, v) => OPTIONS[k].find(([x]) => x === v)?.[1] || '';

function describe(c) {
  c = { ...crit.empty(), ...c };
  const p = [];
  if (c.source?.startsWith('folder:')) p.push('📁 ' + (folders.get(c.source.slice(7))?.name || 'cartella eliminata'));
  else if (c.source === 'liked') p.push('Brani che ti piacciono');
  if (c.decades.length || c.years.length) p.push(yearsText(c));
  if (c.yearFrom || c.yearTo) p.push(`${c.yearFrom || '…'}–${c.yearTo || '…'}`);
  const fams = c.famIn.map((f) => (f === crit.NO_GENRE ? 'senza genere' : tags.familyName(f)));
  const named = [...fams, ...c.genresIn];
  if (named.length) p.push(named.slice(0, 3).join(', ') + (named.length > 3 ? '…' : ''));
  if (c.moodsIn.length) p.push(c.moodsIn.map(tags.moodName).join(', '));
  if (c.artistsIn.length) p.push(`${c.artistsIn.length} ${c.artistsIn.length === 1 ? 'artista' : 'artisti'}`);
  if (c.genresOut.length || c.famOut.length || c.moodsOut.length || c.artistsOut.length) p.push('con esclusioni');
  for (const k of ['origin', 'explicit', 'versions', 'feat', 'liked', 'added', 'pop', 'listen']) if (c[k] !== 'any') p.push(optLabel(k, c[k]).replace(/^[^\p{L}\d']+/u, '').toLowerCase());
  if (c.vote === 'up') p.push('solo 👍');
  if (c.lengths.length) p.push(c.lengths.map((l) => optLabel('lengths', l).split(' (')[0].toLowerCase()).join('/'));
  if (c.skipRecent) p.push('niente ascolti recenti');
  if (c.limit) p.push(`${c.limit} brani`);
  if (c.minutes) p.push(optLabel('minutes', c.minutes));
  return p.join(' · ') || 'Tutto in casuale';
}

function poolFor(source) {
  if (source === 'liked') return lib.buildPool([], { liked: true });
  if (source.startsWith('folder:')) {
    const f = folders.get(source.slice(7));
    return lib.buildPool((f?.playlists || []).map(byId).filter((p) => p && isMine(p)));
  }
  return lib.buildPool(state.playlists.filter(isMine), { liked: true });
}

let listenReady = null;
const loadListening = () => (listenReady ??= Promise.all([lib.loadTop(), lib.syncHistory()]).catch(() => { listenReady = null; }));

// Prima di filtrare: generi degli artisti se servono, Brani che ti piacciono se servono.
const needsGenres = (c) => c.genresIn.length || c.genresOut.length || c.famIn.length || c.famOut.length
  || c.moodsIn.length || c.moodsOut.length || c.origin !== 'any';
const needsLiked = (c) => c.liked !== 'any' && !lib.likedKnown();

async function playFiltered(pool, c, deviceId) {
  const list = crit.pick(crit.filter(pool, c), c, MAX_MIX);
  if (!list.length) return 'Nessun brano corrisponde ai filtri';
  await api.playUris(list.map((t) => t.uri), deviceId);
  const min = Math.round(list.reduce((s, t) => s + (t.ms || 210_000), 0) / 60_000);
  return `▶ ${list.length} ${list.length === 1 ? 'brano' : 'brani'} in casuale (${min >= 90 ? `${Math.round(min / 6) / 10} ore` : `${min} min`})`;
}

// Fa partire un mix salvato direttamente dalla pagina principale.
function playMood(m) {
  if (!m) return;
  toast(`Preparo “${m.name}”…`, 15000);
  play(async (d) => {
    const c = { ...crit.empty(), ...m.criteria };
    const [pool] = await Promise.all([poolFor(c.source), loadListening(), needsLiked(c) ? lib.likedTracks().catch(() => {}) : null]);
    if (needsGenres(c)) await lib.fetchGenres(lib.missingArtists(pool)).catch(() => {});
    return playFiltered(pool, c, d);
  }, m.name);
}

// Tocco su un'etichetta a tre stati: niente → voglio (verde) → escludo (rosso) → niente.
function cycle(c, inKey, outKey, value) {
  if (c[inKey].includes(value)) {
    c[inKey] = c[inKey].filter((x) => x !== value);
    c[outKey] = [...c[outKey], value];
  } else if (c[outKey].includes(value)) {
    c[outKey] = c[outKey].filter((x) => x !== value);
  } else {
    c[inKey] = [...c[inKey], value];
  }
}

function triChip(label, value, c, inKey, outKey, n, extra = '') {
  const st = c[inKey].includes(value) ? 'on' : c[outKey].includes(value) ? 'off' : '';
  const mark = st === 'on' ? '✓ ' : st === 'off' ? '✕ ' : '';
  return `<button class="chip ${st} ${extra}" data-act="tri" data-in="${inKey}" data-out="${outKey}" data-v="${esc(value)}">${mark}${esc(label)}${n != null ? ` <span class="muted">${n}</span>` : ''}</button>`;
}
// Una sola scelta (es. Italiani / Stranieri).
const oneChips = (c, k) => OPTIONS[k].map(([v, l]) =>
  `<button class="chip ${c[k] === v ? 'on' : ''}" data-act="one" data-k="${k}" data-v="${v}" data-num="${typeof v === 'number' ? 1 : ''}">${l}</button>`).join('');
// Più scelte insieme (es. anni '80 e '90).
const manyChip = (c, k, v, label, n) =>
  `<button class="chip ${c[k].includes(v) ? 'on' : ''}" data-act="many" data-k="${k}" data-v="${v}" data-num="${typeof v === 'number' ? 1 : ''}">${c[k].includes(v) ? '✓ ' : ''}${esc(label)}${n != null ? ` <span class="muted">${n}</span>` : ''}</button>`;

async function showCriteria(moodId, source) {
  btnLogout.hidden = false;
  const mood = moodId ? crit.moods().find((m) => m.id === moodId) : null;
  const c = { ...crit.empty(), ...(mood ? mood.criteria : readLast()) };
  if (source) c.source = source;
  if (c.source.startsWith('folder:') && !folders.get(c.source.slice(7))) c.source = 'all';
  let here = location.hash;
  const stillHere = () => location.hash === here;
  const ctrl = new AbortController();
  window.addEventListener('hashchange', () => ctrl.abort(), { once: true });

  let pool = [], tl = crit.tally([]), genreStatus = '';
  const showAll = { genres: false, years: false, fams: false };

  app.innerHTML = `
    <button class="link back" onclick="location.hash=''">← Home</button>
    <section class="card">
      <h2>🎲 ${mood ? esc(mood.name) : 'Casuale con filtri'}</h2>
      <label for="src">Da dove prendo i brani</label>
      <select id="src">
        <option value="all">Tutte le tue playlist + Brani che ti piacciono</option>
        <option value="liked">Solo Brani che ti piacciono</option>
        ${folders.list().map((f) => `<option value="folder:${esc(f.id)}">📁 ${esc(f.name)}</option>`).join('')}
      </select>
      <div class="row between" style="margin-top:6px">
        <button id="btn-reset" class="link">Azzera i filtri</button>
        ${mood ? '<button id="btn-del-mood" class="link">Elimina questo mix</button>' : ''}
      </div>
    </section>
    <div id="crit-body"><p class="muted center">Carico i tuoi brani…</p></div>
    <div class="bottom-bar">
      <button id="btn-save" class="ghost">💾 Salva</button>
      <button id="btn-go" class="primary" disabled>▶ Fai partire</button>
    </div>`;
  window.scrollTo(0, 0);
  const body = document.getElementById('crit-body');
  const src = document.getElementById('src');
  src.value = c.source;

  const count = (k) => {
    const v = c[k];
    if (Array.isArray(v)) return v.length;
    return v && v !== crit.empty()[k] ? 1 : 0;
  };
  const sum = (...ks) => ks.reduce((s, k) => s + count(k), 0);
  const badge = (n) => (n ? `<span class="badge">${n}</span>` : '');

  // ---- Sezioni ----
  const secYears = () => {
    const ys = [...tl.years.keys()].sort((a, b) => b - a);
    const decades = new Map();
    for (const [y, n] of tl.years) { const d = Math.floor(y / 10) * 10; decades.set(d, (decades.get(d) || 0) + n); }
    const yList = showAll.years ? ys : ys.filter((y, i) => i < 12 || c.years.includes(y));
    const yMin = ys.at(-1) || 1950, yMax = ys[0] || new Date().getFullYear();
    const yOpts = (sel) => `<option value="">Qualsiasi</option>` + Array.from({ length: yMax - yMin + 1 }, (_, i) => yMin + i)
      .map((y) => `<option ${y === sel ? 'selected' : ''}>${y}</option>`).join('');
    return `
      <p class="muted small-text">Puoi sceglierne quanti vuoi: per esempio anni '80, anni '90 e il 2017.</p>
      <h4>Decenni</h4>
      <div class="chips">${[...decades.keys()].sort().map((d) => manyChip(c, 'decades', d, DECADE_LABEL(d), decades.get(d))).join('')}</div>
      <h4>Anni singoli</h4>
      <div class="chips">${yList.map((y) => manyChip(c, 'years', y, String(y), tl.years.get(y))).join('')}
        ${ys.length > 12 && !showAll.years ? `<button class="chip add" data-act="all" data-k="years">Tutti gli anni (${ys.length})</button>` : ''}</div>
      <h4>Oppure un intervallo</h4>
      <div class="row years"><label>Dal <select data-sel="yearFrom">${yOpts(c.yearFrom)}</select></label>
      <label>al <select data-sel="yearTo">${yOpts(c.yearTo)}</select></label></div>`;
  };

  const secGenres = () => {
    const chosen = new Set([...c.genresIn, ...c.genresOut]);
    const gList = showAll.genres ? tl.genres : tl.genres.filter((g, i) => i < 20 || chosen.has(g.name));
    const fams = tl.fams.filter((f) => f.name !== crit.NO_GENRE);
    const none = tl.fams.find((f) => f.name === crit.NO_GENRE);
    return `
      <p class="muted small-text">Tocca una volta per volerlo (✓), un'altra per escluderlo (✕), un'altra per tornare neutro.</p>
      <p class="muted small-text">${esc(genreStatus)}</p>
      <div class="chips">
        ${fams.map((f) => triChip(tags.familyName(f.name), f.name, c, 'famIn', 'famOut', f.n)).join('')}
        ${none ? triChip('Senza genere', crit.NO_GENRE, c, 'famIn', 'famOut', none.n) : ''}
      </div>
      ${none && !genreStatus ? `<p class="muted small-text">${none.n === 1 ? '1 brano non ha' : `${none.n} brani non hanno`} un genere su Spotify: quando li ascolti puoi indicarlo tu con “🎧 Valuta il brano in ascolto”.</p>` : ''}
      <details ${chosen.size ? 'open' : ''}>
        <summary>Generi precisi di Spotify (${tl.genres.length})</summary>
        <div class="chips">
          ${gList.map((g) => triChip(g.name, g.name, c, 'genresIn', 'genresOut', g.n)).join('')}
          ${tl.genres.length > 20 && !showAll.genres ? `<button class="chip add" data-act="all" data-k="genres">Mostra tutti (${tl.genres.length})</button>` : ''}
        </div>
      </details>`;
  };

  const secMoods = () => `
    <p class="muted small-text">Spotify non dice più se un brano è energico o tranquillo: il mood parte da un'ipotesi fatta sul genere e diventa preciso con le tue valutazioni. Hai valutato <b>${tags.ratedCount()}</b> ${tags.ratedCount() === 1 ? 'brano' : 'brani'}.</p>
    <div class="chips">${tags.allMoods().map((m) => triChip(m.name, m.id, c, 'moodsIn', 'moodsOut', tl.moods.get(m.id) || 0)).join('')}</div>
    <button class="small" data-act="rate">🎧 Valuta il brano in ascolto</button>`;

  const secArtists = () => {
    const q = (document.getElementById('a-q')?.value || '').trim().toLowerCase();
    const chosen = new Set([...c.artistsIn, ...c.artistsOut]);
    const list = q
      ? tl.artists.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 30)
      : tl.artists.filter((a, i) => i < 20 || chosen.has(a.id));
    return list.map((a) => triChip(a.name, a.id, c, 'artistsIn', 'artistsOut', a.n)).join('')
      || '<span class="muted small-text">Nessun artista trovato</span>';
  };

  const secListen = () => `
    <h4>Quanto li ascolti</h4><div class="chips">${oneChips(c, 'listen')}</div>
    <label class="check" style="margin-top:12px"><input type="checkbox" data-chk="skipRecent" ${c.skipRecent ? 'checked' : ''}> Salta i brani ascoltati da poco</label>
    <h4>Brani che ti piacciono</h4><div class="chips">${oneChips(c, 'liked')}</div>
    <h4>Le tue valutazioni</h4><div class="chips">${oneChips(c, 'vote')}</div>
    <h4>Messi in playlist</h4><div class="chips">${oneChips(c, 'added')}</div>
    <p class="muted small-text">Spotify fa vedere solo i tuoi 50 brani più ascoltati e gli ultimi 50 ascolti. Ogni volta che apri l'app li aggiungo a uno storico sul telefono, quindi questi filtri diventano più precisi col tempo.</p>`;

  const secOther = () => `
    <h4>Provenienza</h4><div class="chips">${oneChips(c, 'origin')}</div>
    <p class="muted small-text">Secondo i generi di Spotify (es. “rap italiano”).</p>
    <h4>Durata</h4><div class="chips">${OPTIONS.lengths.map(([v, l]) => manyChip(c, 'lengths', v, l, pool.filter((t) => crit.lengthOf(t) === v).length)).join('')}</div>
    <h4>Versione</h4><div class="chips">${oneChips(c, 'versions')}</div>
    <h4>Artisti</h4><div class="chips">${oneChips(c, 'feat')}</div>
    <h4>Testi</h4><div class="chips">${oneChips(c, 'explicit')}</div>
    ${pool.some((t) => t.popularity != null) ? `<h4>Fama</h4><div class="chips">${oneChips(c, 'pop')}</div>` : ''}`;

  const secHow = () => `
    <h4>Quanti brani</h4><div class="chips">${oneChips(c, 'limit')}</div>
    <h4>Quanto deve durare</h4><div class="chips">${oneChips(c, 'minutes')}</div>
    <label class="check" style="margin-top:12px"><input type="checkbox" data-chk="spread" ${c.spread ? 'checked' : ''}> Mai lo stesso artista due volte di fila</label>`;

  const SECTIONS = [
    ['years', '📅 Anni', secYears, () => sum('decades', 'years', 'yearFrom', 'yearTo'), true],
    ['genres', '🎵 Generi', secGenres, () => sum('famIn', 'famOut', 'genresIn', 'genresOut'), true],
    ['moods', '🌈 Mood', secMoods, () => sum('moodsIn', 'moodsOut'), true],
    ['artists', '🎤 Artisti', secArtists, () => sum('artistsIn', 'artistsOut'), false],
    ['listen', '⭐ Ascolti e valutazioni', secListen, () => sum('listen', 'skipRecent', 'liked', 'added') + (c.vote === 'up' ? 1 : 0), false],
    ['other', '🧩 Altri filtri', secOther, () => sum('origin', 'lengths', 'versions', 'feat', 'explicit', 'pop'), false],
    ['how', '⏱️ Quanti e come', secHow, () => sum('limit', 'minutes'), false],
  ];

  const update = () => {
    localStorage.setItem(LAST_KEY, JSON.stringify(c));
    const n = crit.filter(pool, c).length;
    const go = document.getElementById('btn-go');
    go.disabled = !n;
    const shown = crit.pick(crit.filter(pool, c), c, MAX_MIX).length;
    go.textContent = n ? `▶ Ascolta ${shown} ${shown === 1 ? 'brano' : 'brani'}` : 'Nessun brano';
    go.title = shown < n ? `${shown} scelti a caso tra ${n}` : '';
  };

  const refresh = (only) => {
    for (const [id, , fn, badgeFn] of SECTIONS) {
      if (only && !only.includes(id)) continue;
      const box = document.getElementById(`sec-${id}`);
      if (!box) continue;
      box.innerHTML = fn();
      document.getElementById(`b-${id}`).innerHTML = badge(badgeFn());
    }
    update();
  };

  const render = () => {
    body.innerHTML = SECTIONS.map(([id, title, , , open]) => `
      <details class="card sec" ${open ? 'open' : ''}>
        <summary><h3>${title} <span id="b-${id}"></span></h3></summary>
        ${id === 'artists' ? '<input id="a-q" placeholder="Cerca un artista…" autocomplete="off" style="margin-bottom:10px">' : ''}
        <div id="sec-${id}" class="${id === 'artists' ? 'chips' : ''}"></div>
      </details>`).join('');
    refresh();
    document.getElementById('a-q').addEventListener('input', () => refresh(['artists']));
  };

  body.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-act]');
    if (!b) return;
    const { act, k } = b.dataset;
    const v = b.dataset.num ? Number(b.dataset.v) : b.dataset.v;
    if (act === 'tri') cycle(c, b.dataset.in, b.dataset.out, v);
    else if (act === 'one') c[k] = v;
    else if (act === 'many') c[k] = c[k].includes(v) ? c[k].filter((x) => x !== v) : [...c[k], v];
    else if (act === 'all') showAll[k] = true;
    else if (act === 'rate') { rateNowPlaying(() => { if (stillHere()) { tl = crit.tally(pool); refresh(); } }); return; }
    if (k === 'liked' && needsLiked(c)) {
      b.textContent = 'Leggo i Brani che ti piacciono…';
      await lib.likedTracks().catch(() => toast('Non riesco a leggere i Brani che ti piacciono'));
    }
    refresh();
  });
  body.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.sel) { c[el.dataset.sel] = Number(el.value) || null; refresh(['years']); }
    if (el.dataset.chk) { c[el.dataset.chk] = el.checked; refresh(); }
  });

  const loadGenres = async () => {
    const missing = lib.missingArtists(pool);
    if (!missing.length) return;
    let last = 0;
    try {
      await lib.fetchGenres(missing, (d, t) => {
        genreStatus = `Leggo i generi degli artisti: ${d} di ${t} (solo la prima volta)`;
        if (!stillHere()) return;
        if (d - last >= 25 || d === t) { last = d; tl = crit.tally(pool); refresh(['genres', 'moods']); }
      }, ctrl.signal);
      genreStatus = '';
    } catch (e) {
      genreStatus = e.reason === 'QUOTA_EXCEEDED'
        ? 'Spotify ha messo in pausa le richieste: i generi che mancano li leggo la prossima volta.'
        : '';
    }
    if (stillHere()) { tl = crit.tally(pool); refresh(); }
  };

  const load = async () => {
    body.innerHTML = '<p class="muted center">Carico i tuoi brani…</p>';
    document.getElementById('btn-go').disabled = true;
    try {
      [pool] = await Promise.all([poolFor(c.source), loadListening(), needsLiked(c) ? lib.likedTracks().catch(() => {}) : null]);
    } catch (e) {
      body.innerHTML = `<section class="card"><p class="error">Non riesco a leggere i brani: ${esc(e.message)}</p></section>`;
      return;
    }
    if (!stillHere()) return;
    tl = crit.tally(pool);
    render();
    loadGenres();
  };

  src.onchange = () => { c.source = src.value; load(); };
  document.getElementById('btn-reset').onclick = () => {
    Object.assign(c, crit.empty(), { source: c.source });
    refresh();
    toast('Filtri azzerati');
  };
  document.getElementById('btn-go').onclick = () => {
    const label = mood?.name || 'Casuale con filtri';
    play((d) => playFiltered(pool, c, d), label);
  };
  document.getElementById('btn-save').onclick = async () => {
    const name = await askName('Salva come mix', mood?.name || '');
    if (!name) return;
    const m = crit.saveMood(name, structuredClone(c));
    history.replaceState(null, '', `#/casuale/${m.id}`);
    here = location.hash;
    toast(`Mix “${name}” salvato: lo trovi nella pagina principale`);
  };
  document.getElementById('btn-del-mood')?.addEventListener('click', async () => {
    if (await confirmSheet(`Eliminare il mix “${mood.name}”?`, 'Elimina')) {
      crit.removeMood(mood.id);
      location.hash = '';
    }
  });

  load();
}

// ---------- Valuta il brano in ascolto: 👍/👎, mood e genere dell'artista ----------
async function rateNowPlaying(onSaved) {
  let t;
  try { t = await api.nowPlaying(); } catch (e) { toast(`Non riesco a sapere cosa stai ascoltando: ${e.message}`); return; }
  if (!t?.uri || t.type === 'episode') { toast('In questo momento non sta suonando nessun brano'); return; }
  const track = { uri: t.uri, name: t.name, artists: (t.artists || []).map((a) => ({ id: a.id, name: a.name })) };
  await lib.fetchGenres(lib.missingArtists([track])).catch(() => {});

  const old = tags.ratingOf(track.uri) || { v: 0, m: [], x: [] };
  const r = { v: old.v, m: [...old.m], x: [...old.x] };
  const main = track.artists[0];
  let fams = [...tags.artistFamilies(main?.id)];
  const spotifyFams = new Set(tags.familiesOf({ ...track, artists: track.artists.map((a) => ({ id: a.id })) }).filter((f) => !fams.includes(f)));
  const guessed = new Set(tags.moodsOf(track));

  const s = sheet('<div id="rate"></div>');
  const box = s.el.querySelector('#rate');
  const draw = () => {
    box.innerHTML = `
      <div class="pl-head" style="margin-bottom:10px">
        ${t.album?.images?.length ? `<img class="cover" style="width:64px;height:64px;border-radius:6px" src="${esc(t.album.images.at(-1).url)}" alt="">` : ''}
        <div><b>${esc(track.name)}</b><p class="muted small-text">${esc(track.artists.map((a) => a.name).join(', '))}</p></div>
      </div>
      <div class="row">
        <button class="chip big ${r.v === 1 ? 'on' : ''}" data-v="1">👍 Mi piace</button>
        <button class="chip big ${r.v === -1 ? 'off' : ''}" data-v="-1">👎 Non mi piace</button>
      </div>
      <h4>Che mood ha?</h4>
      <p class="muted small-text">✓ = sì, ✕ = no. Quelli tratteggiati sono un'ipotesi dell'app.</p>
      <div class="chips" id="r-moods">
        ${tags.allMoods().map((m) => {
          const st = r.m.includes(m.id) ? 'on' : r.x.includes(m.id) ? 'off' : guessed.has(m.id) ? 'guess' : '';
          return `<button class="chip ${st}" data-m="${esc(m.id)}">${st === 'on' ? '✓ ' : st === 'off' ? '✕ ' : ''}${esc(m.name)}</button>`;
        }).join('')}
        <button class="chip add" data-newm>+ Nuovo mood</button>
      </div>
      ${main ? `<h4>Genere di ${esc(main.name)}</h4>
      <p class="muted small-text">${spotifyFams.size ? 'Quelli tratteggiati li dice già Spotify; puoi aggiungerne altri.' : 'Spotify non indica un genere per questo artista: sceglilo tu.'}</p>
      <div class="chips" id="r-fams">
        ${tags.FAMILIES.map((f) => `<button class="chip ${fams.includes(f.id) ? 'on' : spotifyFams.has(f.id) ? 'guess' : ''}" data-f="${f.id}">${fams.includes(f.id) ? '✓ ' : ''}${esc(f.name)}</button>`).join('')}
      </div>` : ''}
      <div class="row">
        <button class="ghost" data-x>Annulla</button>
        <button class="primary" data-ok>Salva</button>
      </div>
      <button class="small" data-next style="width:100%">Salva e passa al prossimo ⏭</button>`;
  };
  draw();

  box.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.v) { const v = Number(b.dataset.v); r.v = r.v === v ? 0 : v; draw(); return; }
    if (b.dataset.m) {
      const id = b.dataset.m;
      const st = r.m.includes(id) ? 'on' : r.x.includes(id) ? 'off' : '';
      r.m = r.m.filter((x) => x !== id); r.x = r.x.filter((x) => x !== id);
      if (st === '') r.m.push(id); else if (st === 'on') r.x.push(id);
      draw(); return;
    }
    if (b.dataset.newm !== undefined) {
      s.el.parentElement.hidden = true;
      const name = await askName('Nuovo mood');
      s.el.parentElement.hidden = false;
      document.body.classList.add('no-scroll');
      if (name) { const id = tags.addMood(name); if (!r.m.includes(id)) r.m.push(id); }
      draw(); return;
    }
    if (b.dataset.f) { const f = b.dataset.f; fams = fams.includes(f) ? fams.filter((x) => x !== f) : [...fams, f]; draw(); return; }
    if (b.dataset.x !== undefined) { s.close(); return; }
    if (b.dataset.ok !== undefined || b.dataset.next !== undefined) {
      tags.rate(track, r);
      if (main) tags.setArtistFamilies(main.id, fams);
      s.close();
      let msg = 'Valutazione salvata';
      if (r.v === 1 && old.v !== 1 && !lib.isLiked(track.uri)) {
        try { await api.saveToLibrary([track.uri]); lib.markLiked(track.uri); msg += ' e aggiunto ai Brani che ti piacciono 💚'; }
        catch (e) { msg += ` (non sono riuscito ad aggiungerlo ai Brani che ti piacciono: ${e.message})`; }
      }
      if (b.dataset.next !== undefined) await api.nextTrack().catch(() => {});
      toast(msg);
      onSaved?.();
    }
  });
}

// ---------- Catalogo per remix e mashup ----------
let catalogRun = null; // ricerca in corso: { stop: bool }

async function showCatalog() {
  btnLogout.hidden = false;
  const here = location.hash;
  app.innerHTML = `
    <button class="link back" onclick="location.hash=''">← Home</button>
    <section class="card">
      <h2>🎛️ Catalogo per remix</h2>
      <p class="muted small-text">Controllo quali dei brani che ascolti di più si possono <b>comprare e scaricare</b> su iTunes Italia, per creare la tua libreria personale da remixare. A iTunes mando solo artista e titolo.</p>
    </section>
    <div id="cat-body"><p class="muted center">Guardo cosa hai ascoltato ultimamente…</p></div>`;
  window.scrollTo(0, 0);
  const body = document.getElementById('cat-body');

  // 1. Ascolti e brani più ascoltati
  let top;
  try {
    await loadListening();
    top = await lib.loadTop();
  } catch (e) {
    body.innerHTML = `<section class="card"><p class="error">Non riesco a leggere i tuoi ascolti: ${esc(e.message)}</p></section>`;
    return;
  }
  const topRecent = new Set([...top.short_term, ...top.medium_term]);

  // 2. Punteggio "ascoltata ultimamente" di ogni playlist tua: 5 punti per ogni ultimo ascolto
  //    partito da lì, 1 punto per ogni suo brano tra i tuoi più ascoltati dell'ultimo periodo.
  const mine = state.playlists.filter(isMine);
  const plTracks = new Map();
  let done = 0;
  await Promise.all(mine.map(async (p) => {
    try { plTracks.set(p.id, await api.playlistTracksCached(p)); } catch { plTracks.set(p.id, []); }
    done++;
    if (stillOn()) body.innerHTML = `<p class="muted center">Leggo le tue playlist: ${done} di ${mine.length}…</p>`;
  }));
  function stillOn() { return location.hash === here; }
  if (!stillOn()) return;

  const plScore = (p) => 5 * lib.playsFrom(p.id) + (plTracks.get(p.id) || []).filter((t) => topRecent.has(t.uri)).length;

  // Gruppi tra cui scegliere
  const groups = [];
  const topTracks = [...top.items.short_term, ...top.items.medium_term];
  groups.push({ key: 'top', label: '⭐ I tuoi più ascoltati (ultimo mese e ultimi 6 mesi)', tracks: topTracks, on: true, score: 99 });
  groups.push({ key: 'recent', label: '🕑 I tuoi ultimi 50 ascolti', tracks: lib.recentList(), on: true, score: 98 });
  const inFolders = new Set();
  for (const f of folders.list()) {
    const pls = f.playlists.map(byId).filter((p) => p && isMine(p));
    pls.forEach((p) => inFolders.add(p.id));
    const score = pls.reduce((s, p) => s + plScore(p), 0);
    groups.push({ key: 'f:' + f.id, label: `📁 ${f.name}`, tracks: pls.flatMap((p) => plTracks.get(p.id) || []), on: score > 0, score, folder: true });
  }
  const others = mine.filter((p) => !inFolders.has(p.id) && plScore(p) > 0).sort((a, b) => plScore(b) - plScore(a));
  for (const p of others) {
    groups.push({ key: 'p:' + p.id, label: `🎵 ${p.name}`, tracks: plTracks.get(p.id) || [], on: true, score: plScore(p) });
  }
  groups.sort((a, b) => b.score - a.score);

  const stars = (s) => (s >= 98 ? '' : s >= 20 ? ' · ascoltata molto di recente' : s >= 5 ? ' · ascoltata di recente' : s > 0 ? ' · ascoltata un po\'' : ' · non ascoltata di recente');

  const selection = () => {
    const rows = new Map();
    for (const g of groups.filter((x) => x.on)) {
      for (const t of g.tracks) {
        if (!t?.uri || t.is_local) continue;
        const r = rows.get(t.uri) || { t, sources: [] };
        r.sources.push(g.label.replace(/^\S+\s/, ''));
        rows.set(t.uri, r);
      }
    }
    return [...rows.values()];
  };

  const render = () => {
    const rows = selection();
    const todo = rows.filter((r) => !catalog.isChecked(r.t.uri));
    const checked = rows.filter((r) => catalog.isChecked(r.t.uri));
    const found = checked.filter((r) => catalog.resultOf(r.t.uri).found);
    const priced = found.filter((r) => catalog.resultOf(r.t.uri).price);
    const cost = priced.reduce((s, r) => s + catalog.resultOf(r.t.uri).price, 0);
    const minutes = Math.ceil((todo.length * catalog.PAUSE_MS) / 60000);
    const running = !!catalogRun;
    const euro = (n) => n.toFixed(2).replace('.', ',') + ' €';
    const line = (r) => {
      const res = catalog.resultOf(r.t.uri);
      const who = esc((r.t.artists || []).map((a) => a.name).join(', '));
      return `<li><span class="txt"><span class="name">${esc(r.t.name)}</span><span class="muted small-text">${who}${res?.price ? ' · ' + euro(res.price) : ''}${res?.variant ? ' · c’è solo una versione live/remix' : res?.found && !res.sameLength ? ' · durata diversa, da verificare' : ''}</span></span>
        ${res?.url ? `<a class="chip" href="${esc(res.url)}" target="_blank" rel="noopener">iTunes ↗</a>` : ''}</li>`;
    };

    body.innerHTML = `
      <section class="card">
        <h3>Da dove prendo i brani</h3>
        <p class="muted small-text">Ho messo in ordine le cartelle e le playlist da quelle che hai ascoltato di più ultimamente.</p>
        <ul class="list pick-groups">
          ${groups.map((g, i) => `
            <li><label class="check">
              <input type="checkbox" data-g="${i}" ${g.on ? 'checked' : ''} ${running ? 'disabled' : ''}>
              <span class="txt"><span class="name">${esc(g.label)}</span>
              <span class="muted small-text">${new Set(g.tracks.map((t) => t?.uri)).size} brani${stars(g.score)}</span></span>
            </label></li>`).join('')}
        </ul>
      </section>

      <section class="card">
        <h3>Ricerca su iTunes</h3>
        <p><b>${rows.length}</b> brani scelti · <b>${checked.length}</b> già controllati · <b>${todo.length}</b> da controllare</p>
        ${running ? `
          <div class="progress"><div style="width:${rows.length ? (100 * checked.length) / rows.length : 0}%"></div></div>
          <p class="muted small-text">Tieni l'app aperta e lo schermo acceso. Se la chiudi, la prossima volta riparto da dove ero arrivato.</p>
          <button id="btn-stop" class="ghost">Ferma</button>`
        : todo.length ? `<button id="btn-run" class="primary">🔎 Controlla ${todo.length} brani (circa ${minutes} min)</button>` : ''}
      </section>

      ${checked.length ? `
      <section class="card">
        <h3>Risultato${todo.length ? ' (parziale)' : ''}</h3>
        <div class="stats">
          <div><b>${found.length}</b><span>su ${checked.length} trovati</span></div>
          <div><b>${checked.length ? Math.round((100 * found.length) / checked.length) : 0}%</b><span>scaricabili</span></div>
          <div><b>${euro(cost)}</b><span>per comprarli tutti</span></div>
        </div>
        <table class="by-group">
          <tr><th>Da dove</th><th>Trovati</th></tr>
          ${groups.filter((g) => g.on).map((g) => {
            const uris = [...new Set(g.tracks.map((t) => t?.uri).filter(Boolean))].filter((u) => catalog.isChecked(u));
            const f = uris.filter((u) => catalog.resultOf(u).found).length;
            return `<tr><td>${esc(g.label)}</td><td>${f} / ${uris.length}</td></tr>`;
          }).join('')}
        </table>
        <details><summary>Non trovati (${checked.length - found.length})</summary><ul class="list plain">${checked.filter((r) => !catalog.resultOf(r.t.uri).found).map(line).join('')}</ul></details>
        <details><summary>Trovati (${found.length})</summary><ul class="list plain">${found.map(line).join('')}</ul></details>
        <button id="btn-csv" class="small">📄 Scarica l'elenco (Excel)</button>
      </section>` : ''}`;

    body.querySelectorAll('input[data-g]').forEach((cb) => {
      cb.onchange = () => { groups[cb.dataset.g].on = cb.checked; render(); };
    });
    document.getElementById('btn-stop')?.addEventListener('click', () => { if (catalogRun) catalogRun.stop = true; });
    document.getElementById('btn-csv')?.addEventListener('click', () => {
      const blob = new Blob([catalog.csv(rows)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `catalogo-remix-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
    document.getElementById('btn-run')?.addEventListener('click', () => run(todo));
  };

  const run = async (todo) => {
    const job = { stop: false, redraw: render };
    catalogRun = job;
    let lock = null;
    try { lock = await navigator.wakeLock?.request('screen'); } catch { /* non supportato */ }
    render();
    let lastDraw = 0;
    for (const r of todo) {
      if (job.stop) break;
      await catalog.check(r.t);
      if (location.hash === '#/catalogo' && Date.now() - lastDraw > 1500) { lastDraw = Date.now(); job.redraw(); }
      await new Promise((res) => setTimeout(res, catalog.PAUSE_MS));
    }
    catalogRun = null;
    lock?.release?.().catch(() => {});
    if (location.hash === '#/catalogo') { job.redraw(); toast(job.stop ? 'Ricerca fermata: riprendi quando vuoi' : 'Ricerca finita ✓'); }
  };

  if (catalogRun) catalogRun.redraw = render; // ricerca partita prima: questa pagina mostra il suo avanzamento
  render();
}

function fmtTime(ms) {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function route() {
  const h = location.hash;
  app.classList.remove('enter');
  void app.offsetWidth; // riavvia l'animazione
  app.classList.add('enter');
  let m;
  if ((m = h.match(/^#\/playlist\/(\w+)/))) showPlaylist(m[1]);
  else if ((m = h.match(/^#\/cartella\/(\w+)/))) showFolder(m[1]);
  else if ((m = h.match(/^#\/casuale\/cartella\/(\w+)$/))) showCriteria(null, `folder:${m[1]}`);
  else if ((m = h.match(/^#\/casuale(?:\/(\w+))?$/))) showCriteria(m[1]);
  else if (h === '#/catalogo') showCatalog();
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
