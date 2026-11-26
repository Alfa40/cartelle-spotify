// Collegamento a Spotify con "Authorization Code + PKCE":
// non serve nessun server e nessuna chiave segreta, solo il Client ID (che è pubblico).

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Tutti i permessi che serviranno all'app, chiesti subito per non dover ricollegarsi dopo.
const SCOPES = [
  'user-read-private',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'user-library-read',
  'user-library-modify',
  'user-top-read',
  'user-read-recently-played',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
].join(' ');

const K = {
  clientId: 'sp_client_id',
  verifier: 'sp_pkce_verifier',
  state: 'sp_pkce_state',
  token: 'sp_token',
};

// L'indirizzo di ritorno è la cartella della pagina, es. https://utente.github.io/app/
export function redirectUri() {
  return new URL('.', location.href).href;
}

export function getClientId() {
  return localStorage.getItem(K.clientId) || '';
}

export function setClientId(id) {
  localStorage.setItem(K.clientId, id.trim());
}

function randomString(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function challengeFrom(verifier) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function login() {
  const verifier = randomString(64);
  const state = randomString(16);
  // localStorage (non sessionStorage): su Android il ritorno può aprirsi in un'altra scheda.
  localStorage.setItem(K.verifier, verifier);
  localStorage.setItem(K.state, state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: getClientId(),
    scope: SCOPES,
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: await challengeFrom(verifier),
    state,
  });
  location.assign(`${AUTH_URL}?${params}`);
}

function saveToken(data) {
  const old = readToken();
  const token = {
    access_token: data.access_token,
    // Spotify a volte non rimanda un nuovo refresh_token: in quel caso si tiene il vecchio.
    refresh_token: data.refresh_token || old?.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  };
  localStorage.setItem(K.token, JSON.stringify(token));
  return token;
}

function readToken() {
  try { return JSON.parse(localStorage.getItem(K.token)); } catch { return null; }
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || `Errore ${res.status}`);
    err.code = data.error;
    throw err;
  }
  return data;
}

// Da chiamare all'avvio: se Spotify ci ha appena rimandato qui con ?code=..., completa l'accesso.
// Restituisce un messaggio d'errore leggibile, oppure null.
export async function handleRedirect() {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');
  if (!code && !error) return null;

  // Pulisce l'indirizzo, così ricaricando la pagina non si ripete l'operazione.
  history.replaceState(null, '', redirectUri());

  if (error) {
    return error === 'access_denied' ? 'Hai annullato l\'accesso a Spotify.' : `Spotify ha risposto: ${error}`;
  }
  if (state !== localStorage.getItem(K.state)) {
    return 'Il ritorno da Spotify non corrisponde alla richiesta. Riprova a collegarti.';
  }
  try {
    const data = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: getClientId(),
      code_verifier: localStorage.getItem(K.verifier),
    });
    saveToken(data);
    return null;
  } catch (e) {
    return `Accesso non riuscito: ${e.message}`;
  } finally {
    localStorage.removeItem(K.verifier);
    localStorage.removeItem(K.state);
  }
}

export function isLoggedIn() {
  return !!readToken()?.refresh_token;
}

let refreshing = null;

export async function refresh() {
  // Se più richieste scadono insieme, si fa un solo rinnovo.
  if (!refreshing) {
    refreshing = (async () => {
      const old = readToken();
      if (!old?.refresh_token) throw new Error('Non collegato');
      try {
        return saveToken(await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: old.refresh_token,
          client_id: getClientId(),
        }));
      } catch (e) {
        if (e.code === 'invalid_grant') logout(); // collegamento revocato o scaduto
        throw e;
      }
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function getAccessToken() {
  let token = readToken();
  if (!token) throw new Error('Non collegato');
  if (Date.now() > token.expires_at - 60_000) token = await refresh();
  return token.access_token;
}

export function logout() {
  localStorage.removeItem(K.token);
}
