"""DJ AI — comandi.

  python dj.py importa <file o cartella>        aggiunge brani alla libreria
  python dj.py elenco                           brani in libreria
  python dj.py analizza <brano | tutti>         BPM, tonalità, battute (+ separa voce e strumenti)
  python dj.py preset                           impostazioni standard disponibili
  python dj.py fai <preset> <brano> [--con <brano>]   crea il remix (per i mashup: voce dal primo, base dal secondo)
  python dj.py remix                            remix già fatti
  python dj.py prepara <brano>                  prepara un brano per i remix (analisi, voce, testo)

<brano> può essere l'id oppure qualche parola del titolo o dell'artista.
"""
import argparse
import json
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")

from motore import analisi, libreria, preset, rendi, ricette, stem  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="DJ AI")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("importa").add_argument("percorso")
    sub.add_parser("elenco")
    an = sub.add_parser("analizza")
    an.add_argument("brano")
    an.add_argument("--senza-stem", action="store_true")
    sub.add_parser("preset")
    fa = sub.add_parser("fai")
    fa.add_argument("preset")
    fa.add_argument("brano")
    fa.add_argument("--con")
    fa.add_argument("--titolo")
    fa.add_argument("--nota", help="indicazioni a parole, lette da Claude")
    fa.add_argument("--nota-file", help="file di testo con le indicazioni (usato dal servizio)")
    sub.add_parser("remix")
    sub.add_parser("prepara").add_argument("brano")
    a = ap.parse_args()

    if a.cmd == "importa":
        nuovi = libreria.importa(a.percorso)
        print(f"Importati {len(nuovi)} brani")
        for b in nuovi:
            print(f"  {b['id']}  {b['artista']} – {b['titolo']}")
    elif a.cmd == "elenco":
        for b in libreria.leggi_indice():
            print(f"{b['id']}  {b['artista']} – {b['titolo']}  ({b['durata']:.0f} s)")
    elif a.cmd == "analizza":
        brani = libreria.leggi_indice() if a.brano == "tutti" else [libreria.trova(a.brano)]
        for b in brani:
            t = time.time()
            x = analisi.analizza(b)
            if not a.senza_stem:
                stem.separa(b)
            print(f"{b['titolo']}: {x['bpm']} BPM, {x['nota']} ({x['camelot']}), {x['battute']} battute, "
                  f"drop alla battuta {analisi.drop(x)}  [{time.time() - t:.1f} s]")
    elif a.cmd == "preset":
        for k, p in preset.elenco().items():
            print(f"{k:16} {p.get('nome', k)} — {p.get('descrizione', '')}")
    elif a.cmd == "fai":
        p = preset.carica(a.preset)
        b = libreria.trova(a.brano)
        con = libreria.trova(a.con) if a.con else None
        t = time.time()
        nota = a.nota or (open(a.nota_file, encoding="utf-8").read().strip() if a.nota_file else "")
        spiegazione = ""
        if nota:
            from motore import claude_dj
            modifiche, spiegazione = claude_dj.interpreta(nota, p, b, con)
            p = {**p, **modifiche}
            print(f"Claude: {spiegazione}")
            print(f"Modifiche: {json.dumps(modifiche, ensure_ascii=False)}")
        ricette.ULTIMO_PIANO = []
        y = ricette.fai(p, b, con)
        titolo = a.titolo or (f"{b['titolo']} × {con['titolo']} ({p.get('nome', p['id'])})" if con
                              else f"{b['titolo']} ({p.get('nome', p['id'])})")
        v = rendi.salva(y, titolo, p, [b] + ([con] if con else []), nota=nota, spiegazione=spiegazione, piano=ricette.ULTIMO_PIANO)
        print(f"Fatto in {time.time() - t:.1f} s: {titolo} → dati/remix/{v['file']} ({v['durata']:.0f} s)")
    elif a.cmd == "prepara":
        # Tutto il lavoro lungo fatto prima: tempo, voce separata, testo, ritornello e strofe.
        from motore import voce
        b = libreria.trova(a.brano)
        t = time.time()
        x = analisi.analizza(b)
        stem.separa(b)
        dv = voce.analizza_voce(b, x)
        rit = dv.get("ritornello") or {}
        print(f"Pronto in {time.time() - t:.0f} s: {b['titolo']} — {x['bpm']} BPM, {x['nota']}, "
              f"ritornello: {' / '.join(rit.get('righe', [])[:2]) or 'non trovato'}")
    elif a.cmd == "remix":
        for v in rendi.leggi_indice():
            print(f"{v['id']}  {v['titolo']}  ({v['durata']:.0f} s)")


if __name__ == "__main__":
    main()
