"""Cut the promo together: normalise every shot, lay the narration under it, mux.

Reads promo/out/timeline.json (written by render_vo.py) and expects the card and
b-roll clips to already exist. B-roll comes off ComfyUI at 960x544/24fps, so it
is graded to the brand's warm palette, given a slow push, captioned, and
conformed to 1920x1080/30fps before the concat.

    python promo/assemble.py
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
INTER = os.path.join(ROOT, "assets", "inter-latin.ttf")


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError("ffmpeg failed:\n" + " ".join(cmd) + "\n" + p.stderr[-3000:])
    return p


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def caption_png(text, dest, W, H, brand):
    """A soft ivory caption plate, the way the reference subtitles its b-roll."""
    S = 2
    im = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(INTER, 34 * S)
    try:
        f.set_variation_by_axes([520])
    except Exception:
        pass
    tw = d.textlength(text, font=f)
    padx, pady = 38 * S, 22 * S
    bw, bh = tw + padx * 2, 44 * S + pady
    x0, y0 = (W * S - bw) / 2, (H - 148) * S
    # a warm drop shadow so the plate lifts off any footage
    sh = Image.new("L", im.size, 0)
    ImageDraw.Draw(sh).rounded_rectangle((x0, y0 + 6 * S, x0 + bw, y0 + bh + 8 * S),
                                         14 * S, fill=70)
    sh = sh.filter(ImageFilter.GaussianBlur(14 * S))
    im.paste(Image.new("RGBA", im.size, (60, 46, 34, 255)), (0, 0), sh)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((x0, y0, x0 + bw, y0 + bh), 14 * S,
                        fill=rgb(brand["surface"]) + (242,))
    d.text((W * S / 2, y0 + bh / 2), text, font=f, fill=rgb(brand["ink"]) + (255,),
           anchor="mm")
    im.resize((W, H), Image.LANCZOS).save(dest)


def normalise(shot, board, clips_dir, cap_dir):
    """Conform one shot to 1920x1080 / 30fps / exact duration."""
    W, H, fps = board["width"], board["height"], board["fps"]
    dur = shot["dur"]
    dest = os.path.join(clips_dir, shot["id"] + ".mp4")

    if shot["kind"] == "card":
        src = os.path.join(ROOT, "out", "cards", shot["id"] + ".mp4")
        vf = "fps=%d,scale=%d:%d" % (fps, W, H)
        inputs = ["-i", src]
    else:
        src = os.path.join(ROOT, "out", "broll", shot["id"] + ".mp4")
        # fill the frame, grade warm, push in slowly, then fade the ends
        vf = (
            "scale=%d:%d:force_original_aspect_ratio=increase,"
            "crop=%d:%d,fps=%d,"
            "zoompan=z='min(zoom+0.00045,1.10)':d=1:"
            "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=%dx%d:fps=%d,"
            "eq=contrast=1.05:saturation=0.90:gamma=1.01,"
            "colorbalance=rm=0.025:gm=0.004:bm=-0.030"
            % (W, H, W, H, fps, W, H, fps)
        )
        inputs = ["-i", src]
        cap = shot.get("vo")
        if cap:
            png = os.path.join(cap_dir, shot["id"] + ".png")
            caption_png(cap, png, W, H, board["brand"])
            inputs += ["-loop", "1", "-i", png]
            vf = ("[0:v]" + vf + "[bg];"
                  "[1:v]format=rgba,fade=in:st=0.30:d=0.35:alpha=1,"
                  "fade=out:st=%.2f:d=0.35:alpha=1[cap];"
                  "[bg][cap]overlay=0:0" % max(0.4, dur - 0.75))
        vf += ",fade=in:st=0:d=0.18,fade=out:st=%.2f:d=0.18" % max(0.0, dur - 0.18)

    # hold the last frame if a generated clip lands a hair short of its slot
    vf += ",tpad=stop_mode=clone:stop_duration=0.5"
    flt = ["-filter_complex", vf] if vf.startswith("[") else ["-vf", vf]
    run(["ffmpeg", "-y", "-v", "error"] + inputs + flt +
        ["-fps_mode", "cfr", "-t", "%.3f" % dur,
         "-c:v", "libx264", "-preset", "medium", "-crf", "17",
         "-pix_fmt", "yuv420p", "-an", dest])
    return dest


def build_audio(board, dest, music=None):
    """Place each narration line at its shot's start + lead-in, then mix."""
    lead = board.get("lead_in", 0.3)
    total = sum(s["dur"] for s in board["shots"])
    inputs, filters, labels = [], [], []
    t = 0.0
    n = 0
    for shot in board["shots"]:
        f = shot.get("vo_file")
        if f:
            inputs += ["-i", os.path.join(ROOT, f)]
            filters.append("[%d:a]aresample=48000,adelay=%d|%d[v%d]"
                           % (n, int((t + lead) * 1000), int((t + lead) * 1000), n))
            labels.append("[v%d]" % n)
            n += 1
        t += shot["dur"]

    if music and os.path.exists(music):
        inputs += ["-i", music]
        filters.append("[%d:a]aresample=48000,volume=0.30[bed]" % n)
        labels.append("[bed]")
        n += 1

    # loudnorm brings the mix to the -16 LUFS web-video target; without it the
    # narration lands ~5 dB under a typical ad and sounds timid.
    filters.append("%samix=inputs=%d:normalize=0:duration=longest,"
                   "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,"
                   "atrim=0:%.3f,asetpts=N/SR/TB[out]" % ("".join(labels), n, total))
    run(["ffmpeg", "-y", "-v", "error"] + inputs +
        ["-filter_complex", ";".join(filters), "-map", "[out]",
         "-c:a", "pcm_s16le", dest])
    return dest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeline", default=os.path.join(ROOT, "out", "timeline.json"))
    ap.add_argument("--out", default=os.path.join(ROOT, "out", "th-labs-promo.mp4"))
    ap.add_argument("--music", default=os.path.join(ROOT, "out", "bed.wav"))
    args = ap.parse_args()

    with open(args.timeline, encoding="utf-8") as fh:
        board = json.load(fh)

    clips_dir = os.path.join(ROOT, "out", "clips")
    cap_dir = os.path.join(ROOT, "out", "captions")
    for d in (clips_dir, cap_dir):
        os.makedirs(d, exist_ok=True)

    missing = []
    for s in board["shots"]:
        sub = "cards" if s["kind"] == "card" else "broll"
        if not os.path.exists(os.path.join(ROOT, "out", sub, s["id"] + ".mp4")):
            missing.append(s["id"] + " (" + sub + ")")
    if missing:
        print("missing source clips: " + ", ".join(missing), file=sys.stderr)
        return 1

    print("conforming %d shots..." % len(board["shots"]), flush=True)
    paths = []
    for s in board["shots"]:
        paths.append(normalise(s, board, clips_dir, cap_dir))
        print("  %s  %s  %.2fs" % (s["id"], s["kind"], s["dur"]), flush=True)

    listfile = os.path.join(clips_dir, "concat.txt")
    with open(listfile, "w", encoding="utf-8") as fh:
        for p in paths:
            fh.write("file '%s'\n" % p.replace("\\", "/"))
    silent = os.path.join(ROOT, "out", "_video.mp4")
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
         "-i", listfile, "-c", "copy", silent])

    print("building audio...", flush=True)
    wav = build_audio(board, os.path.join(ROOT, "out", "_audio.wav"),
                      music=args.music)

    print("muxing...", flush=True)
    run(["ffmpeg", "-y", "-v", "error", "-i", silent, "-i", wav,
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", args.out])

    dur = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", args.out],
        capture_output=True, text=True).stdout.strip()
    print("\n%s  %.1f MB  %ss" % (args.out, os.path.getsize(args.out) / 1e6, dur))
    print("ASSEMBLE COMPLETE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
