// Lista della spesa per il DJ AI: quali album cercare come CD usati e quali brani comprare in digitale,
// in ordine di importanza (quanto li ascolti), con il costo stimato. Niente iTunes: CD usati e negozi digitali.

const KEY = 'sp_spesa';
const PREZZO_CD = 6;        // € a CD usato, a occhio (di solito 3–8 €)
const PREZZO_BRANO = 1.29;  // € a brano digitale
const RECENTE_MS = 180 * 86400e3; // uscito da meno di 6 mesi: in CD usato non si trova ancora

const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
export const preso = (id) => !!read()[id];
export function segna(id, si) {
  const s = read();
  if (si) s[id] = Date.now(); else delete s[id];
  localStorage.setItem(KEY, JSON.stringify(s));
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)|\[.*?\]|feat\..*|ft\..*/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// È già nella libreria del PC? (per ISRC, oppure titolo + artista)
export function inLibreria(t, brani) {
  const isrc = t.external_ids?.isrc?.toUpperCase();
  const tt = norm(t.name);
  const aa = (t.artists || []).map((a) => norm(a.name));
  return brani.some((b) => (isrc && b.isrc && b.isrc.toUpperCase() === isrc)
    || (norm(b.titolo) === tt && aa.some((a) => a && norm(b.artista).includes(a))));
}

const q = (s) => encodeURIComponent(s);
export const link = {
  vinted: (s) => `https://www.vinted.it/catalog?search_text=${q(s + ' cd')}`,
  ebay: (s) => `https://www.ebay.it/sch/i.html?_nkw=${q(s + ' cd')}&LH_ItemCondition=3000`,
  subito: (s) => `https://www.subito.it/annunci-italia/vendita/usato/?q=${q(s + ' cd')}`,
  amazon: (s) => `https://www.amazon.it/s?k=${q(s)}&i=digital-music`,
  qobuz: (s) => `https://www.qobuz.com/it-it/search?q=${q(s)}`,
  bandcamp: (s) => `https://bandcamp.com/search?q=${q(s)}`,
};

// righe: [{ t: brano Spotify completo, sources: [...] , punti: numero }]
// esito(uri): risultato del controllo "si può comprare?" ({found}) oppure undefined se non controllato.
export function prepara(righe, { brani = [], esito = () => undefined } = {}) {
  const album = new Map();
  const giaInLibreria = [], nonInVendita = [];
  for (const r of righe) {
    const t = r.t;
    if (inLibreria(t, brani)) { giaInLibreria.push(r); continue; }
    if (esito(t.uri)?.found === false) { nonInVendita.push(r); continue; }
    const al = t.album || {};
    const id = al.id || t.uri;
    const a = album.get(id) || {
      id, nome: al.name || t.name, artisti: (al.artists || t.artists || []).map((x) => x.name).join(', '),
      tipo: al.album_type || 'album', totale: al.total_tracks || 0, uscita: al.release_date || '',
      immagine: al.images?.at(-1)?.url || '', brani: [], punti: 0,
    };
    a.brani.push(r);
    a.punti += r.punti;
    album.set(id, a);
  }
  const voci = [];
  for (const a of album.values()) {
    const recente = a.uscita && Date.now() - Date.parse(a.uscita) < RECENTE_MS;
    // Il CD usato conviene quando ti piacciono almeno 3 brani dell'album (o 2 se l'album è lungo):
    // con circa 6 € hai tutto l'album, cioè molti più brani da remixare.
    const lungo = (a.totale || 0) >= 10;
    const conviene_cd = !recente && (a.tipo === 'album' || a.tipo === 'compilation') && (a.brani.length >= 3 || (a.brani.length >= 2 && lungo));
    if (conviene_cd) {
      voci.push({ id: 'cd:' + a.id, come: 'cd', titolo: a.nome, artisti: a.artisti, immagine: a.immagine, uscita: a.uscita,
        brani: a.brani, punti: a.punti, costo: PREZZO_CD, cerca: `${a.artisti} ${a.nome}`, totale: a.totale });
    } else {
      for (const r of a.brani) {
        const art = (r.t.artists || []).map((x) => x.name).join(', ');
        voci.push({ id: 'd:' + r.t.uri, come: 'digitale', titolo: r.t.name, artisti: art, immagine: a.immagine, uscita: a.uscita,
          brani: [r], punti: r.punti, costo: PREZZO_BRANO, cerca: `${art} ${r.t.name}`,
          nota: recente ? 'uscito da poco' : a.tipo === 'single' ? 'singolo' : '' });
      }
    }
  }
  // In ordine di importanza per euro speso: prima quello che ascolti di più e costa meno.
  voci.sort((x, y) => y.punti / y.costo - x.punti / x.costo);
  let cum = 0, braniCum = 0;
  for (const v of voci) {
    v.preso = preso(v.id);
    if (!v.preso) { cum += v.costo; braniCum += v.brani.length; }
    v.costoCumulato = cum;
    v.braniCumulati = braniCum;
  }
  return { voci, giaInLibreria, nonInVendita };
}

// Quanti brani prendi con un certo budget (seguendo l'ordine della lista).
export function conBudget(voci, euro) {
  const daPrendere = voci.filter((v) => !v.preso);
  const dentro = daPrendere.filter((v) => v.costoCumulato <= euro);
  return { voci: dentro.length, brani: dentro.reduce((s, v) => s + v.brani.length, 0), spesa: dentro.at(-1)?.costoCumulato || 0 };
}
