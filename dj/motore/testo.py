"""Trascrizione del testo cantato con Whisper (sulla scheda video), parola per parola con i tempi.
Serve per scegliere ritornelli e strofe dal testo vero e per tagliare tra una frase e l'altra."""
import json
import re

from .percorsi import ANALISI
from . import stem

MODELLO = "large-v3-turbo"
# Frasi che Whisper a volte "inventa" nei silenzi.
INVENTATE = re.compile(r"amara\.org|sottotitoli|subtitles by|thanks for watching|thank you|grazie per la visione|iscriviti|^\s*you\.?\s*$", re.I)
_modello = None


def _carica_modello():
    global _modello
    if _modello is None:
        import torch
        import whisper
        _modello = whisper.load_model(MODELLO, device="cuda" if torch.cuda.is_available() else "cpu")
    return _modello


def trascrivi(b: dict, forza: bool = False) -> dict:
    out = ANALISI / f"{b['id']}.testo.json"
    if out.exists() and not forza:
        return json.loads(out.read_text(encoding="utf-8"))
    import numpy as np
    import whisper
    stem.separa(b)
    v = stem.carica(b, "vocals").mean(axis=0)
    m = _carica_modello()
    # Dove la voce si sente davvero (per scartare le parole "inventate" nei silenzi).
    blocco = 1600
    rms = np.sqrt(np.convolve(v ** 2, np.ones(blocco) / blocco, mode="same")[::blocco])
    soglia = 0.15 * np.percentile(rms, 95)
    voce_qui = lambda t0, t1: rms[int(t0 * 44100 / blocco):max(int(t0 * 44100 / blocco) + 1, int(t1 * 44100 / blocco))].max(initial=0) > soglia
    if np.mean(rms > soglia) < 0.05:
        dati = {"lingua": "", "parole": [], "righe": []}           # quasi strumentale
        out.write_text(json.dumps(dati, ensure_ascii=False), encoding="utf-8")
        return dati
    # Lingua: si chiede su più punti cantati e vince quella che esce più spesso.
    audio16 = whisper.load_audio(str(stem.cartella(b) / "vocals.flac"))
    energia16 = [float(np.sqrt(np.mean(audio16[i:i + 16000 * 30] ** 2))) for i in range(0, max(1, len(audio16) - 16000 * 30), 16000 * 10)]
    voti = {}
    for k in np.argsort(energia16)[::-1][:5]:
        pezzo = whisper.pad_or_trim(audio16[k * 16000 * 10:k * 16000 * 10 + 16000 * 30])
        mel = whisper.log_mel_spectrogram(pezzo, n_mels=m.dims.n_mels).to(m.device)
        _, prob = m.detect_language(mel)
        lingua = max(prob, key=prob.get)
        voti[lingua] = voti.get(lingua, 0) + prob[lingua]
    lingua = max(voti, key=voti.get)
    r = m.transcribe(audio16, language=lingua, task="transcribe", word_timestamps=True,
                     condition_on_previous_text=False, no_speech_threshold=0.6, verbose=None)
    parole = []
    for seg in r["segments"]:
        if seg.get("no_speech_prob", 0) > 0.5 and seg.get("avg_logprob", 0) < -0.8:
            continue
        if INVENTATE.search(seg["text"]):
            continue
        for w in seg.get("words", []):
            t = w["word"].strip()
            if t and voce_qui(float(w["start"]), float(w["end"])):
                parole.append({"p": t, "da": round(float(w["start"]), 3), "a": round(float(w["end"]), 3)})
    dati = {"lingua": lingua, "parole": parole, "righe": _righe(parole)}
    out.write_text(json.dumps(dati, ensure_ascii=False), encoding="utf-8")
    return dati


def _righe(parole: list[dict]) -> list[dict]:
    """Divide le parole in frasi: si va a capo dopo una pausa, dopo un punto o dopo troppe parole."""
    righe, cur = [], []
    for i, w in enumerate(parole):
        cur.append(w)
        dopo = parole[i + 1]["da"] - w["a"] if i + 1 < len(parole) else 99
        fine_frase = w["p"][-1:] in ".?!" and dopo > 0.15
        if dopo > 0.45 or fine_frase or len(cur) >= 14:
            righe.append({"testo": " ".join(x["p"] for x in cur), "da": cur[0]["da"], "a": cur[-1]["a"], "parole": cur})
            cur = []
    if cur:
        righe.append({"testo": " ".join(x["p"] for x in cur), "da": cur[0]["da"], "a": cur[-1]["a"], "parole": cur})
    return righe
