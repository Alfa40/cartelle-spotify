import * as auth from './auth.js?v=2';
import * as api from './api.js?v=2';

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
    await run(device.id);
    toast(`▶ ${label}`);
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
        await job.run(device.id);
        toast(`▶ ${job.label}`);
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

// ---------- Schermata 3: le playlist ----------
let state = { profile: null, playlists: [] };

const isMine = (p) => p.owner?.id === state.profile.id || p.collaborative;
const cover = (images, cls = 'cover') => images?.length
  ? `<img class="${cls}" src="${esc((cls === 'big-cover' ? images[0] : images.at(-1)).url)}" alt="" loading="lazy">`
  : `<div class="${cls}"></div>`;

async function loadAccount() {
  app.innerHTML = '<p class="muted center">Leggo il tuo account…</p>';
  const [profile, playlists] = await Promise.all([api.me(), api.myPlaylists()]);
  state = { profile, playlists };
}

function showHome() {
  btnLogout.hidden = false;
  const { profile, playlists } = state;
  const mine = playlists.filter(isMine).length;
  app.innerHTML = `
    <section class="card profile">
      ${profile.images?.[0]?.url ? `<img src="${esc(profile.images[0].url)}" alt="">` : '<div class="avatar"></div>'}
      <div>
        <h2>Ciao ${esc(profile.display_name || profile.id)}</h2>
        <p class="muted">Collegato a Spotify ✓</p>
      </div>
    </section>

    <section class="card">
      <h3>Le tue playlist (${playlists.length})</h3>
      <p class="muted small-text">Tocca una playlist per vedere i brani, ▶ per farla partire in casuale.
        ${playlists.length - mine ? `Delle ${playlists.length - mine} playlist di altri Spotify fa vedere solo il nome.` : ''}</p>
      <ul class="list">
        ${playlists.map((p, i) => `
          <li data-i="${i}" class="tap">
            ${cover(p.images)}
            <div class="txt">
              <span class="name">${esc(p.name)}</span>
              <span class="muted small-text">${api.trackCount(p)} brani${isMine(p) ? '' : ' · di ' + esc(p.owner?.display_name || 'altri')}</span>
            </div>
            <button class="play" data-play="${i}" aria-label="Fai partire ${esc(p.name)} in casuale">▶</button>
          </li>`).join('')}
      </ul>
    </section>`;

  app.querySelector('.list').addEventListener('click', (ev) => {
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

async function showPlaylist(id) {
  btnLogout.hidden = false;
  const p = state.playlists.find((x) => x.id === id);
  if (!p) { location.hash = ''; return; }

  const head = `
    <button class="link back" onclick="history.back()">← Playlist</button>
    <section class="card pl-head">
      ${cover(p.images, 'big-cover')}
      <div>
        <h2>${esc(p.name)}</h2>
        <p class="muted small-text">${api.trackCount(p)} brani${isMine(p) ? '' : ' · di ' + esc(p.owner?.display_name || 'altri')}</p>
        <button id="btn-shuffle" class="primary">▶ Casuale</button>
      </div>
    </section>`;

  app.innerHTML = head + '<p id="loading" class="muted center">Carico i brani…</p>';
  document.getElementById('btn-shuffle').onclick = () => play((d) => api.playShuffled(p, d), `${p.name} in casuale`);
  window.scrollTo(0, 0);

  if (!isMine(p)) {
    app.insertAdjacentHTML('beforeend', `<section class="card"><p class="muted">Questa playlist è di ${esc(p.owner?.display_name || 'un altro utente')}: dal 2026 Spotify non fa più vedere i brani delle playlist di altri alle app come questa. Puoi comunque farla partire con ▶ Casuale.</p></section>`);
    document.getElementById('loading')?.remove();
    return;
  }

  let tracks;
  try {
    tracks = await api.playlistTracks(p.id);
  } catch (e) {
    document.getElementById('loading').textContent = `Non riesco a leggere i brani: ${e.message}`;
    return;
  }
  if (location.hash !== `#/playlist/${id}`) return; // l'utente è già tornato indietro

  document.getElementById('loading').remove();
  app.insertAdjacentHTML('beforeend', `
    <section class="card">
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
    </section>`);

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
  const m = location.hash.match(/^#\/playlist\/(\w+)/);
  if (m) showPlaylist(m[1]); else showHome();
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
