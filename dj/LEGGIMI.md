# DJ AI

Programma per il PC che prende brani avuti in modo legale (CD copiati, brani comprati, tracce gratuite)
e ne fa sporche, edit, remix di genere, mashup e versioni sped up / slowed / bassi.
Solo per uso personale: niente vendita, niente pubblicazione.

L'audio (brani, tracce separate, remix) sta in `dati/`, che non va mai su GitHub.

## Comandi

Dalla cartella `dj`:

```
.venv\Scripts\python dj.py importa "C:\percorso\cartella o file"
.venv\Scripts\python dj.py elenco
.venv\Scripts\python dj.py analizza tutti
.venv\Scripts\python dj.py preset
.venv\Scripts\python dj.py fai sporca "titolo del brano"
.venv\Scripts\python dj.py fai mashup "brano della voce" --con "brano della base"
.venv\Scripts\python dj.py remix
```

## Impostazioni standard (preset)

Sono file di testo in `dj/preset`. Per cambiarne uno, o crearne uno nuovo, si mette un file con lo stesso
nome in `dati/preset`: vince su quello di base. Con `"disattivato": true` un preset sparisce.

Tipi: `velocita` (sped up, slowed, bassi), `edit` (sporche ed edit), `remix` (voce su una base nuova:
drill, trap, afrohouse, reggaeton, jerseyclub, techno, house), `mashup` (voce di un brano sulla base di un altro).

## Come lavora

1. Analisi: BPM, griglia delle battute, tonalità (anche Camelot), energia e drop.
2. Separazione di voce, batteria, basso e resto con Demucs sulla scheda video.
3. Ricetta del preset: tagli, effetti, basi sintetizzate da zero (nessun campione preso da altri),
   cambio di velocità e tonalità.
4. Salvataggio in `.m4a` con la scritta "uso personale, non distribuire" nei dati del file.

Brani di prova: Josh Woodward, album *Ashes*, licenza Creative Commons BY 4.0 (archive.org).
