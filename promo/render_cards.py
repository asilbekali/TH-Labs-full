"""Render the storyboard's motion-graphics cards to mp4.

Everything is drawn with Pillow at 2x and downsampled, then piped straight into
ffmpeg as raw RGB - no intermediate PNGs. The visual language is the app's own:
cream canvas, warm near-black ink, a single clay accent, flat surfaces.

    python promo/render_cards.py                 # every card
    python promo/render_cards.py --only S08      # just one
"""
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
SS = 2  # supersample factor

INTER = os.path.join(ROOT, "assets", "inter-latin.ttf")
MONO = os.path.join(ROOT, "assets", "jetbrains-mono-latin.ttf")

_font_cache: dict = {}


def font(size, weight=400, mono=False):
    key = (size, weight, mono)
    if key not in _font_cache:
        f = ImageFont.truetype(MONO if mono else INTER, int(size * SS))
        try:
            f.set_variation_by_axes([weight])
        except Exception:
            pass
        _font_cache[key] = f
    return _font_cache[key]


def _cmap():
    """Codepoints the bundled Inter subset can actually draw."""
    if not hasattr(_cmap, "set"):
        from fontTools.ttLib import TTFont
        cs = set()
        for t in TTFont(INTER)["cmap"].tables:
            cs |= set(t.cmap.keys())
        _cmap.set = cs
    return _cmap.set


_checked: set = set()


def assert_renderable(s):
    """The bundled font is a Latin subset - anything outside it draws as tofu.
    Fail loudly at render time instead of shipping boxes (this caught both
    Cyrillic language names and the U+2192 arrow)."""
    if not s or s in _checked:
        return
    missing = sorted({c for c in s if ord(c) not in _cmap() and c not in "\n\t"})
    if missing:
        raise ValueError("font cannot draw %s in %r - use a Latin-script "
                         "alternative or draw it as a shape"
                         % ([hex(ord(c)) for c in missing], s))
    _checked.add(s)


# ── easing ──────────────────────────────────────────────────────────────────

def clamp(x, lo=0.0, hi=1.0):
    return lo if x < lo else hi if x > hi else x


def seg(t, start, end):
    """Normalise t into 0..1 across the [start, end] window."""
    if end <= start:
        return 1.0 if t >= end else 0.0
    return clamp((t - start) / (end - start))


def out_expo(x):
    return 1.0 if x >= 1 else 1 - pow(2, -10 * x)


def out_cubic(x):
    return 1 - pow(1 - x, 3)


def in_out_cubic(x):
    return 4 * x * x * x if x < 0.5 else 1 - pow(-2 * x + 2, 3) / 2


def out_back(x, s=1.70158):
    return 1 + (s + 1) * pow(x - 1, 3) + s * pow(x - 1, 2)


def mix(a, b, t):
    return a + (b - a) * t


def rgb(hexstr):
    h = hexstr.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def blend(c1, c2, t):
    return tuple(int(round(mix(a, b, t))) for a, b in zip(c1, c2))


# ── canvas ──────────────────────────────────────────────────────────────────

class Card:
    """A 2x drawing surface with the brand's background already laid in."""

    def __init__(self, w, h, brand, dark=False):
        self.W, self.H = w * SS, h * SS
        self.b = brand
        self.dark = dark
        base = rgb(brand["charcoal"] if dark else brand["canvas"])
        self.im = Image.new("RGB", (self.W, self.H), base)
        self._glow()
        self.d = ImageDraw.Draw(self.im)

    def _glow(self):
        """A soft warm bloom low on the frame - the reference's blurred blob,
        rebuilt in clay instead of lilac."""
        w, h = self.W // 8, self.H // 8
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        cx, cy = w * 0.5, h * 1.06
        r = np.sqrt(((xx - cx) / (w * 0.62)) ** 2 + ((yy - cy) / (h * 0.72)) ** 2)
        field = np.clip(1.0 - r, 0.0, 1.0) ** 1.7
        base = np.asarray(self.im.resize((w, h), Image.BILINEAR)).astype(np.float32)
        tint = np.array(rgb(self.b["orange"]), dtype=np.float32)
        amt = (0.30 if self.dark else 0.20) * field[..., None]
        out = base * (1 - amt) + tint * amt
        glow = Image.fromarray(out.astype(np.uint8)).resize((self.W, self.H), Image.BICUBIC)
        self.im = glow.filter(ImageFilter.GaussianBlur(4 * SS))

    # -- text ---------------------------------------------------------------

    def text_size(self, s, f, tracking=0):
        if not s:
            return 0, 0
        w = self.d.textlength(s, font=f)
        if tracking:
            w += tracking * SS * (len(s) - 1)
        a = f.getbbox("Hg")
        return w, a[3] - a[1]

    def text(self, xy, s, f, fill, anchor="la", tracking=0, alpha=1.0):
        """Draw text, optionally letter-spaced, optionally faded."""
        if alpha <= 0.003 or not s:
            return
        x, y = xy[0] * SS, xy[1] * SS
        if tracking:
            total = self.text_size(s, f, tracking)[0]
            if anchor[0] == "m":
                x -= total / 2
            elif anchor[0] == "r":
                x -= total
            anchor = "l" + anchor[1]
        if alpha >= 0.997:
            self._draw_tracked(self.d, (x, y), s, f, fill, anchor, tracking)
            return
        layer = Image.new("RGB", (self.W, self.H))
        mask = Image.new("L", (self.W, self.H), 0)
        ld, md = ImageDraw.Draw(layer), ImageDraw.Draw(mask)
        self._draw_tracked(ld, (x, y), s, f, fill, anchor, tracking)
        self._draw_tracked(md, (x, y), s, f, int(round(alpha * 255)), anchor, tracking)
        self.im.paste(layer, (0, 0), mask)
        self.d = ImageDraw.Draw(self.im)

    def _draw_tracked(self, d, xy, s, f, fill, anchor, tracking):
        assert_renderable(s)
        if not tracking:
            d.text(xy, s, font=f, fill=fill, anchor=anchor)
            return
        x, y = xy
        for ch in s:
            d.text((x, y), ch, font=f, fill=fill, anchor=anchor)
            x += d.textlength(ch, font=f) + tracking * SS

    def text_clip(self, xy, s, f, fill, reveal, anchor="la", tracking=0, rise=0.0):
        """Reveal a line by wiping a mask upward - the reference's line-in."""
        if reveal <= 0.001:
            return
        w, h = self.text_size(s, f, tracking)
        if anchor[0] == "m":
            x0 = xy[0] * SS - w / 2
        elif anchor[0] == "r":
            x0 = xy[0] * SS - w
        else:
            x0 = xy[0] * SS
        y0 = xy[1] * SS - h * 1.35
        pad = h * 0.7
        box = (int(x0 - pad), int(y0 - pad), int(x0 + w + pad), int(xy[1] * SS + pad))
        layer = Image.new("RGB", (self.W, self.H))
        mask = Image.new("L", (self.W, self.H), 0)
        dy = rise * (1 - out_expo(reveal)) * SS
        self._draw_tracked(ImageDraw.Draw(layer), (x0, xy[1] * SS + dy), s, f, fill,
                           "l" + anchor[1], tracking)
        self._draw_tracked(ImageDraw.Draw(mask), (x0, xy[1] * SS + dy), s, f, 255,
                           "l" + anchor[1], tracking)
        cut = Image.new("L", (self.W, self.H), 0)
        top = box[3] - (box[3] - box[1]) * out_expo(reveal)
        ImageDraw.Draw(cut).rectangle((box[0], top, box[2], box[3]), fill=255)
        mask = Image.composite(mask, Image.new("L", mask.size, 0), cut)
        self.im.paste(layer, (0, 0), mask)
        self.d = ImageDraw.Draw(self.im)

    # -- shapes -------------------------------------------------------------

    def rrect(self, box, r, fill=None, outline=None, width=1, alpha=1.0):
        x0, y0, x1, y1 = [v * SS for v in box]
        if alpha >= 0.997:
            self.d.rounded_rectangle((x0, y0, x1, y1), r * SS, fill=fill,
                                     outline=outline, width=int(width * SS))
            return
        # Composite only the rect's own bounding box. Doing this full-frame
        # costs ~8M pixels per call, and a waveform issues dozens per frame.
        pad = int(width * SS) + 2
        bx0, by0 = max(0, int(min(x0, x1)) - pad), max(0, int(min(y0, y1)) - pad)
        bx1, by1 = min(self.W, int(max(x0, x1)) + pad + 1), min(self.H, int(max(y0, y1)) + pad + 1)
        if bx1 <= bx0 or by1 <= by0:
            return
        layer = Image.new("RGB", (bx1 - bx0, by1 - by0))
        mask = Image.new("L", (bx1 - bx0, by1 - by0), 0)
        a = int(alpha * 255)
        lx0, ly0, lx1, ly1 = x0 - bx0, y0 - by0, x1 - bx0, y1 - by0
        ImageDraw.Draw(layer).rounded_rectangle((lx0, ly0, lx1, ly1), r * SS, fill=fill,
                                                outline=outline, width=int(width * SS))
        # The mask has to mirror which parts were actually drawn, or an
        # outline-only rect pastes its (black) interior over the frame.
        ImageDraw.Draw(mask).rounded_rectangle((lx0, ly0, lx1, ly1), r * SS,
                                               fill=a if fill is not None else None,
                                               outline=a if outline is not None else None,
                                               width=int(width * SS))
        self.im.paste(layer, (bx0, by0), mask)
        self.d = ImageDraw.Draw(self.im)

    def arrow(self, x0, x1, y, fill, width=2):
        """A drawn arrow - the font subset has no U+2192."""
        self.line((x0, y), (x1, y), fill, width)
        h = 4.5 + width
        self.line((x1 - h, y - h), (x1, y), fill, width)
        self.line((x1 - h, y + h), (x1, y), fill, width)

    def line(self, p0, p1, fill, width=2):
        self.d.line((p0[0] * SS, p0[1] * SS, p1[0] * SS, p1[1] * SS),
                    fill=fill, width=int(width * SS))

    def shadow(self, box, r, spread=14, alpha=0.13):
        """Warm, tinted card shadow - matches --shadow-md in the app."""
        x0, y0, x1, y1 = [v * SS for v in box]
        pad = int(spread * SS * 2)
        sh = Image.new("L", (self.W, self.H), 0)
        ImageDraw.Draw(sh).rounded_rectangle(
            (x0, y0 + 5 * SS, x1, y1 + 7 * SS), r * SS, fill=int(alpha * 255))
        sh = sh.filter(ImageFilter.GaussianBlur(spread * SS * 0.5))
        tint = Image.new("RGB", (self.W, self.H), (75, 60, 45))
        self.im.paste(tint, (0, 0), sh)
        self.d = ImageDraw.Draw(self.im)
        _ = pad

    def out(self, w, h):
        return self.im.resize((w, h), Image.LANCZOS)


# ── the logo mark, rebuilt from brand/logo-mark.svg ─────────────────────────

MARK_HOLES = [(47.63, 25.31, 58.95, 38.22), (18.24, 41.55, 48.63, 56.95),
              (33.22, 56.95, 58.95, 71.11), (33.22, 71.11, 48.63, 90.75)]
MARK_PIXELS = [(59.03, 25.56, 11.24, 10.66), (70.52, 18.07, 7.99, 7.49),
               (70.44, 37.14, 9.66, 7.91), (58.95, 55.95, 15.24, 15.15),
               (80.26, 46.05, 8.08, 7.58), (86.76, 25.23, 5.33, 5.41),
               (91.5, 9.25, 4.5, 4.41), (82.6, 70.52, 4.41, 4.33),
               (64.28, 82.18, 7.74, 7.08)]


def mark_mask(size, pixel_reveal=1.0):
    """Alpha mask of the TH-Labs mark. pixel_reveal staggers the scattered
    squares so the mark can 'dissolve into pixels' on the way in."""
    S = size * 4
    m = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(m)
    k = S / 100.0
    d.rounded_rectangle((4 * k, 13.24 * k, 58.95 * k, 90.75 * k), 11.66 * k, fill=255)
    for x0, y0, x1, y1 in MARK_HOLES:
        d.rectangle((x0 * k, y0 * k, x1 * k, y1 * k), fill=0)
    n = len(MARK_PIXELS)
    for i, (x, y, w, h) in enumerate(MARK_PIXELS):
        t = clamp((pixel_reveal * (n + 3) - i) / 3.0)
        if t <= 0:
            continue
        s = out_back(t)
        cx, cy = (x + w / 2) * k, (y + h / 2) * k
        hw, hh = w * k * s / 2, h * k * s / 2
        d.rounded_rectangle((cx - hw, cy - hh, cx + hw, cy + hh), 0.83 * k, fill=255)
    return m.resize((size, size), Image.LANCZOS)


# ── waveform helper (deterministic, like the app's VoiceShowcase) ───────────

def bars(n, seed=11):
    rs = np.random.RandomState(seed)
    x = np.linspace(0, 1, n)
    env = 0.42 + 0.58 * np.abs(np.sin(x * math.pi * 2.6) * np.cos(x * math.pi * 1.4))
    return np.clip(env * (0.55 + 0.45 * rs.rand(n)), 0.08, 1.0)


BARS_A = bars(74, 11)


def draw_wave(c, box, values, colour, amp=1.0, gap=0.34, alpha=1.0, floor=0.0):
    x0, y0, x1, y1 = box
    n = len(values)
    step = (x1 - x0) / n
    bw = step * (1 - gap)
    mid = (y0 + y1) / 2
    half = (y1 - y0) / 2
    for i, v in enumerate(values):
        hgt = max(floor, v * amp) * half
        if hgt <= 0.2:
            continue
        cx = x0 + i * step + step / 2
        col = colour(i / n) if callable(colour) else colour
        c.rrect((cx - bw / 2, mid - hgt, cx + bw / 2, mid + hgt),
                min(bw / 2, 3), fill=col, alpha=alpha)


# ── cards ───────────────────────────────────────────────────────────────────

def card_line_reveal(c, t, shot, W, H):
    b = c.b
    u = t / shot["dur"]
    ink, clay = rgb(b["ink"]), rgb(b["clay"])
    lines = shot["text"].split("\n")
    f = font(96 if len(lines) > 2 else 104, 620)
    lh = 132 if len(lines) > 2 else 142
    total = lh * len(lines)
    y = H / 2 - total / 2 + lh * 0.78
    for i, ln in enumerate(lines):
        r = seg(u, 0.05 + i * 0.10, 0.30 + i * 0.10)
        last = i == len(lines) - 1 and len(lines) > 1
        c.text_clip((W / 2, y + i * lh), ln, f, clay if last else ink, r,
                    anchor="ms", tracking=-1.6, rise=26)
    # a hairline that draws under the block, the way the app rules its eyebrows
    r = seg(u, 0.10 * len(lines) + 0.14, 0.10 * len(lines) + 0.40)
    if r > 0:
        half = 150 * out_expo(r)
        c.line((W / 2 - half, y + total - lh * 0.42), (W / 2 + half, y + total - lh * 0.42),
               clay, 3)


def card_strike_swap(c, t, shot, W, H):
    b = c.b
    u = t / shot["dur"]
    ink, mute, clay = rgb(b["ink"]), rgb(b["ink_mute"]), rgb(b["clay"])
    f = font(78, 600)
    y1, y2 = H / 2 - 62, H / 2 + 78
    # line one arrives, then greys out as the strike sweeps through it
    r1 = seg(u, 0.03, 0.20)
    strike = seg(u, 0.30, 0.44)
    fade = seg(u, 0.32, 0.47)
    c.text_clip((W / 2, y1), shot["text"], f, blend(ink, mute, fade), r1,
                anchor="ms", tracking=-1.2, rise=22)
    if strike > 0:
        w = c.text_size(shot["text"], f, -1.2)[0] / SS
        half = w / 2
        c.line((W / 2 - half, y1 - 24), (W / 2 - half + w * out_cubic(strike), y1 - 24),
               clay, 4)
    # line two takes its place
    r2 = seg(u, 0.42, 0.62)
    c.text_clip((W / 2, y2), shot["text2"], f, ink, r2, anchor="ms",
                tracking=-1.2, rise=26)


def card_pipeline(c, t, shot, W, H):
    b = c.b
    ink, mute, clay = rgb(b["ink"]), rgb(b["ink_mute"]), rgb(b["clay"])
    cactus, surf = rgb(b["cactus"]), rgb(b["surface"])
    stages = [("Listen", "transcribe the speech"), ("Translate", "keep the meaning"),
              ("Speak", "in the original voice")]
    cw, ch = 380, 176
    gap = 84
    total = cw * 3 + gap * 2
    x0 = W / 2 - total / 2
    y = H / 2 - 110  # the group runs cards -> wave -> label, so bias it high
    u = t / shot["dur"]
    for i, (title, sub) in enumerate(stages):
        r = out_expo(seg(u, 0.04 + i * 0.09, 0.22 + i * 0.09))
        if r <= 0.002:
            continue
        left = x0 + i * (cw + gap)
        dy = (1 - r) * 26
        box = (left, y - ch / 2 + dy, left + cw, y + ch / 2 + dy)
        c.shadow(box, 14, spread=16, alpha=0.11 * r)
        c.rrect(box, 14, fill=surf, alpha=r)
        c.rrect(box, 14, outline=rgb(b["ink"]) if False else (226, 222, 210),
                width=1, alpha=r * 0.9)
        c.text((left + 34, y - 52 + dy), "0%d" % (i + 1), font(20, 600, mono=True),
               clay, alpha=r)
        c.text((left + 34, y - 12 + dy), title, font(44, 640), ink, alpha=r,
               tracking=-0.8)
        c.text((left + 34, y + 40 + dy), sub, font(22, 420), mute, alpha=r)
        if i < 2:  # the rule that draws to the next stage
            rr = out_cubic(seg(u, 0.17 + i * 0.09, 0.27 + i * 0.09))
            if rr > 0:
                c.line((left + cw + 12, y + dy),
                       (left + cw + 12 + (gap - 24) * rr, y + dy), clay, 3)
    # the source wave below, recoloured left-to-right as the dub takes over
    sweep = seg(u, 0.17, 0.65)
    wb = (W / 2 - 470, H / 2 + 208, W / 2 + 470, H / 2 + 296)
    rev = out_expo(seg(u, 0.08, 0.31))
    draw_wave(c, wb, BARS_A, lambda u: blend(mute, clay, clamp((sweep - u) * 6)),
              amp=0.92 * rev)
    lab = seg(u, 0.40, 0.53)
    if lab > 0:
        c.text((W / 2, H / 2 + 340), "one voice, carried across", font(26, 480),
               mute, anchor="ms", alpha=lab, tracking=1.2)
    _ = cactus


LANGS = [("UZ", "O'zbek"), ("ES", "Español"), ("FR", "Français"), ("DE", "Deutsch")]


def card_studio(c, t, shot, W, H):
    """A mock of the app's Studio: two tracks sharing one voice-print, a
    sweeping playhead, a flipping target language and the real match figure."""
    b = c.b
    ink, mute, soft = rgb(b["ink"]), rgb(b["ink_mute"]), rgb(b["ink_soft"])
    clay, surf, sunken = rgb(b["clay"]), rgb(b["surface"]), (235, 232, 222)
    cactus = rgb(b["cactus"])

    u = t / shot["dur"]
    r = out_expo(seg(u, 0.0, 0.14))
    cw, ch = 1180, 620
    x0, y0 = W / 2 - cw / 2, H / 2 - ch / 2 + (1 - r) * 24
    box = (x0, y0, x0 + cw, y0 + ch)
    c.shadow(box, 18, spread=26, alpha=0.16 * r)
    c.rrect(box, 18, fill=surf, alpha=r)
    c.rrect(box, 18, outline=(226, 222, 210), width=1, alpha=r)
    if r < 0.2:
        return

    # window chrome
    c.line((x0, y0 + 64), (x0 + cw, y0 + 64), (235, 232, 222), 1)
    for i, col in enumerate([(215, 208, 195), (215, 208, 195), (215, 208, 195)]):
        c.d.ellipse((int((x0 + 30 + i * 22) * SS), int((y0 + 26) * SS),
                     int((x0 + 42 + i * 22) * SS), int((y0 + 38) * SS)), fill=col)
    c.text((x0 + 120, y0 + 22), "TH-Labs  —  Studio", font(22, 500), mute)

    # language flip, cycling like the app's VoiceShowcase
    idx = int(seg(u, 0.15, 0.93) * 3.999) % len(LANGS)
    code, name = LANGS[idx]
    flip = seg(u, 0.15, 0.93) * 4 % 1.0
    pop = 1.0 if flip > 0.12 else out_back(flip / 0.12)
    c.rrect((x0 + cw - 300, y0 + 16, x0 + cw - 30, y0 + 50), 17, fill=sunken)
    c.text((x0 + cw - 246, y0 + 33), "EN", font(21, 620), clay, anchor="mm",
           tracking=1.4)
    c.arrow(x0 + cw - 214, x0 + cw - 158, y0 + 33, clay, 2)
    c.text((x0 + cw - 110, y0 + 33), code, font(21, 620), clay, anchor="mm",
           tracking=1.4, alpha=pop)

    pad = 54
    tx0, tx1 = x0 + pad, x0 + cw - pad
    play = clamp(seg(u, 0.17, 0.89))

    # track one - the source, muted
    c.text((tx0, y0 + 104), "ORIGINAL  ·  ENGLISH", font(18, 620), mute, tracking=2.0)
    wb1 = (tx0, y0 + 140, tx1, y0 + 250)
    draw_wave(c, wb1, BARS_A, (205, 199, 184), amp=0.86)

    # track two - the dub, in clay, filling in behind the playhead
    c.text((tx0, y0 + 292), "DUBBED  ·  %s" % name.upper(), font(18, 620), clay,
           tracking=2.0)
    wb2 = (tx0, y0 + 328, tx1, y0 + 438)
    draw_wave(c, wb2, BARS_A,
              lambda u: clay if u <= play else (222, 216, 204), amp=0.86)

    # playhead
    px = tx0 + (tx1 - tx0) * play
    c.line((px, y0 + 132), (px, y0 + 446), clay, 2)

    # the metric the app actually measures
    mr = seg(u, 0.36, 0.66)
    c.text((tx0, y0 + 496), "VOICE MATCH", font(18, 620), mute, tracking=2.0)
    bar = (tx0, y0 + 528, tx0 + 520, y0 + 542)
    c.rrect(bar, 7, fill=sunken)
    val = 0.874 * out_cubic(mr)
    if val > 0.01:
        c.rrect((bar[0], bar[1], bar[0] + 520 * val, bar[3]), 7, fill=cactus)
    c.text((tx0 + 548, y0 + 518), "%.1f%%" % (val * 100), font(34, 640), ink,
           tracking=-0.5)
    c.text((tx1, y0 + 500), "background music preserved", font(21, 440), soft,
           anchor="ra", alpha=seg(u, 0.53, 0.70))
    c.text((tx1, y0 + 528), "lips re-timed to the new audio", font(21, 440), soft,
           anchor="ra", alpha=seg(u, 0.60, 0.76))


def card_logo(c, t, shot, W, H):
    """The only dark card, so it carries the dark theme's own ink values."""
    b = c.b
    ink, mute = (245, 244, 239), (133, 128, 119)
    clay = rgb(b["orange"])  # the orange reads best on charcoal
    size, gap = 168, 46
    wf = font(120, 680)
    ww = c.text_size(shot["text"], wf, -3.0)[0] / SS
    lock_w = size + gap + ww
    lx = W / 2 - lock_w / 2
    cy = H / 2 - 26

    u = t / shot["dur"]
    r = seg(u, 0.025, 0.375)
    a = out_expo(seg(u, 0.0, 0.175))
    if a > 0.01:
        m = mark_mask(size * SS, pixel_reveal=out_cubic(r))
        m = m.point(lambda v, a=a: int(v * a))
        c.im.paste(Image.new("RGB", (size * SS, size * SS), clay),
                   (int(lx * SS), int((cy - size / 2) * SS)), m)
        c.d = ImageDraw.Draw(c.im)
    c.text_clip((lx + size + gap, cy + 44), shot["text"], wf, ink,
                seg(u, 0.09, 0.325), anchor="ls", tracking=-3.0, rise=26)
    c.text((W / 2, cy + 132), "One video. Every language. Still you.",
           font(30, 440), mute, anchor="ma", alpha=seg(u, 0.275, 0.475))
    # the CTA pill
    pr = seg(u, 0.425, 0.60)
    if pr > 0.01:
        s = out_back(pr)
        bw, bh = 300 * s, 76 * s
        bx, by = W / 2, cy + 246
        c.rrect((bx - bw / 2, by - bh / 2, bx + bw / 2, by + bh / 2), 12,
                fill=clay, alpha=clamp(pr * 1.6))
        c.text((bx, by), shot["text2"], font(30, 620), (26, 25, 24),
               anchor="mm", alpha=clamp((pr - 0.35) * 3))


CARDS = {"line_reveal": card_line_reveal, "strike_swap": card_strike_swap,
         "pipeline": card_pipeline, "studio": card_studio, "logo": card_logo}


# ── driver ──────────────────────────────────────────────────────────────────

def render_shot(shot, board, out_dir):
    W, H, fps = board["width"], board["height"], board["fps"]
    brand = board["brand"]
    n = int(round(shot["dur"] * fps))
    dest = os.path.join(out_dir, shot["id"] + ".mp4")
    fn = CARDS[shot["card"]]
    dark = shot["card"] == "logo"

    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", "%dx%d" % (W, H), "-r", str(fps), "-i", "-",
         "-c:v", "libx264", "-preset", "medium", "-crf", "16",
         "-pix_fmt", "yuv420p", dest], stdin=subprocess.PIPE)
    for i in range(n):
        t = i / fps
        c = Card(W, H, brand, dark=dark)
        fn(c, t, shot, W, H)
        # a short fade at the head and tail so cuts breathe
        img = c.out(W, H)
        f_in, f_out = seg(t, 0.0, 0.18), 1 - seg(t, shot["dur"] - 0.18, shot["dur"])
        k = min(f_in, f_out)
        if k < 0.999:
            base = Image.new("RGB", (W, H),
                             rgb(brand["charcoal"] if dark else brand["canvas"]))
            img = Image.blend(base, img, k)
        proc.stdin.write(img.tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError("ffmpeg failed for " + shot["id"])
    return dest, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--storyboard", default=os.path.join(ROOT, "storyboard.json"))
    ap.add_argument("--out", default=os.path.join(ROOT, "out", "cards"))
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--force", action="store_true", help="re-render existing cards")
    ap.add_argument("--still", type=float, default=None,
                    help="render a single frame at this time, as PNG")
    args = ap.parse_args()

    with open(args.storyboard, encoding="utf-8") as fh:
        board = json.load(fh)
    shots = [s for s in board["shots"] if s["kind"] == "card"]
    if args.only:
        shots = [s for s in shots if s["id"] in args.only]
    os.makedirs(args.out, exist_ok=True)

    import time
    for s in shots:
        t0 = time.time()
        if args.still is not None:
            c = Card(board["width"], board["height"], board["brand"],
                     dark=s["card"] == "logo")
            CARDS[s["card"]](c, args.still, s, board["width"], board["height"])
            p = os.path.join(args.out, "%s_t%.1f.png" % (s["id"], args.still))
            c.out(board["width"], board["height"]).save(p)
            print("still ->", p, flush=True)
            continue
        if os.path.exists(os.path.join(args.out, s["id"] + ".mp4")) and not args.force:
            print("%s already rendered - skipping" % s["id"], flush=True)
            continue
        dest, n = render_shot(s, board, args.out)
        print("%s  %s  %d frames in %.0fs" % (s["id"], s["card"], n, time.time() - t0),
              flush=True)
    print("CARDS COMPLETE", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
