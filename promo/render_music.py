"""Generate the ad's music bed procedurally.

No sample library ships with the repo, so the bed is synthesised: a warm sine
pad on a four-chord progression that changes with the acts, a soft sub pulse on
each act boundary, and a lift under the call to action. It is deliberately
plain - it sits at -10 dB under the narration and should never draw attention.

    python promo/render_music.py
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.abspath(__file__))
SR = 48000

# Am - F - C - G, the least obtrusive four chords in pop, voiced low and open.
CHORDS = {
    "Intro":         [220.00, 261.63, 329.63],           # Am
    "Problem":       [174.61, 220.00, 261.63],           # F
    "Use Case":      [196.00, 261.63, 329.63],           # C/G
    "Call to Action": [196.00, 246.94, 293.66, 392.00],  # G -> resolve
}


def pad(freqs, n, t0, warmth=1.0):
    """A chord as stacked sines with slow detune - no clicks, no attack."""
    t = (np.arange(n) + t0) / SR
    out = np.zeros(n, dtype=np.float64)
    for i, f in enumerate(freqs):
        drift = 1.0 + 0.0016 * np.sin(2 * np.pi * (0.07 + 0.013 * i) * t)
        for h, amp in ((1, 1.0), (2, 0.30), (3, 0.13), (4, 0.06)):
            out += amp / (1 + i * 0.5) * np.sin(2 * np.pi * f * h * drift * t)
    # a breath of air on top
    out += 0.02 * warmth * np.sin(2 * np.pi * freqs[0] * 6 * t) * \
        (0.5 + 0.5 * np.sin(2 * np.pi * 0.11 * t))
    return out / max(1.0, len(freqs) * 1.6)


def one_pole(x, cutoff):
    """Cheap warm low-pass; cutoff may be an array for a slow filter sweep."""
    a = np.exp(-2 * np.pi * np.asarray(cutoff, dtype=np.float64) / SR)
    a = np.broadcast_to(a, x.shape)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(x.shape[0]):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeline", default=os.path.join(ROOT, "out", "timeline.json"))
    ap.add_argument("--out", default=os.path.join(ROOT, "out", "bed.wav"))
    args = ap.parse_args()

    with open(args.timeline, encoding="utf-8") as fh:
        board = json.load(fh)

    # one segment per act, so the harmony turns when the story does
    acts, t = [], 0.0
    for s in board["shots"]:
        if not acts or acts[-1][0] != s["act"]:
            acts.append([s["act"], t, t + s["dur"]])
        else:
            acts[-1][2] = t + s["dur"]
        t += s["dur"]
    total = t
    n = int(total * SR)

    bed = np.zeros(n, dtype=np.float64)
    xfade = int(1.2 * SR)
    for act, a0, a1 in acts:
        i0, i1 = int(a0 * SR), min(n, int(a1 * SR) + xfade)
        seg = pad(CHORDS.get(act, CHORDS["Intro"]), i1 - i0, i0)
        env = np.ones(i1 - i0)
        k = min(xfade, len(env) // 2)
        env[:k] = np.linspace(0, 1, k) ** 1.5
        env[-k:] = np.linspace(1, 0, k) ** 1.5
        bed[i0:i1] += seg * env

    tt = np.arange(n) / SR
    # the filter opens across the ad, so the CTA feels like it lifts
    bed = one_pole(bed, 480 + 1500 * (tt / total) ** 1.4)

    # a soft sub thump on each act boundary
    for _, a0, _ in acts[1:]:
        i = int(a0 * SR)
        m = min(int(1.1 * SR), n - i)
        if m <= 0:
            continue
        e = np.exp(-np.linspace(0, 7, m))
        bed[i:i + m] += 0.30 * e * np.sin(
            2 * np.pi * 55 * np.linspace(0, m / SR, m))

    # overall shape: fade up, duck slightly under the dense middle, resolve
    shape = 0.80 + 0.20 * np.sin(2 * np.pi * tt / max(total, 1e-6))
    bed *= shape
    fi, fo = int(1.5 * SR), int(2.2 * SR)
    bed[:fi] *= np.linspace(0, 1, fi) ** 1.3
    bed[-fo:] *= np.linspace(1, 0, fo) ** 1.2

    peak = np.max(np.abs(bed)) or 1.0
    bed = (bed / peak) * 0.72
    stereo = np.stack([bed, np.roll(bed, 90)], axis=1)  # a hair of width

    import wave
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with wave.open(args.out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(stereo, -1, 1) * 32767).astype("<i2").tobytes())

    print("%s  %.1fs  acts: %s" % (args.out, total, [a[0] for a in acts]))
    print("MUSIC COMPLETE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
