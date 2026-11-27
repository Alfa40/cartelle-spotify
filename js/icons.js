// Icone disegnate a mano, nello stesso stile dell'icona dell'app: contorno scuro spesso, colori pieni.
const INK = '#1f2a2a';
const svg = (body) => `<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

const folderShape = (front = '#ffd257', back = '#f59f1c') => `
  <path d="M10 18 q0-4 4-4 h12 q2 0 3.5 1.6 l3 3.4 h17.5 q4 0 4 4 v26 q0 4-4 4 h-36 q-4 0-4-4 z" fill="${back}"/>
  <rect x="16" y="21" width="32" height="14" rx="2.5" fill="#fff"/>
  <path d="M7 31 q0-3.5 3.5-3.5 h43 q3.5 0 3 3.5 l-2.6 18 q-.5 3.5-4 3.5 h-35.8 q-3.5 0-4-3.5 z" fill="${front}"/>
  <path d="M13 33 h11" stroke="#fff" stroke-width="2.5" opacity=".8"/>`;

export const ICONS = {
  // Due dadi
  dice: svg(`
    <rect x="25" y="9" width="28" height="28" rx="7" transform="rotate(14 39 23)" fill="#ff8a7a"/>
    <g fill="${INK}" stroke="none" transform="rotate(14 39 23)"><circle cx="32" cy="16" r="2.6"/><circle cx="46" cy="30" r="2.6"/><circle cx="39" cy="23" r="2.6"/></g>
    <rect x="9" y="25" width="30" height="30" rx="7.5" transform="rotate(-10 24 40)" fill="#fff"/>
    <g fill="${INK}" stroke="none" transform="rotate(-10 24 40)"><circle cx="17" cy="32" r="2.7"/><circle cx="31" cy="32" r="2.7"/><circle cx="17" cy="48" r="2.7"/><circle cx="31" cy="48" r="2.7"/><circle cx="24" cy="40" r="2.7"/></g>`),
  // Cuffie con una nota
  headphones: svg(`
    <path d="M12 38 v-6 a20 20 0 0 1 40 0 v6" />
    <rect x="8" y="34" width="13" height="20" rx="5" fill="#5aa9ff"/>
    <rect x="43" y="34" width="13" height="20" rx="5" fill="#5aa9ff"/>
    <path d="M28 24 l10-2.5 v11 a3.6 3 -12 1 1 -2.4-2.8 v-5 l-5.2 1.3 v7.5 a3.6 3 -12 1 1 -2.4-2.8 z" fill="${INK}" stroke-width="1.5"/>`),
  // Cartella con il "+"
  folderPlus: svg(`${folderShape()}
    <circle cx="48" cy="46" r="10" fill="#4cd36a"/>
    <path d="M48 41 v10 M43 46 h10" stroke-width="3.5"/>`),
  // Giradischi per remix
  deck: svg(`
    <rect x="7" y="12" width="50" height="42" rx="9" fill="#b99bff"/>
    <circle cx="28" cy="33" r="14" fill="${INK}"/>
    <circle cx="28" cy="33" r="9" fill="none" stroke="#4a4f55" stroke-width="1.5"/>
    <circle cx="28" cy="33" r="4" fill="#ff8a7a" stroke="none"/>
    <path d="M49 18 v15 l-8 9" stroke-width="3.5"/>
    <circle cx="49" cy="18" r="3" fill="#fff"/>
    <circle cx="49" cy="48" r="2.5" fill="#fff"/>`),
  // Cartella con la nota (cartelle nell'elenco)
  folder: svg(`${folderShape()}
    <path d="M28 36 l11-2.6 v11.5 a3.6 3 -12 1 1 -2.4-2.8 v-5.2 l-6.2 1.5 v7.6 a3.6 3 -12 1 1 -2.4-2.8 z" fill="${INK}" stroke-width="1.5"/>`),
};

export const icon = (name, cls = 'ico-svg') => `<span class="${cls}">${ICONS[name]}</span>`;
