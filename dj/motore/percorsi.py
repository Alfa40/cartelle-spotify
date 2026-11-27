"""Cartelle usate dal DJ AI. L'audio resta tutto in dati/ (non va mai su GitHub)."""
from pathlib import Path

RADICE = Path(__file__).resolve().parents[2]
DATI = RADICE / "dati"
LIBRERIA = DATI / "libreria"        # i brani importati (copie dei tuoi file)
ANALISI = DATI / "analisi"          # BPM, battute, tonalità di ogni brano
STEM = DATI / "stem"                # voce, batteria, basso, resto separati
REMIX = DATI / "remix"              # i risultati
PRESET_BASE = RADICE / "dj" / "preset"     # impostazioni standard (nel codice)
PRESET_UTENTE = DATI / "preset"            # le tue modifiche e i tuoi preset nuovi

SR = 44100  # frequenza di lavoro

for p in (LIBRERIA, ANALISI, STEM, REMIX, PRESET_UTENTE):
    p.mkdir(parents=True, exist_ok=True)
