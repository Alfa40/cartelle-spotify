"""Basi ritmiche dei generi (drill, trap, afro house, reggaeton, jersey club, techno, house), sintetizzate.

Ogni genere ha uno schema di 2 battute da 16 passi (32 passi). I passi possono avere decimali (terzine).
Il basso usa i gradi della scala del brano: 0 = tonica, 2 = terza, 4 = quinta, 6 = settima, -3 = quinta sotto.
"""
import numpy as np

from .percorsi import SR
from . import suoni
from .effetti import catena, stereo
from pedalboard import LowpassFilter, HighpassFilter, Reverb

ED = [x for x in range(0, 32, 2)]          # ottavi
SED = list(range(32))                       # sedicesimi
BATTITI = [0, 4, 8, 12, 16, 20, 24, 28]     # cassa dritta

GENERI = {
    "drill": dict(intervallo=(138, 146), bpm=142, mezzo_tempo=True, basso="808",
                  kick=[0, 11, 16, 22, 27], snare=[8, 24], hat=SED[::2] + [13.33, 14.67, 29.33, 30.67],
                  basso_note=[(0, 10, 0), (11, 5, 0), (16, 6, 2), (22, 5, -3), (27, 5, 0)]),
    "trap": dict(intervallo=(130, 150), bpm=140, mezzo_tempo=True, basso="808",
                 kick=[0, 7, 10, 16, 19, 26], clap=[8, 24], hat=SED[::2] + [28.5, 29, 29.5, 30, 30.5, 31, 31.5],
                 basso_note=[(0, 7, 0), (7, 3, 0), (10, 6, 0), (16, 3, 2), (19, 7, 2), (26, 6, -3)]),
    "reggaeton": dict(intervallo=(88, 100), bpm=95, basso="808",
                      kick=BATTITI, snare=[3, 6, 11, 14, 19, 22, 27, 30], hat=[2, 6, 10, 14, 18, 22, 26, 30],
                      basso_note=[(0, 3, 0), (3, 3, 0), (6, 2, 0), (8, 3, 2), (11, 3, 2), (14, 2, 2),
                                  (16, 3, 4), (19, 3, 4), (22, 2, 4), (24, 3, -3), (27, 3, -3), (30, 2, -3)]),
    "afrohouse": dict(intervallo=(118, 126), bpm=122, basso="corto",
                      kick=BATTITI, rim=[4, 12, 20, 28], shaker=SED, hat_aperto=[2, 6, 10, 14, 18, 22, 26, 30],
                      conga_alta=[3, 7, 10, 14, 19, 23, 26, 30], conga_bassa=[6, 22],
                      basso_note=[(2, 2, 0), (6, 2, 0), (10, 2, 4), (14, 2, 0), (18, 2, 0), (22, 2, 2), (26, 2, 4), (30, 2, 0)]),
    "jerseyclub": dict(intervallo=(135, 145), bpm=140, basso="808",
                       kick=[0, 4, 8, 10, 14, 16, 20, 22, 24, 26, 28, 30], clap=[4, 12, 20, 28], hat=ED,
                       basso_note=[(0, 4, 0), (8, 2, 0), (10, 4, 2), (16, 4, 4), (22, 2, 0), (24, 6, -3)]),
    "techno": dict(intervallo=(124, 135), bpm=130, basso="rumble",
                   kick=BATTITI, clap=[4, 12, 20, 28], hat=SED, hat_aperto=[2, 6, 10, 14, 18, 22, 26, 30],
                   basso_note=[(b + 1, 3, 0) for b in BATTITI]),
    "house": dict(intervallo=(120, 128), bpm=124, basso="corto",
                  kick=BATTITI, clap=[4, 12, 20, 28], hat_aperto=[2, 6, 10, 14, 18, 22, 26, 30], shaker=SED[1::2],
                  basso_note=[(2, 2, 0), (6, 2, 0), (10, 2, 0), (14, 2, 4), (18, 2, 0), (22, 2, 0), (26, 2, 2), (30, 2, 4)]),
}

SCALA = {False: [0, 2, 4, 5, 7, 9, 11], True: [0, 2, 3, 5, 7, 8, 10]}


def _grado(tonica: int, minore: bool, g: int) -> int:
    sc = SCALA[minore]
    ott, i = divmod(g, 7)
    return tonica + sc[i] + 12 * ott


def battuta_s(genere: str, bpm: float | None = None) -> float:
    return 4 * 60.0 / (bpm or GENERI[genere]["bpm"])


def base(genere: str, sezioni: list[str], tonica: int, minore: bool, bpm: float | None = None) -> np.ndarray:
    """Costruisce la base. sezioni: per ogni battuta 'intro', 'pieno', 'pausa' o 'silenzio'."""
    g = GENERI[genere]
    bat = battuta_s(genere, bpm)
    passo = bat / 16
    n = int(len(sezioni) * bat * SR) + SR * 2
    tracce = {k: np.zeros(n, dtype=np.float32) for k in ("batt", "alto", "basso")}
    suono = {
        "kick": (suoni.kick(), "batt", 1.0), "snare": (suoni.snare(), "batt", 0.8), "clap": (suoni.clap(), "batt", 0.8),
        "rim": (suoni.rim(), "alto", 0.6), "hat": (suoni.hat(), "alto", 0.55), "hat_aperto": (suoni.hat(True), "alto", 0.5),
        "shaker": (suoni.shaker(), "alto", 0.6), "conga_alta": (suoni.conga(360), "alto", 0.6),
        "conga_bassa": (suoni.conga(220), "alto", 0.7),
    }
    nota_tonica = tonica % 12
    for b, sez in enumerate(sezioni):
        if sez == "silenzio":
            continue
        meta = (b % 2) * 16
        for nome, (s, traccia, vol) in suono.items():
            if nome not in g:
                continue
            if sez == "pausa" and nome in ("kick", "snare", "conga_bassa"):
                continue
            if sez == "intro" and nome not in ("kick", "hat", "shaker", "hat_aperto", "rim"):
                continue
            for st in g[nome]:
                if meta <= st < meta + 16:
                    pos = int((b * bat + (st - meta) * passo) * SR)
                    seg = s[: n - pos]
                    tracce[traccia][pos:pos + len(seg)] += vol * seg
        if sez in ("pieno",):
            prev = None
            for st, lung, grado in g["basso_note"]:
                if not (meta <= st < meta + 16):
                    continue
                semi = _grado(nota_tonica, minore, grado)
                f = 32.70 * 2 ** (semi / 12)
                while f < 38:      # tutte le note del basso tra circa 38 e 76 Hz
                    f *= 2
                while f > 76:
                    f /= 2
                dur = lung * passo
                if g["basso"] == "808":
                    x = suoni.nota_808(f, dur * 0.98, da=prev if prev and prev != f else None)
                elif g["basso"] == "rumble":
                    x = suoni.basso(f, dur * 0.9) * 0.6
                else:
                    x = suoni.basso(f * 2, dur * 0.8)
                prev = f
                pos = int((b * bat + (st - meta) * passo) * SR)
                tracce["basso"][pos:pos + len(x)] += x[: n - pos]
    batt = stereo(tracce["batt"])
    alto = catena(stereo(tracce["alto"]), HighpassFilter(300))
    bas = stereo(tracce["basso"])
    if g["basso"] == "rumble":
        bas = catena(bas, Reverb(room_size=0.6, wet_level=0.4, dry_level=0.7), LowpassFilter(160))
    # "Sidechain": il basso si abbassa un attimo su ogni cassa.
    if "kick" in g:
        duck = np.ones(n, dtype=np.float32)
        for b, sez in enumerate(sezioni):
            if sez != "pieno":
                continue
            meta = (b % 2) * 16
            for st in g["kick"]:
                if meta <= st < meta + 16:
                    p = int((b * bat + (st - meta) * passo) * SR)
                    k = min(int(0.09 * SR), n - p)
                    duck[p:p + k] = np.minimum(duck[p:p + k], np.linspace(0.35, 1, k))
        bas = bas * duck[None, :]
    mix = batt + 0.8 * alto + 0.9 * bas
    # Nell'intro la base parte chiusa (filtro) e si apre.
    intro = sum(1 for s in sezioni if s == "intro")
    if intro:
        z = int(intro * bat * SR)
        from .effetti import filtro_sweep
        mix[:, :z] = filtro_sweep(mix[:, :z], 400, 16000)
    return mix
