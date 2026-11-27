"""Claude come DJ: legge le tue indicazioni a parole ("più corto", "solo il ritornello", "voce più alta",
"drop più lungo"...) e le traduce in modifiche al preset, sapendo com'è fatto il brano."""
import json
import re
import subprocess
import sys
from pathlib import Path

from .percorsi import DATI
from . import analisi, ricette, ritmi, voce as vc

NASCOSTO = 0x08000000 if sys.platform == "win32" else 0
CLAUDE = str(Path.home() / ".local" / "bin" / ("claude.exe" if sys.platform == "win32" else "claude"))

ISTRUZIONI = """Sei il DJ di un programma che fa remix per uso personale. L'utente ha scritto delle indicazioni
per un remix: traducile in modifiche al preset. Rispondi SOLO con un oggetto JSON, senza altro testo, così:
{"modifiche": {...}, "spiegazione": "una frase semplice in italiano su cosa hai cambiato"}

Chiavi che puoi mettere in "modifiche" (metti solo quelle da cambiare):
- per i remix di genere (tipo "remix"):
  "genere": uno tra %(generi)s
  "bpm": numero (lascia stare se non serve: viene scelto da solo per non stirare la voce)
  "testo": "completo" se l'utente vuole tutto il testo dall'inizio alla fine, altrimenti non metterla
  "struttura": elenco di sezioni nell'ordine in cui suonano. Ogni sezione:
      {"nome": testo libero, "battute": numero (multiplo di 4) oppure "voce" (= lunga quanto la parte di voce),
       "base": "intro" | "pieno" | "pausa" (senza cassa) | "build" (salita col rullante) | "silenzio",
       "voce": null | "ritornello" | "strofa1" | "strofa2" | "strofa3" | "battute:A-B" (battute del brano originale),
       "effetto_voce": null | "filtro" (lontana, filtrata) | "chop" (ripetuta a raffica) | "eco",
       "ripeti": numero (solo con "battute": "voce"), "max": battute originali massime (solo con "battute": "voce")}
  "durata_max_min": minuti massimi (toglie strofe se serve)
  "vol_voce" (normale 1.1), "vol_base" (normale 0.9), "riverbero_voce" (0–0.4, normale 0.08),
  "sporco_808" (0–12, distorsione sul basso), "eq_originale" (0–1)
- per le sporche/edit (tipo "edit"): "intro_battute", "outro_battute", "bassi_db",
  "effetti": elenco tra sirena_inizio, riser_drop, stop_prima_drop, stutter_prima_drop, impatto_drop, tromba_drop, riverbero_pause, eco_finale
- per velocità (tipo "velocita"): "fattore" (es. 1.25 sped up, 0.85 slowed), "mantieni_tono" (true/false), "riverbero", "bassi_db"
- per i mashup (tipo "mashup"): "entra_battuta", "entra_al_drop" (true/false), "vol_voce", "vol_base", "vol_resto", "tonalita" ("adatta" o "fissa"), "semitoni"

Se un'indicazione non si può fare, non inventare chiavi: dillo nella spiegazione.
"""


def _riassunto(b: dict, a: dict) -> dict:
    r = {"titolo": b["titolo"], "artista": b["artista"], "bpm": a["bpm"], "tonalita": a["nota"],
         "durata_secondi": a["durata"], "battute_totali": a["battute"]}
    try:
        dv = vc.analizza_voce(b, a)
        r["ritornello"] = dv["ritornello"]
        r["strofe"] = [{"nome": f"strofa{i + 1}", **s} for i, s in enumerate(dv["strofe"])]
    except Exception:
        pass
    return r


def interpreta(nota: str, p: dict, b: dict, con: dict | None = None) -> tuple[dict, str]:
    """Restituisce (modifiche, spiegazione). Se Claude non risponde, nessuna modifica."""
    a = analisi.analizza(b)
    preset_ora = dict(p)
    if p["tipo"] == "remix" and not p.get("struttura"):
        g = ritmi.GENERI[p["genere"]]
        preset_ora["struttura"] = ricette.STRUTTURA_RAP if g.get("mezzo_tempo") or p["genere"] in ("reggaeton", "jerseyclub") else ricette.STRUTTURA_CLUB
    dati = {"preset": preset_ora, "brano": _riassunto(b, a)}
    if con:
        dati["brano_base"] = _riassunto(con, analisi.analizza(con))
    prompt = (ISTRUZIONI % {"generi": ", ".join(ritmi.GENERI)}) + \
        "\nDati:\n" + json.dumps(dati, ensure_ascii=False) + "\n\nIndicazioni dell'utente: " + nota
    try:
        r = subprocess.run([CLAUDE, "-p", "--output-format", "json"], input=prompt, capture_output=True, text=True,
                           encoding="utf-8", timeout=180, cwd=str(DATI), creationflags=NASCOSTO)
        testo = json.loads(r.stdout).get("result", "")
        m = re.search(r"\{.*\}", testo, re.S)
        risposta = json.loads(m.group(0))
        modifiche = risposta.get("modifiche") or {}
        return modifiche, risposta.get("spiegazione", "")
    except Exception as e:
        return {}, f"Non sono riuscito a leggere le indicazioni ({str(e)[:80]}): remix fatto col preset normale."
