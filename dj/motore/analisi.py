"""Analisi di un brano: BPM, griglia delle battute, tonalità (anche in notazione Camelot) ed energia."""
import json

import numpy as np

from .percorsi import ANALISI, SR
from . import libreria

NOTE = ["Do", "Do#", "Re", "Mib", "Mi", "Fa", "Fa#", "Sol", "Lab", "La", "Sib", "Si"]
# Profili di Krumhansl-Kessler per maggiore e minore.
MAGG = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
# Camelot: numero per tonica maggiore (Do=8B) e minore (La=8A).
CAM_MAGG = {0: 8, 7: 9, 2: 10, 9: 11, 4: 12, 11: 1, 6: 2, 1: 3, 8: 4, 3: 5, 10: 6, 5: 7}


def camelot(tonica: int, minore: bool) -> str:
    rel = (tonica + 3) % 12 if minore else tonica  # minore → relativa maggiore
    return f"{CAM_MAGG[rel]}{'A' if minore else 'B'}"


def _tonalita(y: np.ndarray) -> tuple[int, bool, float]:
    import librosa
    chroma = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=4096).mean(axis=1)
    best = (-2.0, 0, False)
    for t in range(12):
        for prof, minore in ((MAGG, False), (MIN, True)):
            r = np.corrcoef(chroma, np.roll(prof, t))[0, 1]
            if r > best[0]:
                best = (r, t, minore)
    return best[1], best[2], float(best[0])


def analizza(b: dict, forza: bool = False) -> dict:
    out = ANALISI / f"{b['id']}.json"
    if out.exists() and not forza:
        return json.loads(out.read_text(encoding="utf-8"))
    import librosa
    st = libreria.carica(b)
    y = st.mean(axis=0)
    durata = len(y) / SR

    tempo, beats = librosa.beat.beat_track(y=y, sr=SR, units="frames", hop_length=512, trim=False)
    bpm = float(np.atleast_1d(tempo)[0])
    beat_t = librosa.frames_to_time(beats, sr=SR, hop_length=512)
    # BPM tra 70 e 180: sotto si raddoppia (es. 54 → 108), e i battiti si dimezzano di conseguenza.
    while bpm < 70:
        bpm *= 2
        if len(beat_t) > 1:
            beat_t = np.sort(np.r_[beat_t, (beat_t[:-1] + beat_t[1:]) / 2])
    while bpm > 180:
        bpm /= 2
        beat_t = beat_t[::2]
    beats = librosa.time_to_frames(beat_t, sr=SR, hop_length=512)

    # Il primo tempo della battuta: quello dei 4 possibili con più colpi bassi (cassa).
    from scipy.signal import butter, sosfilt
    y_bassi = sosfilt(butter(4, 150, "lowpass", fs=SR, output="sos"), y).astype(np.float32)
    bassi = librosa.onset.onset_strength(y=y_bassi, sr=SR, hop_length=512)
    forza_b = bassi[np.clip(beats, 0, len(bassi) - 1)] if len(beats) else np.array([])
    fase = int(np.argmax([forza_b[p::4].mean() if len(forza_b[p::4]) else 0 for p in range(4)])) if len(beats) >= 8 else 0
    primo = float(beat_t[fase]) if len(beat_t) > fase else 0.0
    # Griglia regolare dal primo tempo (i brani moderni hanno il tempo fisso).
    battuta = 4 * 60.0 / bpm
    primo = primo % battuta

    tonica, minore, sicurezza = _tonalita(y)

    # Energia per battuta (per trovare intro, drop, pause).
    n_batt = int((durata - primo) // battuta)
    energia = []
    for i in range(n_batt):
        a, z = int((primo + i * battuta) * SR), int((primo + (i + 1) * battuta) * SR)
        energia.append(float(np.sqrt(np.mean(y[a:z] ** 2)) + 1e-9))

    dati = {
        "id": b["id"], "durata": round(durata, 3), "bpm": round(bpm, 2), "primo_tempo": round(primo, 4),
        "battuta": round(battuta, 5), "battute": n_batt,
        "tonica": tonica, "minore": minore, "nota": f"{NOTE[tonica]} {'minore' if minore else 'maggiore'}",
        "camelot": camelot(tonica, minore), "sicurezza_tonalita": round(sicurezza, 3),
        "energia": [round(e, 5) for e in energia],
    }
    out.write_text(json.dumps(dati, ensure_ascii=False, indent=1), encoding="utf-8")
    return dati


def drop(a: dict, minimo: int = 4) -> int:
    """Battuta in cui l'energia sale di più rispetto alle 4 precedenti (il "drop")."""
    e = np.array(a["energia"])
    if len(e) < minimo + 8:
        return min(minimo, max(len(e) - 1, 0))
    # Si cerca nella prima metà del brano, su multipli di 4 battute (le frasi musicali).
    fine = max(minimo + 5, int(len(e) * 0.5))
    cand = [i for i in range(minimo, min(fine, len(e) - 4)) if i % 4 == 0] or list(range(minimo, len(e) - 4))
    salto = [e[i:i + 4].mean() / (e[i - 4:i].mean() + 1e-9) for i in cand]
    forti = [i for i, s in zip(cand, salto) if s >= 1.5]
    return forti[0] if forti else cand[int(np.argmax(salto))]
