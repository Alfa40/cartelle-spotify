"""Libreria dei brani: importa i file audio legali (CD copiati, brani comprati, tracce gratis) e li ritrova."""
import hashlib
import json
import re
import shutil
import unicodedata
from pathlib import Path

import numpy as np

from .percorsi import LIBRERIA, SR

INDICE = LIBRERIA / "indice.json"
ESTENSIONI = {".mp3", ".flac", ".m4a", ".aac", ".wav", ".aiff", ".aif", ".ogg", ".opus", ".wma"}


def _slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60] or "brano"


def leggi_indice() -> list[dict]:
    if INDICE.exists():
        return json.loads(INDICE.read_text(encoding="utf-8"))
    return []


def _salva_indice(brani: list[dict]) -> None:
    INDICE.write_text(json.dumps(brani, ensure_ascii=False, indent=1), encoding="utf-8")


def _tag(path: Path) -> dict:
    """Titolo, artista, album, anno e durata letti dal file."""
    info = {"titolo": path.stem, "artista": "", "album": "", "anno": "", "durata": 0.0}
    try:
        import mutagen
        f = mutagen.File(path, easy=True)
        if f is not None:
            g = lambda k: (f.get(k) or [""])[0]
            info.update(titolo=g("title") or path.stem, artista=g("artist"), album=g("album"), anno=str(g("date"))[:4])
            if f.info and getattr(f.info, "length", None):
                info["durata"] = round(float(f.info.length), 2)
    except Exception:
        pass
    return info


def importa(percorso: str | Path) -> list[dict]:
    """Copia nella libreria un file o tutti i file audio di una cartella. Restituisce i brani nuovi."""
    percorso = Path(percorso)
    files = [percorso] if percorso.is_file() else sorted(p for p in percorso.rglob("*") if p.suffix.lower() in ESTENSIONI)
    brani = leggi_indice()
    noti = {b["impronta"] for b in brani}
    nuovi = []
    for f in files:
        impronta = hashlib.sha1(f.read_bytes()).hexdigest()[:12]
        if impronta in noti:
            continue
        info = _tag(f)
        bid = f"{_slug(info['artista'] + ' ' + info['titolo'])}-{impronta[:6]}"
        dest = LIBRERIA / f"{bid}{f.suffix.lower()}"
        shutil.copy2(f, dest)
        b = {"id": bid, "file": dest.name, "impronta": impronta, "origine": f.name, **info}
        brani.append(b)
        nuovi.append(b)
        noti.add(impronta)
    _salva_indice(brani)
    return nuovi


def trova(testo: str) -> dict:
    """Trova un brano per id o per parole del titolo/artista."""
    brani = leggi_indice()
    for b in brani:
        if b["id"] == testo:
            return b
    parole = _slug(testo).split("-")
    punti = []
    for b in brani:
        nome = _slug(f"{b['artista']} {b['titolo']} {b['origine']}")
        p = sum(1 for w in parole if w and w in nome)
        if p:
            punti.append((p, b))
    if not punti:
        raise LookupError(f"Nessun brano trovato per “{testo}”")
    punti.sort(key=lambda x: -x[0])
    return punti[0][1]


def percorso(b: dict) -> Path:
    return LIBRERIA / b["file"]


def leggi_audio(path: str | Path) -> np.ndarray:
    """Legge qualsiasi formato (mp3, flac, m4a, wav…) con ffmpeg: stereo (2, campioni) a 44,1 kHz."""
    import subprocess
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.copy()


def carica(b: dict) -> np.ndarray:
    """Audio stereo (2, campioni) a 44,1 kHz."""
    return leggi_audio(percorso(b))
