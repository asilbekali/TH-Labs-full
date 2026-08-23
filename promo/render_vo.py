"""Synthesise the narration and lock the final timeline.

The ad is narrated by edge-tts - the same neural TTS the dubbing pipeline uses -
so the promo is voiced by the product it is advertising.

Run this BEFORE the card and b-roll renders: it writes promo/out/timeline.json,
a copy of the storyboard whose shot durations have been stretched to fit the
narration. Everything downstream reads that file, so nothing gets clipped.

    python promo/render_vo.py
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))

LEAD_IN = 0.30   # silence before a line starts, so it does not sit on the cut
TAIL = 0.45      # breathing room after a line before the next shot


def probe_duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", path],
        capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


async def synth(text, voice, dest, rate="+0%"):
    import edge_tts
    await edge_tts.Communicate(text, voice, rate=rate).save(dest)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--storyboard", default=os.path.join(ROOT, "storyboard.json"))
    ap.add_argument("--out", default=os.path.join(ROOT, "out", "vo"))
    ap.add_argument("--timeline", default=os.path.join(ROOT, "out", "timeline.json"))
    ap.add_argument("--rate", default="+4%", help="edge-tts speaking rate")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    with open(args.storyboard, encoding="utf-8") as fh:
        board = json.load(fh)
    os.makedirs(args.out, exist_ok=True)
    voice = board["voice"]

    total_before = sum(s["dur"] for s in board["shots"])
    for shot in board["shots"]:
        line = shot.get("vo")
        if not line:
            shot["vo_file"] = None
            shot["vo_dur"] = 0.0
            continue
        dest = os.path.join(args.out, shot["id"] + ".mp3")
        if args.force or not os.path.exists(dest):
            asyncio.run(synth(line, voice, dest, args.rate))
        d = probe_duration(dest)
        shot["vo_file"] = os.path.relpath(dest, ROOT).replace("\\", "/")
        shot["vo_dur"] = round(d, 3)
        needed = LEAD_IN + d + TAIL
        if needed > shot["dur"]:
            print("  %s: stretching %.2fs -> %.2fs to fit narration"
                  % (shot["id"], shot["dur"], needed), flush=True)
            shot["dur"] = round(needed, 2)
        print("  %-4s %5.2fs vo / %5.2fs shot  %s"
              % (shot["id"], d, shot["dur"], line[:52]), flush=True)

    board["lead_in"] = LEAD_IN
    with open(args.timeline, "w", encoding="utf-8") as fh:
        json.dump(board, fh, indent=2, ensure_ascii=False)

    total = sum(s["dur"] for s in board["shots"])
    print("\nstoryboard %.1fs -> timeline %.1fs   (%s)"
          % (total_before, total, os.path.relpath(args.timeline, ROOT)), flush=True)
    print("VO COMPLETE", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
