"""Le "ricette" del DJ: trasformano uno o due brani secondo un preset.

Tipi di preset:
- velocita: sped up, slowed, bassi potenziati, riverbero.
- edit:     sporche ed edit per DJ (intro/outro di sola batteria, sirene, riser, stop, eco…).
- remix:    la voce del brano su una base nuova di un altro genere.
- mashup:   la voce di un brano sulla base di un altro, a velocità e tonalità giuste.
"""
import numpy as np

from .percorsi import SR
from . import analisi, effetti as fx, libreria, ritmi, stem, suoni


def _s(sec: float) -> int:
    return int(round(sec * SR))


# ---------------------------------------------------------------- velocità
def velocita(p: dict, b: dict, **_) -> np.ndarray:
    y = libreria.carica(b)
    f = float(p.get("fattore", 1.0))
    if f != 1.0:
        y = fx.stira(y, f) if p.get("mantieni_tono") else fx.velocita_nastro(y, f)
    if p.get("bassi_db"):
        y = fx.bassi(y, p["bassi_db"])
    if p.get("riverbero"):
        y = fx.riverbero(y, p["riverbero"], p.get("stanza", 0.8))
    return y


# ---------------------------------------------------------------- edit / sporche
def edit(p: dict, b: dict, **_) -> np.ndarray:
    a = analisi.analizza(b)
    y = libreria.carica(b)
    bat, t0 = a["battuta"], a["primo_tempo"]
    battito = bat / 4
    n_bat = a["battute"]
    corpo = y[:, _s(t0):_s(t0 + n_bat * bat)].copy()      # da battuta piena a battuta piena
    d = analisi.drop(a)
    eff = set(p.get("effetti", []))

    intro_b, outro_b = int(p.get("intro_battute", 0)), int(p.get("outro_battute", 0))
    if intro_b or outro_b:
        stem.separa(b)
        batt = stem.carica(b, "drums")
        inizio = d if d + 4 <= n_bat else 0
        giro = batt[:, _s(t0 + inizio * bat):_s(t0 + (inizio + 4) * bat)]
        giro = fx.adatta(giro, _s(4 * bat))

    if "riser_drop" in eff and d >= 4:
        r = suoni.riser(4 * bat)
        fx.metti(corpo, fx.catena(r, fx.LowpassFilter(7000)), _s((d - 4) * bat), 0.5)
    if "stop_prima_drop" in eff and d >= 1:
        a0, a1 = _s((d - 1) * bat + 3 * battito), _s(d * bat)
        corpo[:, a0:a1] = fx.stop_nastro(corpo[:, a0:a1])
    if "stutter_prima_drop" in eff and d >= 1:
        a0, a1 = _s((d - 1) * bat + 2 * battito), _s(d * bat)
        corpo[:, a0:a1] = fx.adatta(fx.stutter(corpo[:, a0:a1], battito / 4, 8), a1 - a0)
    if "impatto_drop" in eff and d >= 1:
        fx.metti(corpo, suoni.impatto(), _s(d * bat), 0.9)
    if "tromba_drop" in eff and d >= 1:
        fx.metti(corpo, fx.catena(suoni.tromba(), fx.LowpassFilter(4000)), _s(d * bat), 0.5)
    if "riverbero_pause" in eff:
        # Ogni 8 battute, l'ultimo battito va in riverbero (throw).
        for k in range(8, n_bat, 8):
            a0, a1 = _s((k - 1) * bat + 3 * battito), _s(k * bat)
            corpo[:, a0:a1] = fx.riverbero(corpo[:, a0:a1], 0.6, 0.9)[:, : a1 - a0]
    if p.get("bassi_db"):
        corpo = fx.bassi(corpo, p["bassi_db"])

    pezzi = []
    if intro_b:
        intro = np.concatenate([giro] * max(1, intro_b // 4), axis=1)
        if "sirena_inizio" in eff:
            fx.metti(intro, fx.catena(suoni.sirena(2 * bat), fx.LowpassFilter(3500)), 0, 0.45)
        if p.get("intro_filtro", True):
            intro = fx.filtro_sweep(intro, 500, 16000)
        pezzi.append(intro)
    pezzi.append(corpo)
    if outro_b:
        outro = np.concatenate([giro] * max(1, outro_b // 4), axis=1)
        pezzi.append(fx.dissolvi(outro, out_s=2 * bat))
    out = np.concatenate(pezzi, axis=1)
    if "eco_finale" in eff:
        coda = _s(2 * bat)
        out = np.concatenate([out[:, :-coda], fx.eco_finale(out[:, -coda:], battito)], axis=1)
    return out


# ---------------------------------------------------------------- remix di genere
def _velocita_voce(bpm_brano: float, bpm_base: float, mezzo: bool) -> float:
    """Di quanto accelerare la voce: si sceglie il rapporto più vicino a 1 tra tempo intero, metà e doppio."""
    cand = [bpm_base / bpm_brano, bpm_base / 2 / bpm_brano, bpm_base * 2 / bpm_brano]
    if mezzo:
        cand.append(bpm_base / 2 / bpm_brano)
    return min(cand, key=lambda r: abs(np.log(r)))


def remix(p: dict, b: dict, **_) -> np.ndarray:
    a = analisi.analizza(b)
    stem.separa(b)
    gen = p["genere"]
    g = ritmi.GENERI[gen]
    if p.get("bpm"):
        bpm = float(p["bpm"])
        r = _velocita_voce(a["bpm"], bpm, g.get("mezzo_tempo", False))
    else:
        # Si sceglie il BPM della base, dentro l'intervallo del genere, che stira meno la voce
        # (anche contando la voce a metà o al doppio del tempo).
        lo, hi = g["intervallo"]
        prove = []
        for m in (0.5, 1, 2):
            e = a["bpm"] * m
            scelto = min(max(e, lo), hi)
            prove.append((abs(np.log(scelto / e)), scelto, scelto / e))
        _, bpm, r = min(prove)
    voce = fx.stira(stem.carica(b, "vocals"), r, voce=True)
    voce = fx.pulisci_voce(voce, float(p.get("riverbero_voce", 0.08)))
    basso_orig = fx.stira(stem.carica(b, "bass") + 0.5 * stem.carica(b, "other"), r)
    altro = None
    if p.get("tieni_resto"):
        altro = fx.stira(stem.carica(b, "other"), r)

    bat = ritmi.battuta_s(gen, bpm)
    intro_b = int(p.get("intro_battute", 8))
    outro_b = int(p.get("outro_battute", 8))
    t0 = a["primo_tempo"] / r
    corpo_b = int(np.ceil((voce.shape[1] / SR - t0) / bat))
    sezioni = ["intro"] * (intro_b // 2) + ["pieno"] * (intro_b - intro_b // 2)
    for i in range(corpo_b):
        sezioni.append("pausa" if p.get("pause", True) and i % 16 in (14, 15) else "pieno")
    sezioni += ["pieno"] * outro_b
    pos = _s(intro_b * bat - t0)
    radici = _radici(basso_orig, pos, len(sezioni), bat) if p.get("basso_dagli_accordi", True) else None
    beat = ritmi.base(gen, sezioni, a["tonica"], a["minore"], bpm, radici)
    if p.get("sporco_808"):
        beat = fx.sporco(beat, p["sporco_808"])

    out = np.zeros_like(beat)
    fx.metti(out, beat, 0, float(p.get("vol_base", 0.9)))
    fx.metti(out, voce, pos, float(p.get("vol_voce", 1.1)))
    if altro is not None:
        fx.metti(out, altro, pos, float(p.get("vol_resto", 0.35)))
    if p.get("chop_voce"):
        # Ogni 8 battute: l'ultimo battito diventa una raffica della voce (stile jersey).
        for k in range(intro_b + 8, intro_b + corpo_b, 8):
            a0 = _s((k - 1) * bat + 0.75 * bat)
            pezzo = out[:, a0:a0 + _s(bat / 16)]
            if pezzo.shape[1]:
                out[:, a0:a0 + _s(bat / 4)] = fx.adatta(fx.stutter(pezzo, bat / 16, 4), _s(bat / 4))[:, : out.shape[1] - a0]
    if p.get("impatto_inizio", True):
        fx.metti(out, suoni.impatto(), _s(intro_b * bat), 0.7)
    fine = _s(len(sezioni) * bat)
    out = fx.dissolvi(out[:, :fine], out_s=4 * bat)
    return fx.eq_come(out, libreria.carica(b), float(p.get("eq_originale", 0.6)))


def _radici(basso: np.ndarray, pos: int, n_batt: int, bat: float) -> list:
    """Nota di basso (0–11) di ogni battuta, letta dal basso del brano originale già messo a tempo."""
    import librosa
    m = basso.mean(axis=0)
    out = []
    for i in range(n_batt):
        a0, a1 = _s(i * bat) - pos, _s((i + 1) * bat) - pos
        if a0 < 0 or a1 > len(m) or a1 - a0 < 2048:
            out.append(None)
            continue
        seg = m[a0:a1]
        if np.sqrt(np.mean(seg ** 2)) < 0.01:
            out.append(None)
            continue
        c = librosa.feature.chroma_cqt(y=seg, sr=SR, hop_length=2048, fmin=librosa.note_to_hz("C1"), n_octaves=4).mean(axis=1)
        out.append(int(np.argmax(c)))
    # dove non si sente niente si tiene la nota della battuta prima
    ultimo = None
    for i, x in enumerate(out):
        if x is None:
            out[i] = ultimo
        else:
            ultimo = x
    return out


# ---------------------------------------------------------------- mashup
def _semitoni(a_voce: dict, a_base: dict) -> int:
    """Di quanti semitoni spostare la voce per stare nella tonalità della base (minore → relativa maggiore)."""
    pv = (a_voce["tonica"] + (3 if a_voce["minore"] else 0)) % 12
    pb = (a_base["tonica"] + (3 if a_base["minore"] else 0)) % 12
    # Vanno bene anche le tonalità "vicine" (una quinta sopra o sotto): si sceglie lo spostamento più piccolo,
    # perché la voce spostata di molti semitoni suona innaturale.
    scelte = [((pb + d - pv + 6) % 12) - 6 for d in (0, 7, 5)]
    return min(scelte, key=abs)


def _prima_battuta_voce(b: dict, a: dict) -> int:
    v = stem.carica(b, "vocals").mean(axis=0)
    bat, t0 = a["battuta"], a["primo_tempo"]
    e = [np.sqrt(np.mean(v[_s(t0 + i * bat):_s(t0 + (i + 1) * bat)] ** 2) + 1e-9) for i in range(a["battute"])]
    soglia = 0.25 * max(e)
    return next((i for i, x in enumerate(e) if x > soglia), 0)


def mashup(p: dict, b: dict, con: dict | None = None, **_) -> np.ndarray:
    """b = brano da cui prendo la voce, con = brano da cui prendo la base."""
    if con is None:
        raise ValueError("Per un mashup servono due brani: la voce e la base (--con)")
    av, ab = analisi.analizza(b), analisi.analizza(con)
    stem.separa(b)
    stem.separa(con)
    r = _velocita_voce(av["bpm"], ab["bpm"], False)
    semi = _semitoni(av, ab) if p.get("tonalita", "adatta") == "adatta" else int(p.get("semitoni", 0))
    voce = fx.stira(stem.carica(b, "vocals"), r, semi, voce=True)
    voce = fx.pulisci_voce(voce, 0.1)
    base = stem.carica(con, "drums") + stem.carica(con, "bass") + float(p.get("vol_resto", 0.9)) * stem.carica(con, "other")

    va = _prima_battuta_voce(b, av)
    inizio_voce = (av["primo_tempo"] + va * av["battuta"]) / r
    entra = int(p.get("entra_battuta", 8))
    if p.get("entra_al_drop"):
        entra = analisi.drop(ab)
    pos = _s(ab["primo_tempo"] + entra * ab["battuta"] - inizio_voce)

    # Se la voce dura più della base, la base si allunga ripetendo 8 battute dal drop.
    fine = pos + voce.shape[1]
    if fine > base.shape[1]:
        d = analisi.drop(ab)
        a0 = _s(ab["primo_tempo"] + d * ab["battuta"])
        giro = base[:, a0:a0 + _s(8 * ab["battuta"])]
        fine_base = _s(ab["primo_tempo"] + ab["battute"] * ab["battuta"])
        base = base[:, :fine_base]
        while base.shape[1] < fine and giro.shape[1]:
            base = np.concatenate([base, giro], axis=1)
    out = np.zeros((2, max(base.shape[1], 1)), dtype=np.float32)
    fx.metti(out, base, 0, float(p.get("vol_base", 0.9)))
    fx.metti(out, voce, pos, float(p.get("vol_voce", 1.15)))
    out = fx.dissolvi(out, out_s=2 * ab["battuta"])
    return fx.eq_come(out, libreria.carica(con), 0.5)


TIPI = {"velocita": velocita, "edit": edit, "remix": remix, "mashup": mashup}


def fai(p: dict, b: dict, con: dict | None = None) -> np.ndarray:
    y = TIPI[p["tipo"]](p, b, con=con)
    return fx.finalizza(y, float(p.get("volume_rms_db", -14)))
