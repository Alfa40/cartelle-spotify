"""Salvataggio dei remix: file .m4a con la scritta "uso personale, non distribuire" dentro i dati del file,
più un elenco (dati/remix/indice.json) che l'app userà per la pagina "I miei remix"."""
import datetime as dt
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from .percorsi import REMIX, SR

INDICE = REMIX / "indice.json"
AVVISO = "Remix privato creato con il DJ AI per uso personale. Non vendere, non pubblicare, non distribuire."


def leggi_indice() -> list[dict]:
    return json.loads(INDICE.read_text(encoding="utf-8")) if INDICE.exists() else []


def salva(y: np.ndarray, titolo: str, preset: dict, brani: list[dict]) -> dict:
    import soundfile as sf
    rid = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = REMIX / f"{rid}.m4a"
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "x.wav"
        sf.write(wav, y.T, SR, subtype="PCM_24")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-c:a", "aac", "-b:a", "256k",
                        "-metadata", f"title={titolo}", "-metadata", "artist=DJ AI (privato)",
                        "-metadata", f"comment={AVVISO}", "-metadata", f"copyright={AVVISO}", str(dest)], check=True)
    voce = {"id": rid, "file": dest.name, "titolo": titolo, "preset": preset["id"], "preset_nome": preset.get("nome", preset["id"]),
            "brani": [{"id": b["id"], "titolo": b["titolo"], "artista": b["artista"]} for b in brani],
            "durata": round(y.shape[1] / SR, 1), "creato": dt.datetime.now().isoformat(timespec="seconds")}
    indice = leggi_indice()
    indice.insert(0, voce)
    INDICE.write_text(json.dumps(indice, ensure_ascii=False, indent=1), encoding="utf-8")
    return voce
