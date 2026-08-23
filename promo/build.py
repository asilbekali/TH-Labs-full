"""Run the whole promo build, in order.

    python promo/build.py                  # everything, reusing what exists
    python promo/build.py --skip broll     # e.g. leave ComfyUI out of it
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
TIMELINE = os.path.join(ROOT, "out", "timeline.json")

STEPS = [
    ("vo",       ["render_vo.py"]),
    ("music",    ["render_music.py"]),
    ("broll",    ["comfy_broll.py", "--storyboard", TIMELINE]),
    ("cards",    ["render_cards.py", "--storyboard", TIMELINE]),
    ("assemble", ["assemble.py"]),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip", nargs="*", default=[],
                    help="stage names to skip: " + " ".join(n for n, _ in STEPS))
    ap.add_argument("--only", nargs="*", default=None)
    args = ap.parse_args()

    for name, argv in STEPS:
        if name in args.skip or (args.only and name not in args.only):
            print("== skip %s" % name, flush=True)
            continue
        print("\n== %s" % name, flush=True)
        t0 = time.time()
        r = subprocess.run([sys.executable, "-u", os.path.join(ROOT, argv[0])] + argv[1:])
        if r.returncode != 0:
            print("stage %s failed (exit %d)" % (name, r.returncode), file=sys.stderr)
            return r.returncode
        print("== %s done in %.0fs" % (name, time.time() - t0), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
