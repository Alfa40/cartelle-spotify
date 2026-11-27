"""Analisi del testo cantato: dove c'è la voce, quali sono le frasi, qual è il ritornello (la parte che si
ripete di più) e quali sono le strofe. Tutto misurato in battute del brano originale."""
import json

import numpy as np

from .percorsi import ANALISI, SR
from . import stem


def _s(sec: float) -> int:
    return int(round(sec * SR))


def analizza_voce(b: dict, a: dict, forza: bool = False) -> dict:
    out = ANALISI / f"{b['id']}.voce.json"
    if out.exists() and not forza:
        return json.loads(out.read_text(encoding="utf-8"))
    import librosa
    stem.separa(b)
    v = stem.carica(b, "vocals").mean(axis=0)
    basso = (stem.carica(b, "bass") + 0.4 * stem.carica(b, "other")).mean(axis=0)
    bat, t0, n = a["battuta"], a["primo_tempo"], a["battute"]

    # Impronta della voce per ogni battuta: melodia (chroma) e timbro delle parole (MFCC), battito per battito.
    hop = 512
    vc = librosa.feature.chroma_cqt(y=v, sr=SR, hop_length=hop)
    mf = librosa.feature.mfcc(y=v, sr=SR, n_mfcc=14, hop_length=hop)[1:]
    mf = (mf - mf.mean(axis=1, keepdims=True)) / (mf.std(axis=1, keepdims=True) + 1e-9)
    fps = SR / hop
    energia, chroma, radici = [], [], []
    for i in range(n):
        x0, x1 = _s(t0 + i * bat), _s(t0 + (i + 1) * bat)
        energia.append(float(np.sqrt(np.mean(v[x0:x1] ** 2)) + 1e-9))
        parti = []
        for q in range(4):
            f0 = int((t0 + (i + q / 4) * bat) * fps)
            f1 = max(f0 + 1, int((t0 + (i + (q + 1) / 4) * bat) * fps))
            parti += [vc[:, f0:f1].mean(axis=1) * 1.5, mf[:, f0:f1].mean(axis=1) * 0.35]
        c = np.nan_to_num(np.concatenate(parti))
        chroma.append(c / (np.linalg.norm(c) + 1e-9))
        cb = librosa.feature.chroma_cqt(y=basso[x0:x1], sr=SR, hop_length=4096,
                                        fmin=librosa.note_to_hz("C1"), n_octaves=4).mean(axis=1)
        radici.append(int(np.argmax(cb)) if np.sqrt(np.mean(basso[x0:x1] ** 2)) > 0.01 else None)
    energia = np.array(energia)
    attiva = energia > 0.2 * np.percentile(energia, 95)

    # Blocchi da 4 battute (le frasi della musica), con la voce presente in almeno metà.
    blocchi = [k for k in range(0, n - 3, 4) if attiva[k:k + 4].mean() >= 0.5]

    # Ritornello: il blocco da 8 battute (o 4) che somiglia di più agli altri blocchi del brano.
    chroma = np.array(chroma)
    def firma(k, lung):
        return chroma[k:k + lung].reshape(-1)
    def ripetizioni(k, lung):
        f = firma(k, lung)
        punti = []
        for j in blocchi:
            if abs(j - k) >= lung and j + lung <= n:
                g = firma(j, lung)
                punti.append(float(f @ g) / lung)
        punti.sort(reverse=True)
        return sum(punti[:3])
    candidati = [(ripetizioni(k, 8), k, 8) for k in blocchi if k + 8 <= n and attiva[k:k + 8].mean() >= 0.6]
    candidati += [(ripetizioni(k, 4) * 0.9, k, 4) for k in blocchi]
    if candidati:
        _, rit, rit_l = max(candidati)
    else:
        rit, rit_l = (blocchi[0] if blocchi else 0), 8
    # Tutte le volte che il ritornello torna nel brano.
    tutte = [float(firma(rit, rit_l) @ firma(j, rit_l)) / rit_l for j in blocchi
             if abs(j - rit) >= rit_l and j + rit_l <= n]
    soglia = max(np.mean(tutte) + 1.0 * np.std(tutte), 0.6) if tutte else 1.0
    rit_volte = [rit]
    for j in sorted(blocchi, key=lambda j: -float(firma(rit, rit_l) @ firma(j, rit_l)) if j + rit_l <= n else 0):
        if j + rit_l <= n and all(abs(j - r) >= rit_l for r in rit_volte):
            if float(firma(rit, rit_l) @ firma(j, rit_l)) / rit_l >= soglia:
                rit_volte.append(j)

    # Strofe: blocchi di voce che non sono il ritornello, raggruppati quando sono di seguito.
    nel_rit = set()
    for r in rit_volte:
        nel_rit.update(range(r, r + rit_l))
    strofe, cur = [], None
    for k in blocchi:
        if any(x in nel_rit for x in range(k, k + 4)):
            cur = None
            continue
        if cur and cur[0] + cur[1] == k:
            cur[1] += 4
        else:
            cur = [k, 4]
            strofe.append(cur)

    dati = {"energia": [round(float(e), 5) for e in energia], "attiva": [bool(x) for x in attiva],
            "ritornello": {"inizio": int(rit), "battute": int(rit_l), "volte": sorted(int(x) for x in rit_volte)},
            "strofe": [{"inizio": int(s), "battute": int(l)} for s, l in strofe],
            "radici": radici}
    out.write_text(json.dumps(dati, ensure_ascii=False), encoding="utf-8")
    return dati


def pezzo(dv: dict, nome: str) -> tuple[int, int] | None:
    """Da un nome ("ritornello", "strofa1", "strofa2", "battute:16-24") alle battute (inizio, quante)."""
    if nome == "ritornello":
        return dv["ritornello"]["inizio"], dv["ritornello"]["battute"]
    if nome.startswith("strofa"):
        i = int(nome[6:] or 1) - 1
        st = dv["strofe"]
        if not st:
            return pezzo(dv, "ritornello")
        s = st[min(i, len(st) - 1)]
        return s["inizio"], s["battute"]
    if nome.startswith("battute:"):
        a, z = nome[8:].split("-")
        return int(a), int(z) - int(a)
    return None
