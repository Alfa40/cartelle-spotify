"""Struttura del cantato: ritornello (le frasi che si ripetono) e strofe, con i tempi esatti delle parole.

Metodo principale: il testo trascritto con Whisper (motore/testo.py). Si confrontano le frasi: quelle che
tornano uguali più volte formano il ritornello; il resto sono strofe, divise a fine frase.
Se il testo non c'è (brano strumentale o trascrizione vuota) si usa il suono della voce.

Ogni pezzo ha: "inizio" (battuta del brano originale in cui cade il primo battito del pezzo), "battute",
"da"/"a" (secondi della prima e dell'ultima parola), "righe" (il testo).
"""
import difflib
import json
import re
import unicodedata

import numpy as np

from .percorsi import ANALISI, SR
from . import stem

VERSIONE = 8


def _s(sec: float) -> int:
    return int(round(sec * SR))


def _norm(t: str) -> str:
    t = unicodedata.normalize("NFKD", t.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9 ]+", "", t).strip()


def analizza_voce(b: dict, a: dict, forza: bool = False) -> dict:
    out = ANALISI / f"{b['id']}.voce.json"
    if out.exists() and not forza:
        d = json.loads(out.read_text(encoding="utf-8"))
        if d.get("versione") == VERSIONE:
            return d
    import librosa
    stem.separa(b)
    v = stem.carica(b, "vocals").mean(axis=0)
    basso = (stem.carica(b, "bass") + 0.4 * stem.carica(b, "other")).mean(axis=0)
    bat, t0, n = a["battuta"], a["primo_tempo"], a["battute"]

    energia, radici = [], []
    for i in range(n):
        x0, x1 = _s(t0 + i * bat), _s(t0 + (i + 1) * bat)
        energia.append(float(np.sqrt(np.mean(v[x0:x1] ** 2)) + 1e-9))
        cb = librosa.feature.chroma_cqt(y=basso[x0:x1], sr=SR, hop_length=4096,
                                        fmin=librosa.note_to_hz("C1"), n_octaves=4).mean(axis=1)
        radici.append(int(np.argmax(cb)) if np.sqrt(np.mean(basso[x0:x1] ** 2)) > 0.01 else None)

    dati = None
    try:
        from . import testo
        tx = testo.trascrivi(b)
        if len(tx["righe"]) >= 6:
            dati = _da_testo(tx, a, np.array(energia))
            dati["lingua"] = tx.get("lingua", "")
    except Exception as e:  # senza Whisper o senza testo si va avanti col suono
        print(f"Trascrizione non riuscita: {e}")
    if dati is None:
        dati = _da_suono(b, a, v, np.array(energia))
    dati.update({"versione": VERSIONE, "energia": [round(e, 5) for e in energia], "radici": radici})
    out.write_text(json.dumps(dati, ensure_ascii=False), encoding="utf-8")
    return dati


# ---------------------------------------------------------------- dal testo
def _pezzo(righe: list[dict], a: dict) -> dict:
    """Da un gruppo di frasi consecutive al pezzo in battute."""
    bat, t0 = a["battuta"], a["primo_tempo"]
    da, fine = righe[0]["da"], righe[-1]["a"]
    k = (da - t0) / bat
    inizio = int(np.floor(k))
    if k - inizio > 0.85:          # parola "in levare" appena prima della battuta: il pezzo parte dalla battuta dopo
        inizio += 1
    inizio = max(inizio, 0)
    battute = int(np.ceil(((fine - (t0 + inizio * bat)) / bat) / 2 - 1e-6) * 2)
    return {"inizio": inizio, "battute": max(2, battute), "da": round(da, 3), "a": round(fine, 3),
            "righe": [r["testo"] for r in righe], "fini": [round(r["a"], 3) for r in righe]}


def _da_testo(tx: dict, a: dict, energia: np.ndarray) -> dict:
    from .testo import _righe
    righe = _righe(tx["parole"])          # con le parole e i loro tempi
    n = len(righe)
    nt = [_norm(r["testo"]) for r in righe]
    lunghe = [len(x.split()) >= 3 or len(x) >= 12 for x in nt]

    parole = [x.split() for x in nt]

    def uguali(i: int, j: int) -> bool:
        """Due frasi "uguali": testo molto simile, oppure almeno 5 parole di fila in comune
        (Whisper a volte unisce o divide le frasi in modo diverso, o sbaglia una parola)."""
        if not (lunghe[i] and lunghe[j]):
            return False
        if difflib.SequenceMatcher(None, nt[i], nt[j]).ratio() >= 0.7:
            return True
        sm = difflib.SequenceMatcher(None, parole[i], parole[j])
        blocco = sm.find_longest_match(0, len(parole[i]), 0, len(parole[j]))
        return blocco.size >= min(5, len(parole[i]), len(parole[j])) and blocco.size >= 4

    # Sequenze di frasi che si ripetono più avanti nel brano (stesse frasi nello stesso ordine).
    blocchi = {}
    for i in range(n):
        for j in range(i + 1, n):
            if righe[j]["da"] - righe[i]["da"] < 6 or not uguali(i, j):
                continue
            if i > 0 and j > 0 and uguali(i - 1, j - 1):
                continue                      # non è l'inizio della sequenza
            k = 1
            while i + k < j and j + k < n and uguali(i + k, j + k):
                k += 1
            blocchi.setdefault((i, k), set()).update({i, j})
    # Le volte in cui torna la stessa sequenza: si uniscono quelle trovate partendo da altre volte.
    for (i, k), volte in list(blocchi.items()):
        for j in list(volte):
            for (i2, k2), v2 in blocchi.items():
                if i2 == j and k2 >= k:
                    volte.update(v2)
    # Il ritornello: conta molto quante volte torna (un ritornello torna 3-4 volte, una strofa ripresa 2).
    migliore, punti_m = None, 0.0
    for (i, k), volte in blocchi.items():
        durata = righe[i + k - 1]["a"] - righe[i]["da"]
        if k < 2 and durata < 4:
            continue
        separate = []
        for j in sorted(volte):
            if not separate or j >= separate[-1] + k:
                separate.append(j)
        blocchi[(i, k)] = set(separate)
        punti = min(durata, 8 * a["battuta"]) * len(separate) ** 1.7
        if punti > punti_m:
            migliore, punti_m = (i, k, sorted(volte)), punti

    if migliore is None:
        return {"metodo": "testo", "ritornello": None, "strofe": _strofe(list(range(n)), righe, a, energia), "righe": _elenco(righe, a)}
    i, k, volte = migliore
    i = min(volte)                      # si usa la prima volta in cui compare
    volte = sorted(volte)

    def parole_tra(t0: float, t1: float) -> list[str]:
        return [w for x in range(n) if righe[x]["da"] < t1 and righe[x]["a"] > t0 for w in parole[x]]

    # Si allunga con la frase dopo finché le stesse parole arrivano anche dopo le altre volte
    # (confronto sulle parole nel tempo, perché Whisper divide le frasi in modo diverso ogni volta).
    fine_volte = {j: righe[j + k - 1]["a"] for j in volte}
    while i + k < n:
        cand = righe[i + k]
        lung = cand["a"] - cand["da"]
        pc = parole[i + k]
        if len(pc) < 2 or cand["a"] - righe[i]["da"] > 16 * a["battuta"]:
            break
        trovate, nuove_fini = 0, {}
        for j in volte[1:]:
            t0 = fine_volte[j]
            vicine = parole_tra(t0 - 0.2, t0 + lung + 2.5)
            bl = difflib.SequenceMatcher(None, pc, vicine).find_longest_match(0, len(pc), 0, len(vicine))
            if bl.size >= min(4, len(pc)):
                trovate += 1
                nuove_fini[j] = t0 + lung
        if trovate < max(1, (len(volte) - 1) * 0.6):
            break
        k += 1
        fine_volte[i] = cand["a"]
        fine_volte.update(nuove_fini)

    # Un ritornello troppo lungo si taglia a fine frase (al massimo 16 battute).
    while k > 1 and righe[i + k - 1]["a"] - righe[i]["da"] > 16 * a["battuta"]:
        k -= 1
    # Taglio parola per parola: il ritornello parte dalla prima parola che si ripete anche nelle altre volte
    # e finisce sull'ultima (via i pezzi delle frasi prima e dopo che Whisper ha messo sulla stessa riga).
    sel = [dict(x) for x in righe[i:i + k]]
    altre = [j for j in volte if j != i]
    def taglia(riga: dict, confronto: list[dict], inizio: bool) -> dict:
        pw = [_norm(w["p"]) for w in riga["parole"]]
        migliore = None
        for c in confronto:
            cw = [_norm(w["p"]) for w in c["parole"]]
            for bl in difflib.SequenceMatcher(None, pw, cw).get_matching_blocks():
                if bl.size >= 3:
                    pos = bl.a if inizio else bl.a + bl.size - 1
                    migliore = pos if migliore is None else (min(migliore, pos) if inizio else max(migliore, pos))
        if migliore is None:
            return riga
        tenute = riga["parole"][migliore:] if inizio else riga["parole"][:migliore + 1]
        return {**riga, "parole": tenute, "testo": " ".join(w["p"] for w in tenute), "da": tenute[0]["da"], "a": tenute[-1]["a"]}
    if altre:
        sel[0] = taglia(sel[0], [righe[j] for j in altre], True)
        sel[-1] = taglia(sel[-1], [righe[min(j + k - 1, n - 1)] for j in altre], False)
    rit = _pezzo(sel, a)
    rit["volte"] = [_pezzo(righe[j:j + k], a)["inizio"] for j in volte]
    nel_rit = set()
    for j in volte:
        nel_rit.update(range(j, j + k))
    resto = [x for x in range(n) if x not in nel_rit]
    return {"metodo": "testo", "ritornello": rit, "strofe": _strofe(resto, righe, a, energia), "righe": _elenco(righe, a)}


def _strofa_vera(righe_g: list[dict], a: dict, energia: np.ndarray) -> bool:
    """Una strofa vera: tante parole, poche ripetute, voce che si sente bene.
    Scarta intro parlate, cori di riempimento e frasi ripetute a vuoto."""
    parole = [_norm(w) for r in righe_g for w in r["testo"].split()]
    parole = [w for w in parole if w]
    durata = righe_g[-1]["a"] - righe_g[0]["da"]
    if len(parole) < 8 or durata <= 0:
        return False
    diverse = len(set(parole)) / len(parole)
    densita = len(parole) / durata
    b0 = int((righe_g[0]["da"] - a["primo_tempo"]) // a["battuta"])
    b1 = int((righe_g[-1]["a"] - a["primo_tempo"]) // a["battuta"]) + 1
    forte = energia[max(b0, 0):max(b1, b0 + 1)].mean() >= 0.35 * np.percentile(energia, 95) if len(energia) else True
    return diverse >= 0.45 and densita >= 0.8 and forte


def _strofe(indici: list[int], righe: list[dict], a: dict, energia: np.ndarray) -> list[dict]:
    """Frasi consecutive fuori dal ritornello, a gruppi di massimo 16 battute, tagliati a fine frase."""
    gruppi, cur = [], []
    for x in indici:
        if cur and (x != cur[-1] + 1 or righe[x]["a"] - righe[cur[0]]["da"] > 16 * a["battuta"]):
            gruppi.append(cur)
            cur = []
        cur.append(x)
    if cur:
        gruppi.append(cur)
    return [_pezzo([righe[x] for x in g], a) for g in gruppi
            if len(g) >= 2 and righe[g[-1]]["a"] - righe[g[0]]["da"] >= 2 * a["battuta"]
            and _strofa_vera([righe[x] for x in g], a, energia)]


def _elenco(righe: list[dict], a: dict) -> list[dict]:
    """Tutte le frasi con la battuta in cui iniziano (per Claude e per scegliere a mano)."""
    return [{"n": i, "battuta": int((r["da"] - a["primo_tempo"]) // a["battuta"]), "da": r["da"], "a": r["a"],
             "testo": r["testo"]} for i, r in enumerate(righe)]


# ---------------------------------------------------------------- dal suono (senza testo)
def _da_suono(b: dict, a: dict, v: np.ndarray, energia: np.ndarray) -> dict:
    import librosa
    bat, t0, n = a["battuta"], a["primo_tempo"], a["battute"]
    hop = 512
    vc = librosa.feature.chroma_cqt(y=v, sr=SR, hop_length=hop)
    mf = librosa.feature.mfcc(y=v, sr=SR, n_mfcc=14, hop_length=hop)[1:]
    mf = (mf - mf.mean(axis=1, keepdims=True)) / (mf.std(axis=1, keepdims=True) + 1e-9)
    fps = SR / hop
    firme = []
    for i in range(n):
        parti = []
        for q in range(4):
            f0 = int((t0 + (i + q / 4) * bat) * fps)
            f1 = max(f0 + 1, int((t0 + (i + (q + 1) / 4) * bat) * fps))
            parti += [vc[:, f0:f1].mean(axis=1) * 1.5, mf[:, f0:f1].mean(axis=1) * 0.35]
        c = np.nan_to_num(np.concatenate(parti))
        firme.append(c / (np.linalg.norm(c) + 1e-9))
    firme = np.array(firme)
    attiva = energia > 0.2 * np.percentile(energia, 95)
    blocchi = [k for k in range(0, n - 3, 4) if attiva[k:k + 4].mean() >= 0.5]
    f = lambda k, l: firme[k:k + l].reshape(-1)
    def rip(k, l):
        p = sorted((float(f(k, l) @ f(j, l)) / l for j in blocchi if abs(j - k) >= l and j + l <= n), reverse=True)
        return sum(p[:3])
    cand = [(rip(k, 8), k, 8) for k in blocchi if k + 8 <= n] + [(rip(k, 4) * 0.9, k, 4) for k in blocchi]
    _, rit, rl = max(cand) if cand else (0, blocchi[0] if blocchi else 0, 8)
    tutte = [float(f(rit, rl) @ f(j, rl)) / rl for j in blocchi if abs(j - rit) >= rl and j + rl <= n]
    soglia = max(np.mean(tutte) + np.std(tutte), 0.6) if tutte else 1.0
    volte = [rit] + [j for j in blocchi if j + rl <= n and abs(j - rit) >= rl and float(f(rit, rl) @ f(j, rl)) / rl >= soglia]
    nel = set(x for r in volte for x in range(r, r + rl))
    strofe, cur = [], None
    for k in blocchi:
        if any(x in nel for x in range(k, k + 4)):
            cur = None
            continue
        if cur and cur["inizio"] + cur["battute"] == k and cur["battute"] < 16:
            cur["battute"] += 4
        else:
            cur = {"inizio": k, "battute": 4}
            strofe.append(cur)
    tempo = lambda k: round(t0 + k * bat, 3)
    for s in strofe:
        s.update(da=tempo(s["inizio"]), a=tempo(s["inizio"] + s["battute"]), righe=[])
    return {"metodo": "suono", "ritornello": {"inizio": rit, "battute": rl, "da": tempo(rit), "a": tempo(rit + rl),
                                               "righe": [], "volte": sorted(volte)},
            "strofe": strofe, "righe": []}


# ---------------------------------------------------------------- scelta dei pezzi
def pezzo(dv: dict, nome: str, a: dict | None = None) -> dict | None:
    """Da un nome al pezzo: "ritornello", "strofa1", "strofa2", "battute:16-24" (battute originali),
    "righe:5-9" (frasi del testo, numerate da 0)."""
    if not nome:
        return None
    if nome == "ritornello":
        return dv["ritornello"] or (dv["strofe"][0] if dv["strofe"] else None)
    if nome.startswith("strofa"):
        st = dv["strofe"]
        if not st:
            return dv["ritornello"]
        i = int(nome[6:] or 1) - 1
        return st[min(i, len(st) - 1)]
    if nome.startswith("righe:") and dv.get("righe") and a:
        x, y = (int(v) for v in nome[6:].split("-"))
        sel = [{"testo": r["testo"], "da": r["da"], "a": r["a"]} for r in dv["righe"][x:y + 1]]
        return _pezzo(sel, a) if sel else None
    if nome.startswith("battute:") and a:
        x, y = (int(v) for v in nome[8:].split("-"))
        t = lambda k: a["primo_tempo"] + k * a["battuta"]
        return {"inizio": x, "battute": y - x, "da": round(t(x), 3), "a": round(t(y), 3), "righe": []}
    return None
