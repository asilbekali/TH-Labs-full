"""Render the storyboard's b-roll shots on a local ComfyUI (WAN 2.2 TI2V-5B).

Talks to the ComfyUI HTTP API directly: POST /prompt -> poll /history -> GET /view.
Nothing here needs the ComfyUI web UI to be open.

    python promo/comfy_broll.py                 # render every b-roll shot
    python promo/comfy_broll.py --only S01 S05  # render just these
    python promo/comfy_broll.py --width 704 --height 400 --steps 12   # fast probe
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.abspath(__file__))
SERVER = os.environ.get("COMFY_SERVER", "127.0.0.1:8188")
CLIENT_ID = str(uuid.uuid4())

UNET = "wan2.2_ti2v_5B_fp16.safetensors"
CLIP = "umt5_xxl_fp8_e4m3fn_scaled.safetensors"
VAE = "wan2.2_vae.safetensors"

# WAN ships a Chinese negative prompt and the model was tuned with it, so it is
# kept verbatim; the English tail covers the artefacts that matter for an ad.
NEGATIVE = (
    "色调艳丽，过曝，静态，"
    "细节模糊不清，字幕，风格，"
    "作品，画作，画面，静止，"
    "整体发灰，最差质量，低质量，"
    "JPEG压缩残留，丑陋的，残缺的，"
    "多余的手指，画得不好的手部，"
    "画得不好的脸部，畸形的，毁容的，"
    "形态畸形的肢体，手指融合，"
    "静止不动的画面，杂乱的背景，"
    "三条腿，背景人很多，倒着走, "
    "text, watermark, logo, caption, subtitles, ugly, deformed, distorted"
)

FPS = 24.0


def frames_for(seconds):
    """WAN's VAE compresses time 4x, so the frame count has to be 4n+1."""
    n = max(1, round(seconds * FPS / 4))
    return n * 4 + 1


def build_workflow(shot, width, height, steps, cfg, shift, seed):
    """API-format graph for one WAN 2.2 TI2V-5B text-to-video shot."""
    length = frames_for(shot["dur"])
    prefix = "thlabs/" + shot["id"]
    return {
        "1": {"class_type": "UNETLoader",
              "inputs": {"unet_name": UNET, "weight_dtype": "fp8_e4m3fn"}},
        "2": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": CLIP, "type": "wan", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "4": {"class_type": "ModelSamplingSD3",
              "inputs": {"model": ["1", 0], "shift": shift}},
        "5": {"class_type": "CLIPTextEncode",
              "inputs": {"clip": ["2", 0], "text": shot["prompt"]}},
        "6": {"class_type": "CLIPTextEncode",
              "inputs": {"clip": ["2", 0], "text": NEGATIVE}},
        "7": {"class_type": "Wan22ImageToVideoLatent",
              "inputs": {"vae": ["3", 0], "width": width, "height": height,
                         "length": length, "batch_size": 1}},
        "8": {"class_type": "KSampler",
              "inputs": {"model": ["4", 0], "positive": ["5", 0],
                         "negative": ["6", 0], "latent_image": ["7", 0],
                         "seed": seed, "steps": steps, "cfg": cfg,
                         "sampler_name": "uni_pc", "scheduler": "simple",
                         "denoise": 1.0}},
        "9": {"class_type": "VAEDecode",
              "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        "10": {"class_type": "CreateVideo",
               "inputs": {"images": ["9", 0], "fps": FPS}},
        "11": {"class_type": "SaveVideo",
               "inputs": {"video": ["10", 0], "format": "mp4", "codec": "h264",
                          "filename_prefix": prefix}},
    }


def _post(path, payload):
    req = urllib.request.Request(
        "http://" + SERVER + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def _get(path):
    with urllib.request.urlopen("http://" + SERVER + path, timeout=180) as r:
        return r.read()


def queue(workflow):
    return _post("/prompt", {"prompt": workflow, "client_id": CLIENT_ID})["prompt_id"]


def wait(prompt_id, label, poll=5.0):
    """Block until the prompt leaves the queue, reporting progress as it goes."""
    t0 = time.time()
    while True:
        hist = json.loads(_get("/history/" + prompt_id) or b"{}")
        if prompt_id in hist:
            entry = hist[prompt_id]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                errs = [m for m in status.get("messages", []) if m[0] == "execution_error"]
                raise RuntimeError(label + " failed: " + json.dumps(errs or status)[:2000])
            return entry
        q = json.loads(_get("/queue") or b"{}")
        running = len(q.get("queue_running", []))
        pending = len(q.get("queue_pending", []))
        print("    %s  %6.0fs  running=%d pending=%d"
              % (label, time.time() - t0, running, pending), flush=True)
        if not running and not pending:
            # Left the queue without landing in history - give it a beat, then fail.
            time.sleep(poll)
            hist = json.loads(_get("/history/" + prompt_id) or b"{}")
            if prompt_id not in hist:
                raise RuntimeError(label + " vanished from the queue with no history")
        time.sleep(poll)


def save_outputs(entry, dest_dir, shot_id):
    saved = []
    for node_out in entry.get("outputs", {}).values():
        for key in ("videos", "images", "gifs"):
            for f in node_out.get(key) or []:
                qs = urllib.parse.urlencode({
                    "filename": f["filename"],
                    "subfolder": f.get("subfolder", ""),
                    "type": f.get("type", "output")})
                data = _get("/view?" + qs)
                ext = os.path.splitext(f["filename"])[1] or ".mp4"
                path = os.path.join(dest_dir, shot_id + ext)
                with open(path, "wb") as fh:
                    fh.write(data)
                saved.append(os.path.basename(path))
    return saved


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--storyboard", default=os.path.join(ROOT, "storyboard.json"))
    ap.add_argument("--out", default=os.path.join(ROOT, "out", "broll"))
    ap.add_argument("--only", nargs="*", default=None, help="shot ids to render")
    ap.add_argument("--width", type=int, default=960)
    ap.add_argument("--height", type=int, default=544)
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--cfg", type=float, default=5.0)
    ap.add_argument("--shift", type=float, default=8.0)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--force", action="store_true", help="re-render existing shots")
    args = ap.parse_args()

    with open(args.storyboard, encoding="utf-8") as fh:
        board = json.load(fh)
    shots = [s for s in board["shots"] if s["kind"] == "broll"]
    if args.only:
        shots = [s for s in shots if s["id"] in args.only]
    os.makedirs(args.out, exist_ok=True)

    print("ComfyUI %s | %d shot(s) | %dx%d @ %d steps"
          % (SERVER, len(shots), args.width, args.height, args.steps), flush=True)

    for i, shot in enumerate(shots, 1):
        dest = os.path.join(args.out, shot["id"] + ".mp4")
        if os.path.exists(dest) and not args.force:
            print("[%d/%d] %s already rendered - skipping" % (i, len(shots), shot["id"]),
                  flush=True)
            continue
        length = frames_for(shot["dur"])
        print("[%d/%d] %s (%s) %d frames / %.2fs"
              % (i, len(shots), shot["id"], shot["act"], length, length / FPS), flush=True)
        wf = build_workflow(shot, args.width, args.height, args.steps,
                            args.cfg, args.shift, args.seed + i)
        t0 = time.time()
        entry = wait(queue(wf), shot["id"])
        saved = save_outputs(entry, args.out, shot["id"])
        print("    -> %s in %.0fs" % (saved, time.time() - t0), flush=True)

    print("B-ROLL COMPLETE", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
