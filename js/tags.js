// Generi "semplici" (rap, trap, jazz...), mood (vivace, aggressivo...) e valutazioni dei brani.
// Spotify non dà più l'energia o la ballabilità dei brani: il mood parte da un'ipotesi fatta sul genere
// e diventa più preciso con le tue valutazioni (brano per brano e, di riflesso, artista per artista).
import { genresOf } from './library.js?v=14';

// ---------- Famiglie di generi ----------
// Spotify dà generi molto precisi ("trap italiana", "italian hip hop"...): li raggruppiamo.
// Un brano può stare in più famiglie (es. trap italiana → Trap e Rap / Hip hop).
export const FAMILIES = [
  { id: 'rap', name: 'Rap / Hip hop', re: /hip ?hop|\brap\b|boom bap|grime/, moods: ['sportivo', 'notturno'] },
  { id: 'trap', name: 'Trap', re: /\btrap\b/, moods: ['aggressivo', 'sportivo', 'notturno'] },
  { id: 'drill', name: 'Drill', re: /\bdrill\b/, moods: ['aggressivo', 'sportivo'] },
  { id: 'pop', name: 'Pop', re: /\bpop\b|k-pop/, moods: ['vivace', 'felice'] },
  { id: 'rnb', name: 'R&B / Soul', re: /r&b|\brnb\b|soul/, moods: ['romantico', 'notturno'] },
  { id: 'jazz', name: 'Jazz', re: /jazz|bebop|\bswing\b|bossa nova/, moods: ['rilassato', 'concentrazione'] },
  { id: 'smoothjazz', name: 'Smooth jazz', re: /smooth jazz|smooth soul|jazz fusion|lounge/, moods: ['rilassato', 'romantico', 'concentrazione'] },
  { id: 'funk', name: 'Funk / Disco', re: /funk|disco|boogie|nu-disco/, moods: ['festa', 'felice', 'vivace'] },
  { id: 'dance', name: 'Dance / EDM', re: /\bdance\b|edm|eurodance|big room|electro ?pop/, moods: ['festa', 'vivace', 'sportivo'] },
  { id: 'house', name: 'House', re: /house/, moods: ['festa', 'vivace', 'notturno'] },
  { id: 'techno', name: 'Techno', re: /techno|\btrance\b|hardstyle|hard dance/, moods: ['notturno', 'festa', 'sportivo'] },
  { id: 'electronic', name: 'Elettronica', re: /electro|electronic|elettronic|dubstep|drum and bass|\bdnb\b|garage|ambient|synthwave/, moods: ['vivace', 'notturno'] },
  { id: 'latin', name: 'Reggaeton / Latino', re: /reggaeton|latin|urbano|bachata|salsa|cumbia|dembow|\bperreo\b/, moods: ['festa', 'vivace'] },
  { id: 'afro', name: 'Afro / Amapiano', re: /afro|amapiano/, moods: ['festa', 'vivace'] },
  { id: 'reggae', name: 'Reggae / Dancehall', re: /reggae|dancehall|\bska\b|dub\b/, moods: ['rilassato', 'felice'] },
  { id: 'rock', name: 'Rock', re: /rock|grunge|britpop/, moods: ['vivace', 'sportivo'] },
  { id: 'metal', name: 'Metal', re: /metal|deathcore|djent/, moods: ['aggressivo', 'sportivo'] },
  { id: 'punk', name: 'Punk / Emo', re: /punk|\bemo\b|hardcore/, moods: ['aggressivo', 'vivace'] },
  { id: 'indie', name: 'Indie', re: /indie|alternative|alt /, moods: ['rilassato', 'malinconico'] },
  { id: 'cantautori', name: 'Cantautori', re: /cantautor|singer-songwriter/, moods: ['malinconico', 'romantico'] },
  { id: 'neomelodico', name: 'Neomelodico', re: /neomelodic|canzone napoletana/, moods: ['romantico'] },
  { id: 'lofi', name: 'Lo-fi / Chill', re: /lo-?fi|chill|downtempo|trip hop/, moods: ['rilassato', 'concentrazione'] },
  { id: 'classical', name: 'Classica', re: /classical|classica|orchestra|baroque|opera|piano/, moods: ['concentrazione', 'rilassato'] },
  { id: 'soundtrack', name: 'Colonne sonore', re: /soundtrack|score|video game|anime/, moods: ['concentrazione'] },
  { id: 'blues', name: 'Blues', re: /blues/, moods: ['malinconico'] },
  { id: 'folk', name: 'Folk / Country', re: /folk|country|bluegrass|americana/, moods: ['rilassato'] },
  { id: 'gospel', name: 'Gospel / Cristiana', re: /gospel|christian|worship/, moods: ['felice'] },
];
const FAMILY = new Map(FAMILIES.map((f) => [f.id, f]));
export const familyName = (id) => FAMILY.get(id)?.name || id;

// ---------- Mood ----------
const BASE_MOODS = [
  ['vivace', '⚡ Vivace'], ['aggressivo', '🔥 Aggressivo'], ['sportivo', '🏋️ Sportivo'], ['festa', '🎉 Festa'],
  ['felice', '☀️ Felice'], ['rilassato', '😌 Rilassato'], ['romantico', '❤️ Romantico'], ['malinconico', '🌧️ Malinconico'],
  ['concentrazione', '🎯 Concentrazione'], ['notturno', '🌙 Notturno'],
];
const MKEY = 'sp_mood_tags';
const customMoods = () => { try { return JSON.parse(localStorage.getItem(MKEY)) || []; } catch { return []; } };
export const allMoods = () => [...BASE_MOODS.map(([id, name]) => ({ id, name })), ...customMoods()];
export const moodName = (id) => allMoods().find((m) => m.id === id)?.name || id;
export function addMood(name) {
  const id = 'c_' + name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '_');
  if (!allMoods().some((m) => m.id === id)) localStorage.setItem(MKEY, JSON.stringify([...customMoods(), { id, name }]));
  return id;
}

// ---------- Valutazioni ----------
// sp_ratings: { uri: { v: 1 | -1 | 0, m: [mood sì], x: [mood no], a: [id artisti] } }
// sp_artist_families: { idArtista: [famiglie scelte a mano] } (per gli artisti senza generi su Spotify)
const RKEY = 'sp_ratings', AKEY = 'sp_artist_families';
let ratings = null, artistFam = null, learned = null;
const loadR = () => (ratings ??= (() => { try { return JSON.parse(localStorage.getItem(RKEY)) || {}; } catch { return {}; } })());
const loadA = () => (artistFam ??= (() => { try { return JSON.parse(localStorage.getItem(AKEY)) || {}; } catch { return {}; } })());

export const ratingOf = (uri) => loadR()[uri];
export const ratedCount = () => Object.keys(loadR()).length;
export const voteOf = (uri) => loadR()[uri]?.v || 0;

export function rate(track, { v, m, x }) {
  const r = loadR();
  r[track.uri] = { v: v || 0, m: m || [], x: x || [], a: (track.artists || []).map((a) => a.id) };
  localStorage.setItem(RKEY, JSON.stringify(r));
  learned = null;
}

export const artistFamilies = (id) => loadA()[id] || [];
export function setArtistFamilies(id, fams) {
  const a = loadA();
  if (fams.length) a[id] = fams; else delete a[id];
  localStorage.setItem(AKEY, JSON.stringify(a));
}

// Quello che le tue valutazioni dicono degli artisti: per ogni artista, mood → +1 per ogni "sì", −1 per ogni "no".
function learnedByArtist() {
  if (learned) return learned;
  learned = new Map();
  for (const r of Object.values(loadR())) {
    for (const id of r.a || []) {
      const m = learned.get(id) || {};
      for (const k of r.m) m[k] = (m[k] || 0) + 1;
      for (const k of r.x) m[k] = (m[k] || 0) - 1;
      learned.set(id, m);
    }
  }
  return learned;
}

// ---------- Cosa sappiamo di un brano ----------
export function familiesOf(track) {
  const out = new Set();
  for (const g of genresOf(track)) for (const f of FAMILIES) if (f.re.test(g)) out.add(f.id);
  for (const a of track.artists) for (const f of artistFamilies(a.id)) out.add(f);
  return [...out];
}

const ITALIAN = /ital|napolet|neomelodic|cantautor|\broman[oa]\b|milanes|sicilian|\bsard|pugliese|calabres|toscan|veneto|lombard|genovese|torinese|bolognese/;
export const isItalian = (track) => genresOf(track).some((g) => ITALIAN.test(g));
export const hasGenres = (track) => genresOf(track).length > 0 || track.artists.some((a) => artistFamilies(a.id).length);

// Mood di un brano. Prima conta quello che hai detto del brano, poi quello che hai detto dei suoi artisti,
// poi l'ipotesi dal genere.
export function moodsOf(track) {
  const r = ratingOf(track.uri);
  const yes = new Set(r?.m || []);
  const no = new Set(r?.x || []);
  const byArtist = {};
  for (const a of track.artists) {
    for (const [k, n] of Object.entries(learnedByArtist().get(a.id) || {})) byArtist[k] = (byArtist[k] || 0) + n;
  }
  const out = new Set(yes);
  for (const [k, n] of Object.entries(byArtist)) if (n > 0 && !no.has(k)) out.add(k);
  for (const f of familiesOf(track)) {
    for (const k of FAMILY.get(f)?.moods || []) if (!no.has(k) && !(byArtist[k] < 0)) out.add(k);
  }
  return [...out];
}

// Il mood viene da una tua valutazione (sicuro) o è un'ipotesi?
export function moodSource(track, mood) {
  const r = ratingOf(track.uri);
  if (r?.m.includes(mood)) return 'tu';
  if (r?.x.includes(mood)) return 'no';
  return moodsOf(track).includes(mood) ? 'ipotesi' : '';
}

// Versioni diverse dall'originale (live, remix...).
export const VERSION_RE = /\b(live|remix|rmx|acoustic|acustic[ao]|instrumental|strumentale|sped up|slowed|reverb|unplugged|edit|version|versione|rework|bootleg|mashup|flip)\b/i;
export const isVersion = (track) => VERSION_RE.test(track.name.replace(/remaster(ed)?( version)?/ig, ''));
