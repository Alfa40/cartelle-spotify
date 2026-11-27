"""Impostazioni standard ("preset"). Quelle di base stanno in dj/preset; le tue modifiche e i tuoi preset
nuovi in dati/preset con lo stesso nome file: vincono sulle base. Con "disattivato": true un preset sparisce."""
import json

from .percorsi import PRESET_BASE, PRESET_UTENTE


def elenco() -> dict[str, dict]:
    tutti = {}
    for cartella in (PRESET_BASE, PRESET_UTENTE):
        for f in sorted(cartella.glob("*.json")):
            p = json.loads(f.read_text(encoding="utf-8"))
            p["id"] = f.stem
            tutti[f.stem] = {**tutti.get(f.stem, {}), **p}
    return {k: v for k, v in tutti.items() if not v.get("disattivato")}


def carica(nome: str) -> dict:
    tutti = elenco()
    if nome not in tutti:
        raise LookupError(f"Preset “{nome}” non trovato. Ci sono: {', '.join(tutti)}")
    return tutti[nome]


def salva_utente(nome: str, dati: dict) -> None:
    """Crea o modifica un preset tuo (anche partendo da uno di base)."""
    (PRESET_UTENTE / f"{nome}.json").write_text(json.dumps(dati, ensure_ascii=False, indent=1), encoding="utf-8")


def togli(nome: str) -> None:
    salva_utente(nome, {**carica(nome), "disattivato": True})
