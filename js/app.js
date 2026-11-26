import * as auth from './auth.js';
import * as api from './api.js';

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

// ---------- Schermata 3: collegato, prova del collegamento ----------
async function showConnected() {
  btnLogout.hidden = false;
  app.innerHTML = '<p class="muted center">Leggo il tuo account…</p>';

  const [profile, playlists] = await Promise.all([api.me(), api.myPlaylists()]);
  const owned = playlists.filter((p) => p.owner?.id === profile.id || p.collaborative);

  app.innerHTML = `
    <section class="card profile">
      ${profile.images?.[0]?.url ? `<img src="${esc(profile.images[0].url)}" alt="">` : '<div class="avatar"></div>'}
      <div>
        <h2>Ciao ${esc(profile.display_name || profile.id)}</h2>
        <p class="muted">Collegato a Spotify ✓</p>
      </div>
    </section>

    <section class="card">
      <h3>Dove suonare</h3>
      <div id="devices" class="muted">Cerco i dispositivi…</div>
      <button id="btn-devices" class="small">Aggiorna</button>
    </section>

    <section class="card">
      <h3>Le tue playlist (${playlists.length})</h3>
      <p class="muted small-text">${owned.length} tue o in collaborazione · ${playlists.length - owned.length} di altri (Spotify ci fa vedere solo il nome, ma si possono far partire)</p>
      <ul class="playlists">
        ${playlists.map((p, i) => `
          <li>
            ${p.images?.[0]?.url ? `<img src="${esc(p.images.at(-1).url)}" alt="" loading="lazy">` : '<div class="cover"></div>'}
            <div class="pl-text">
              <span class="pl-name">${esc(p.name)}</span>
              <span class="muted small-text">${api.trackCount(p)} brani${owned.includes(p) ? '' : ' · di ' + esc(p.owner?.display_name || 'altri')}</span>
            </div>
            <button class="play" data-i="${i}" aria-label="Fai partire ${esc(p.name)} in casuale">▶</button>
          </li>`).join('')}
      </ul>
    </section>`;

  let deviceList = [];
  const renderDevices = async () => {
    const box = document.getElementById('devices');
    try {
      deviceList = await api.devices();
      box.innerHTML = deviceList.length
        ? deviceList.map((d) => `<div>${d.is_active ? '🔊' : '·'} ${esc(d.name)} <span class="muted">(${esc(d.type)})</span></div>`).join('')
        : 'Nessun dispositivo trovato. Apri l\'app Spotify sul telefono e premi play su qualsiasi brano, poi premi Aggiorna.';
    } catch (e) {
      box.textContent = `Non riesco a leggere i dispositivi: ${e.message}`;
    }
  };
  document.getElementById('btn-devices').onclick = renderDevices;
  renderDevices();

  app.querySelector('.playlists').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button.play');
    if (!btn) return;
    const p = playlists[btn.dataset.i];
    if (!deviceList.length) await renderDevices();
    const device = deviceList.find((d) => d.is_active) || deviceList[0];
    if (!device) { toast('Apri prima l\'app Spotify sul telefono'); return; }
    try {
      await api.playShuffled(p, device.id);
      toast(`▶ ${p.name} in casuale su ${device.name}`);
      renderDevices();
    } catch (e) {
      toast(e.reason === 'PREMIUM_REQUIRED' ? 'Per far partire la musica serve Spotify Premium' : `Non parte: ${e.message}`);
    }
  });
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
