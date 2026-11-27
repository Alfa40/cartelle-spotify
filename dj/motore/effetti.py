"""Effetti da DJ sull'audio stereo (2, campioni)."""
import numpy as np
from pedalboard import (Compressor, Delay, Distortion, Gain, HighpassFilter, Limiter, LowpassFilter,
                        LowShelfFilter, Pedalboard, Reverb, time_stretch)

from .percorsi import SR


def stereo(x: np.ndarray) -> np.ndarray:
    return np.vstack([x, x]).astype(np.float32) if x.ndim == 1 else x.astype(np.float32)


def adatta(x: np.ndarray, n: int) -> np.ndarray:
    """Taglia o allunga con silenzio fino a n campioni."""
    x = stereo(x)
    if x.shape[1] >= n:
        return x[:, :n]
    return np.pad(x, ((0, 0), (0, n - x.shape[1])))


def metti(dest: np.ndarray, x: np.ndarray, pos: int, vol: float = 1.0) -> None:
    """Somma x dentro dest a partire da pos (campioni), senza uscire dai bordi."""
    x = stereo(x)
    if pos < 0:
        x, pos = x[:, -pos:], 0
    n = min(x.shape[1], dest.shape[1] - pos)
    if n > 0:
        dest[:, pos:pos + n] += vol * x[:, :n]


def stira(x: np.ndarray, velocita: float, semitoni: float = 0.0) -> np.ndarray:
    """Cambia velocità senza cambiare tono (e/o cambia tono senza cambiare velocità)."""
    if abs(velocita - 1) < 1e-3 and abs(semitoni) < 1e-3:
        return stereo(x)
    return stereo(time_stretch(stereo(x), SR, stretch_factor=velocita, pitch_shift_in_semitones=semitoni,
                               high_quality=True))


def velocita_nastro(x: np.ndarray, fattore: float) -> np.ndarray:
    """Velocità come un giradischi: più veloce = più acuto (sped up), più lento = più grave (slowed)."""
    import librosa
    return stereo(librosa.resample(stereo(x), orig_sr=SR * fattore, target_sr=SR))


def catena(x: np.ndarray, *effetti) -> np.ndarray:
    return stereo(Pedalboard(list(effetti))(stereo(x), SR))


def riverbero(x: np.ndarray, quantita=0.3, stanza=0.7) -> np.ndarray:
    return catena(x, Reverb(room_size=stanza, wet_level=quantita, dry_level=1 - quantita * 0.5, width=1.0))


def bassi(x: np.ndarray, db=6.0, freq=90.0) -> np.ndarray:
    return catena(x, LowShelfFilter(cutoff_frequency_hz=freq, gain_db=db))


def sporco(x: np.ndarray, quanto=8.0) -> np.ndarray:
    return catena(x, Distortion(drive_db=quanto), Gain(-quanto / 2))


def filtro_sweep(x: np.ndarray, da: float, a: float, passa_basso=True, blocchi=48) -> np.ndarray:
    """Filtro che si apre (o si chiude) lungo tutto il pezzo x."""
    x = stereo(x)
    out = np.zeros_like(x)
    n = max(1, x.shape[1] // blocchi)
    for i in range(blocchi):
        f = da * (a / da) ** (i / max(blocchi - 1, 1))
        seg = x[:, i * n:(i + 1) * n if i < blocchi - 1 else None]
        filt = LowpassFilter(cutoff_frequency_hz=f) if passa_basso else HighpassFilter(cutoff_frequency_hz=f)
        out[:, i * n:i * n + seg.shape[1]] = Pedalboard([filt])(seg, SR, reset=False)
    return out


def eco_finale(x: np.ndarray, battito_s: float) -> np.ndarray:
    """Eco a tempo che sfuma (echo out)."""
    coda = np.zeros((2, int(battito_s * 8 * SR)), dtype=np.float32)
    y = np.concatenate([stereo(x), coda], axis=1)
    return catena(y, Delay(delay_seconds=battito_s * 0.75, feedback=0.55, mix=0.5), HighpassFilter(250))


def stop_nastro(x: np.ndarray) -> np.ndarray:
    """Effetto "stop del giradischi": rallenta fino a fermarsi."""
    x = stereo(x)
    n = x.shape[1]
    pos = np.cumsum(np.linspace(1, 0.02, n))
    pos = pos[pos < n - 1]
    i = pos.astype(int)
    fr = pos - i
    out = x[:, i] * (1 - fr) + x[:, i + 1] * fr
    return adatta(out * np.linspace(1, 0.3, out.shape[1]), n)


def stutter(x: np.ndarray, pezzo_s: float, volte: int) -> np.ndarray:
    """Ripete l'inizio di x tante volte (stutter / roll)."""
    x = stereo(x)
    n = int(pezzo_s * SR)
    p = x[:, :n] * np.r_[np.ones(n - 64), np.linspace(1, 0, 64)][None, :] if n > 64 else x[:, :n]
    return np.concatenate([p] * volte, axis=1)


def dissolvi(x: np.ndarray, in_s=0.0, out_s=0.0) -> np.ndarray:
    x = stereo(x).copy()
    a, z = int(in_s * SR), int(out_s * SR)
    if a:
        x[:, :a] *= np.linspace(0, 1, a)
    if z:
        x[:, -z:] *= np.linspace(1, 0, z)
    return x


def finalizza(x: np.ndarray, rms_db=-12.0) -> np.ndarray:
    """Volume finale: compressione leggera, volume medio fisso e limitatore (niente distorsione)."""
    x = catena(x, Compressor(threshold_db=-14, ratio=2.5, attack_ms=10, release_ms=120))
    rms = np.sqrt(np.mean(x ** 2)) + 1e-9
    x = x * (10 ** (rms_db / 20) / rms)
    # Limitatore morbido: sotto 0,7 non tocca niente, sopra arrotonda e non supera mai 1.
    a = np.abs(x)
    soglia = 0.7
    x = np.where(a > soglia, np.sign(x) * (soglia + (1 - soglia) * np.tanh((a - soglia) / (1 - soglia))), x)
    picco = np.abs(x).max() + 1e-9
    return (x * min(1.0, 0.79 / picco)).astype(np.float32)   # margine di -2 dB: la compressione AAC alza un po' i picchi
