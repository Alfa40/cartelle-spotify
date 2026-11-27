"""Servizio del DJ AI sul PC.

- Risponde all'app Cartelle sull'iPhone (tramite Tailscale, solo dai tuoi dispositivi) su http://127.0.0.1:8790.
- Ogni minuto guarda se ci sono richieste nella cartella privata GitHub Alfa40/dj-coda (fatte col PC spento).
- Fa i remix uno alla volta, passando dalla coda dei lavori pesanti del PC.

Si avvia da solo all'accensione (Utilità di pianificazione, attività "DJ AI").
"""
import base64
import json
import re
import subprocess
import sys
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

if sys.stdout:  # con pythonw (senza finestra) non c'è uscita
    sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).parent))
from motore import libreria, preset as presets, rendi  # noqa: E402
from motore.percorsi import DATI, REMIX  # noqa: E402

PORTA = 8790
CHIAVE = (DATI / "servizio_chiave.txt").read_text(encoding="utf-8").strip()
REPO = "Alfa40/dj-coda"
RICHIESTE = DATI / "richieste.json"
LOG = DATI / "servizio.log"
PYTHON = str(Path(sys.executable).with_name("python.exe"))
DJ = str(Path(__file__).with_name("dj.py"))
CODA = r"C:\Progetti\coda\coda.mjs"
NASCOSTO = 0x08000000 if sys.platform == "win32" else 0  # niente finestre nere che si aprono
ORIGINI = re.compile(r"^(https://alfa40\.github\.io|http://127\.0\.0\.1(:\d+)?|http://localhost(:\d+)?)$")
CARTELLA = Path.home() / "Desktop" / "Brani per il DJ AI"
lock = threading.Lock()
da_preparare: list[str] = []
sveglia = threading.Event()


def log(msg: str) -> None:
    riga = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    if sys.stdout:
        print(riga, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(riga + "\n")


# ---------------------------------------------------------------- richieste
def leggi() -> list[dict]:
    return json.loads(RICHIESTE.read_text(encoding="utf-8")) if RICHIESTE.exists() else []


def scrivi(r: list[dict]) -> None:
    RICHIESTE.write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")


def aggiungi(req: dict, origine: str) -> dict:
    with lock:
        tutte = leggi()
        rid = str(req.get("id") or uuid.uuid4().hex[:10])
        if any(x["id"] == rid for x in tutte):
            return next(x for x in tutte if x["id"] == rid)
        x = {"id": rid, "preset": req.get("preset"), "brano": req.get("brano"), "con": req.get("con"),
             "nota": req.get("nota", ""), "stato": "in coda", "origine": origine,
             "ricevuta": time.strftime("%Y-%m-%dT%H:%M:%S")}
        tutte.append(x)
        scrivi(tutte)
    log(f"Nuova richiesta {rid} ({origine}): {x['preset']} {x['brano']}")
    sveglia.set()
    return x


def aggiorna(rid: str, **campi) -> None:
    with lock:
        tutte = leggi()
        for x in tutte:
            if x["id"] == rid:
                x.update(campi)
        scrivi(tutte)


def _trova(b: dict | str | None) -> dict | None:
    """Il brano può essere un id della libreria oppure un brano di Spotify {titolo, artisti, isrc}."""
    if not b:
        return None
    brani = libreria.leggi_indice()
    if isinstance(b, str):
        esatto = next((x for x in brani if x["id"] == b), None)
        if esatto or len(b) < 4:
            return esatto
        try:
            return libreria.trova(b)
        except LookupError:
            return None
    if b.get("id"):
        hit = next((x for x in brani if x["id"] == b["id"]), None)
        if hit:
            return hit
    if b.get("isrc"):
        hit = next((x for x in brani if x.get("isrc") and x["isrc"].upper() == b["isrc"].upper()), None)
        if hit:
            return hit
    norm = lambda s: re.sub(r"[^a-z0-9]+", " ", re.sub(r"\(.*?\)|\[.*?\]|feat\..*", "", (s or "").lower())).strip()
    t = norm(b.get("titolo"))
    artisti = [norm(a) for a in b.get("artisti", [])]
    for x in brani:
        if norm(x["titolo"]) == t and (not artisti or any(a and a in norm(x["artista"]) for a in artisti)):
            return x
    return None


def esegui(x: dict) -> None:
    b = _trova(x["brano"])
    con = _trova(x["con"]) if x.get("con") else None
    mancano = [d for d, v in ((x["brano"], b), (x.get("con"), con)) if d and v is None]
    if mancano:
        nomi = [m if isinstance(m, str) else f"{', '.join(m.get('artisti', []))} – {m.get('titolo')}" for m in mancano]
        aggiorna(x["id"], stato="manca", messaggio="Non è ancora nella libreria: " + "; ".join(nomi))
        log(f"Richiesta {x['id']}: manca {nomi}")
        return
    aggiorna(x["id"], stato="in lavorazione")
    cmd = f'"{PYTHON}" -W ignore "{DJ}" fai {x["preset"]} {b["id"]}' + (f" --con {con['id']}" if con else "")
    if x.get("nota"):
        nf = DATI / "note" / f"{x['id']}.txt"
        nf.parent.mkdir(exist_ok=True)
        nf.write_text(x["nota"], encoding="utf-8")
        cmd += f' --nota-file "{nf}"'
        aggiorna(x["id"], stato="in lavorazione", messaggio="Claude legge le tue indicazioni…")
    t = time.time()
    r = subprocess.run(["node", CODA, "--ram=8", "--gruppo=gpu", "--", cmd], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", creationflags=NASCOSTO)
    fatto = re.search(r"dati/remix/(\S+\.m4a)", r.stdout or "")
    if r.returncode == 0 and fatto:
        rem = next((v for v in rendi.leggi_indice() if v["file"] == fatto.group(1)), None)
        aggiorna(x["id"], stato="fatto", remix=rem["id"] if rem else None, secondi=round(time.time() - t),
                 messaggio=(rem or {}).get("spiegazione", ""))
        log(f"Richiesta {x['id']} fatta in {time.time() - t:.0f} s")
    else:
        errore = (r.stderr or r.stdout or "").strip().splitlines()[-1:] or ["errore sconosciuto"]
        aggiorna(x["id"], stato="errore", messaggio=errore[0][:300])
        log(f"Richiesta {x['id']} errore: {errore[0][:300]}")


def prepara(bid: str) -> None:
    cmd = f'"{PYTHON}" -W ignore "{DJ}" prepara {bid}'
    r = subprocess.run(["node", CODA, "--ram=8", "--gruppo=gpu", "--", cmd], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", creationflags=NASCOSTO)
    riga = next((x for x in (r.stdout or "").splitlines() if x.startswith("Pronto")), (r.stderr or "errore").strip()[-200:])
    log(f"Preparazione {bid}: {riga}")


def lavoratore() -> None:
    while True:
        prossima = next((x for x in leggi() if x["stato"] == "in coda"), None)
        if prossima:
            try:
                esegui(prossima)
            except Exception as e:
                aggiorna(prossima["id"], stato="errore", messaggio=str(e)[:300])
                log(traceback.format_exc())
            continue
        if da_preparare:                       # quando non ci sono remix da fare, si preparano i brani nuovi
            prepara(da_preparare.pop(0))
            continue
        sveglia.wait(30)
        sveglia.clear()


def guarda_cartella() -> None:
    """Importa da solo i file messi nella cartella "Brani per il DJ AI" sul desktop."""
    fatti = CARTELLA / "Già importati"
    fatti.mkdir(parents=True, exist_ok=True)
    leggimi = CARTELLA / "LEGGIMI.txt"
    if not leggimi.exists():
        leggimi.write_text(
            "Metti qui i brani comprati o copiati dai tuoi CD (mp3, flac, m4a, wav...), anche in sottocartelle.\n"
            "Il PC li aggiunge da solo alla libreria del DJ AI e li sposta in 'Già importati'.\n"
            "Solo file avuti in modo legale, per uso personale.\n", encoding="utf-8")
    while True:
        try:
            adesso = time.time()
            nuovi = [f for f in CARTELLA.rglob("*") if f.is_file() and f.suffix.lower() in libreria.ESTENSIONI
                     and fatti not in f.parents and adesso - f.stat().st_mtime > 15]   # 15 s: copia finita
            for f in nuovi:
                importati = libreria.importa(f)
                dest = fatti / f.relative_to(CARTELLA)
                dest.parent.mkdir(parents=True, exist_ok=True)
                f.replace(dest)
                for b in importati:
                    log(f"Importato dalla cartella: {b['artista']} – {b['titolo']}")
                    da_preparare.append(b["id"])
                    sveglia.set()
        except Exception as e:
            log(f"Cartella brani: {str(e)[:200]}")
        time.sleep(60)


# ---------------------------------------------------------------- coda su GitHub
def gh(*args: str) -> str:
    return subprocess.run(["gh", "api", *args], capture_output=True, text=True, encoding="utf-8", check=True,
                          creationflags=NASCOSTO).stdout


def controlla_github() -> None:
    while True:
        try:
            files = json.loads(gh(f"repos/{REPO}/contents/richieste"))
            for f in files:
                if not f["name"].endswith(".json"):
                    continue
                d = json.loads(gh(f"repos/{REPO}/contents/richieste/{f['name']}"))
                req = json.loads(base64.b64decode(d["content"]).decode("utf-8"))
                aggiungi(req, "github")
                gh("-X", "DELETE", f"repos/{REPO}/contents/richieste/{f['name']}",
                   "-f", "message=Richiesta presa dal PC", "-f", f"sha={d['sha']}")
        except Exception as e:
            log(f"GitHub non raggiungibile: {str(e)[:200]}")
        time.sleep(60)


# ---------------------------------------------------------------- web
class Gestore(BaseHTTPRequestHandler):
    def log_message(self, *a):  # niente righe per ogni richiesta
        pass

    def _cors(self):
        o = self.headers.get("Origin", "")
        if ORIGINI.match(o):
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Chiave, Range")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Range")

    def _json(self, dati, stato=200):
        corpo = json.dumps(dati, ensure_ascii=False).encode("utf-8")
        self.send_response(stato)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corpo)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _autorizzato(self) -> bool:
        if self.headers.get("X-Chiave") == CHIAVE:
            return True
        self._json({"errore": "chiave mancante o sbagliata"}, 401)
        return False

    def do_GET(self):
        try:
            self._get()
        except Exception as e:
            log(f"Errore GET {self.path}: {e}")
            self._json({"errore": str(e)[:200]}, 500)

    def do_POST(self):
        try:
            self._post()
        except Exception as e:
            log(f"Errore POST {self.path}: {e}")
            self._json({"errore": str(e)[:200]}, 500)

    def _get(self):
        p = urlparse(self.path).path
        if p == "/api/stato":
            return self._json({"ok": True, "versione": 1})
        if not self._autorizzato():
            return
        if p == "/api/brani":
            return self._json([{k: b.get(k) for k in ("id", "titolo", "artista", "album", "anno", "durata", "isrc")}
                               for b in libreria.leggi_indice()])
        if p == "/api/preset":
            return self._json([{"id": k, "nome": v.get("nome", k), "descrizione": v.get("descrizione", ""), "tipo": v["tipo"]}
                               for k, v in presets.elenco().items()])
        if p == "/api/remix":
            return self._json(rendi.leggi_indice())
        if p == "/api/richieste":
            return self._json(leggi()[-100:])
        m = re.match(r"^/api/audio/([\w\-]+\.m4a)$", p)
        if m:
            f = REMIX / unquote(m.group(1))
            if not f.exists():
                return self._json({"errore": "non trovato"}, 404)
            dati = f.read_bytes()
            inizio, fine, stato = 0, len(dati) - 1, 200
            rng = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
            if rng and (rng.group(1) or rng.group(2)):
                inizio = int(rng.group(1) or 0)
                fine = min(int(rng.group(2)) if rng.group(2) else len(dati) - 1, len(dati) - 1)
                stato = 206
            self.send_response(stato)
            self._cors()
            self.send_header("Content-Type", "audio/mp4")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(fine - inizio + 1))
            if stato == 206:
                self.send_header("Content-Range", f"bytes {inizio}-{fine}/{len(dati)}")
            self.end_headers()
            self.wfile.write(dati[inizio:fine + 1])
            return
        self._json({"errore": "non trovato"}, 404)

    def _post(self):
        if not self._autorizzato():
            return
        p = urlparse(self.path).path
        lung = int(self.headers.get("Content-Length") or 0)
        try:
            grezzo = self.rfile.read(lung) or b"{}"
            try:
                testo = grezzo.decode("utf-8")
            except UnicodeDecodeError:
                testo = grezzo.decode("cp1252", errors="replace")
            corpo = json.loads(testo)
        except ValueError:
            return self._json({"errore": "richiesta non valida"}, 400)
        if p == "/api/richiesta":
            if not corpo.get("preset") or not corpo.get("brano"):
                return self._json({"errore": "servono preset e brano"}, 400)
            return self._json(aggiungi(corpo, "telefono"))
        self._json({"errore": "non trovato"}, 404)


def main() -> None:
    # Le richieste rimaste a metà (PC spento durante il lavoro) ripartono.
    with lock:
        tutte = leggi()
        for x in tutte:
            if x["stato"] == "in lavorazione":
                x["stato"] = "in coda"
        scrivi(tutte)
    threading.Thread(target=lavoratore, daemon=True).start()
    threading.Thread(target=controlla_github, daemon=True).start()
    threading.Thread(target=guarda_cartella, daemon=True).start()
    log(f"DJ AI in ascolto su 127.0.0.1:{PORTA}")
    ThreadingHTTPServer(("127.0.0.1", PORTA), Gestore).serve_forever()


if __name__ == "__main__":
    main()
