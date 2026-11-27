"""Suoni sintetizzati da zero (batteria, 808, sirene, riser): nessun campione preso da altri."""
import numpy as np

from .percorsi import SR

_rng = np.random.default_rng(7)


def _t(dur: float) -> np.ndarray:
    return np.arange(int(dur * SR)) / SR


def _env(dur: float, decad: float, attacco: float = 0.002) -> np.ndarray:
    t = _t(dur)
    e = np.exp(-t / decad)
    a = int(attacco * SR)
    if a:
        e[:a] *= np.linspace(0, 1, a)
    return e


def _hp(x: np.ndarray, f: float) -> np.ndarray:
    from scipy.signal import butter, sosfilt
    return sosfilt(butter(2, f, "highpass", fs=SR, output="sos"), x)


def _bp(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    from scipy.signal import butter, sosfilt
    return sosfilt(butter(2, [lo, hi], "bandpass", fs=SR, output="sos"), x)


def kick(f0=160.0, f1=45.0, dur=0.45, click=0.3) -> np.ndarray:
    t = _t(dur)
    f = f1 + (f0 - f1) * np.exp(-t / 0.035)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(dur, 0.16)
    x[: int(0.004 * SR)] += click * _rng.uniform(-1, 1, int(0.004 * SR))
    return np.tanh(1.6 * x)


def snare(dur=0.25) -> np.ndarray:
    t = _t(dur)
    tono = np.sin(2 * np.pi * 190 * t) * _env(dur, 0.05)
    rum = _bp(_rng.uniform(-1, 1, len(t)), 1200, 6000) * _env(dur, 0.07)
    return 0.7 * tono + 0.6 * rum


def clap(dur=0.3) -> np.ndarray:
    x = np.zeros(int(dur * SR))
    for k, ritardo in enumerate((0, 0.011, 0.022, 0.034)):
        a = int(ritardo * SR)
        n = len(x) - a
        x[a:] += _bp(_rng.uniform(-1, 1, n), 800, 4000) * _env(n / SR, 0.012 if k < 3 else 0.09)
    return 0.7 * x


def rim(dur=0.08) -> np.ndarray:
    t = _t(dur)
    return (np.sin(2 * np.pi * 1700 * t) + 0.5 * np.sin(2 * np.pi * 820 * t)) * _env(dur, 0.012) * 0.6


def hat(aperto=False) -> np.ndarray:
    dur = 0.35 if aperto else 0.06
    x = _bp(_rng.uniform(-1, 1, int(dur * SR)), 5500, 9500) * _env(dur, 0.12 if aperto else 0.018)
    return 0.45 * x


def shaker() -> np.ndarray:
    dur = 0.09
    return 0.25 * _bp(_rng.uniform(-1, 1, int(dur * SR)), 4000, 11000) * _env(dur, 0.03, attacco=0.012)


def conga(f=330.0, dur=0.22) -> np.ndarray:
    t = _t(dur)
    ff = f * (1 + 0.25 * np.exp(-t / 0.01))
    return 0.55 * np.sin(2 * np.pi * np.cumsum(ff) / SR) * _env(dur, 0.07)


def nota_808(freq: float, dur: float, da: float | None = None, satur=2.2) -> np.ndarray:
    """808 lungo con eventuale scivolata (glide) da un'altra nota."""
    t = _t(dur)
    f = np.full_like(t, freq)
    if da:
        g = min(0.09, dur / 2)
        n = int(g * SR)
        f[:n] = np.geomspace(da, freq, n)
    f = f * (1 + 0.5 * np.exp(-t / 0.02))  # punch iniziale
    x = np.sin(2 * np.pi * np.cumsum(f) / SR)
    e = np.exp(-t / max(dur * 0.9, 0.2))
    rel = min(int(0.02 * SR), len(t))
    e[-rel:] *= np.linspace(1, 0, rel)
    return np.tanh(satur * x * e) * 0.8


def basso(freq: float, dur: float) -> np.ndarray:
    """Basso corto e rotondo (afro, house)."""
    t = _t(dur)
    x = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * 2 * freq * t)
    e = _env(dur, dur * 0.5, attacco=0.004)
    rel = min(int(0.01 * SR), len(t))
    e[-rel:] *= np.linspace(1, 0, rel)
    return np.tanh(1.5 * x * e) * 0.7


def sirena(dur=2.0, f_lo=600, f_hi=1400, giri=4) -> np.ndarray:
    t = _t(dur)
    f = f_lo + (f_hi - f_lo) * (0.5 + 0.5 * np.sin(2 * np.pi * giri / dur * t))
    x = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * 0.25
    return x * np.minimum(1, t / 0.05) * np.minimum(1, (dur - t) / 0.2)


def riser(dur=4.0) -> np.ndarray:
    """Rumore che sale prima del drop."""
    t = _t(dur)
    rum = _rng.uniform(-1, 1, len(t))
    from scipy.signal import butter, sosfilt
    blocchi = 32
    out = np.zeros_like(rum)
    n = len(rum) // blocchi
    for i in range(blocchi):
        f = 300 * (40 ** (i / blocchi))
        seg = rum[i * n:(i + 1) * n]
        out[i * n:(i + 1) * n] = sosfilt(butter(2, min(f, 16000), "highpass", fs=SR, output="sos"), seg)
    return out * (t / dur) ** 2 * 0.5


def impatto(dur=2.5) -> np.ndarray:
    """Colpo profondo sul drop."""
    t = _t(dur)
    f = 30 + 90 * np.exp(-t / 0.08)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(dur, 0.6)
    rum = _hp(_rng.uniform(-1, 1, len(t)), 200) * _env(dur, 0.25) * 0.3
    return np.tanh(1.5 * (boom + rum)) * 0.8


def freq_nota(semitono_da_do: int, ottava: int = 1) -> float:
    """Frequenza della nota (0 = Do) all'ottava indicata (ottava 1 ≈ 32–62 Hz, zona 808)."""
    return 32.70 * 2 ** (semitono_da_do / 12) * 2 ** (ottava - 1)


def tromba(dur=0.9, colpi=3) -> np.ndarray:
    """Tromba da stadio (air horn), sintetizzata: colpi brevi e poi uno lungo."""
    out = []
    for k in range(colpi):
        d = dur if k == colpi - 1 else 0.16
        t = _t(d)
        vib = 1 + 0.006 * np.sin(2 * np.pi * 6 * t)
        x = sum(((2 * ((f * vib * t) % 1) - 1) * a) for f, a in ((466, 1), (587, 0.6), (698, 0.5), (932, 0.3)))
        e = np.minimum(1, t / 0.01) * np.minimum(1, (d - t) / 0.03)
        out += [np.tanh(1.2 * x * e) * 0.3, np.zeros(int(0.05 * SR))]
    return _bp(np.concatenate(out), 300, 5000)
