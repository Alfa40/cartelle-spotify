"""Separazione di voce, batteria, basso e resto con Demucs (sulla scheda video NVIDIA)."""
import shutil
import tempfile
from pathlib import Path

import numpy as np

from .percorsi import STEM, SR
from . import libreria

PARTI = ("vocals", "drums", "bass", "other")
NOMI = {"vocals": "voce", "drums": "batteria", "bass": "basso", "other": "resto"}


def cartella(b: dict) -> Path:
    return STEM / b["id"]


def separa(b: dict) -> Path:
    dest = cartella(b)
    if all((dest / f"{p}.flac").exists() for p in PARTI):
        return dest
    import torch
    from demucs.separate import main as demucs_main
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    with tempfile.TemporaryDirectory() as tmp:
        demucs_main(["-n", "htdemucs", "-d", dev, "--flac", "-o", tmp, str(libreria.percorso(b))])
        uscita = next(Path(tmp).glob("htdemucs/*"))
        dest.mkdir(parents=True, exist_ok=True)
        for p in PARTI:
            shutil.move(str(uscita / f"{p}.flac"), dest / f"{p}.flac")
    return dest


def carica(b: dict, parte: str) -> np.ndarray:
    import soundfile as sf
    y, sr = sf.read(cartella(b) / f"{parte}.flac", dtype="float32", always_2d=True)
    y = y.T
    if sr != SR:
        import librosa
        y = librosa.resample(y, orig_sr=sr, target_sr=SR)
    if y.shape[0] == 1:
        y = np.vstack([y, y])
    return y
