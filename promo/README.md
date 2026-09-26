# TH-Labs promo video

A ~53 s product ad built the same way the reference clip was structured —
**Intro → Problem → Use Case → Call to Action** — with the b-roll generated
locally on ComfyUI and everything else rendered from code.

```bash
python promo/render_vo.py        # 1. narration + final timeline
python promo/render_music.py     # 2. music bed
python promo/comfy_broll.py --storyboard promo/out/timeline.json   # 3. ComfyUI
python promo/render_cards.py --storyboard promo/out/timeline.json  # 4. type cards
python promo/assemble.py         # 5. cut, grade, mix, mux
```

or just `python promo/build.py`.

## How it is put together

[`storyboard.json`](storyboard.json) is the single source of truth: twelve shots,
each either a **b-roll** shot (a text-to-video prompt for ComfyUI) or a **card**
(a motion-graphics scene drawn with Pillow), plus the narration line that runs
under it and the brand palette lifted from `frontend/src/index.css`.

| Stage | Script | What it does |
|-------|--------|--------------|
| Narration | `render_vo.py` | Synthesises each line with **edge-tts** — the same neural TTS the dubbing pipeline uses, so the ad is voiced by the product it advertises. Then it stretches any shot that is shorter than its line and writes `out/timeline.json`. **Run this first**; everything downstream reads that file. |
| Music | `render_music.py` | Synthesises the bed procedurally (no sample library in the repo): a sine pad on Am–F–C–G that changes chord when the act changes, a sub thump on each boundary, and a filter that opens toward the CTA. |
| B-roll | `comfy_broll.py` | Drives a local ComfyUI over HTTP — `POST /prompt` → poll `/history` → `GET /view`. Six text-to-video shots on **WAN 2.2 TI2V-5B**. |
| Cards | `render_cards.py` | Six kinetic-typography scenes drawn at 2× and downsampled, piped to ffmpeg as raw RGB. Beats are expressed as *fractions* of each shot's duration, so a shot stretched to fit narration re-times instead of freezing. |
| Cut | `assemble.py` | Conforms every shot to 1920×1080/30 fps, grades and slow-pushes the b-roll, adds caption plates, concatenates, mixes narration over the bed, muxes. |

## The ComfyUI side

The workflow in `comfy_broll.py:build_workflow` is API-format JSON, so it needs
no custom nodes and never touches the web UI:

```
UNETLoader (wan2.2_ti2v_5B_fp16, cast to fp8_e4m3fn)
  └─ ModelSamplingSD3 (shift 8.0) ─┐
CLIPLoader (umt5_xxl_fp8, type=wan) ├─ KSampler (uni_pc/simple, 26 steps, cfg 5)
  ├─ CLIPTextEncode  (prompt)      │     └─ VAEDecode ─ CreateVideo ─ SaveVideo
  └─ CLIPTextEncode  (negative)    │
VAELoader (wan2.2_vae) ─ Wan22ImageToVideoLatent (960×544, 4n+1 frames) ─┘
```

Two constraints worth remembering:

- **Frame counts must be `4n+1`.** WAN's VAE compresses time 4×; `frames_for()`
  rounds each shot's duration to the nearest legal length at 24 fps.
- **The UNET is loaded as `fp8_e4m3fn`.** The file is 10 GB fp16, which will not
  fit a 6 GB card; casting on load puts the resident model at ~4 GB and leaves
  room for the VAE decode.

### Models this expects

Downloaded from `Comfy-Org/Wan_2.2_ComfyUI_Repackaged` into the ComfyUI models
directory (18.2 GB total):

| File | Folder | Size |
|------|--------|------|
| `wan2.2_ti2v_5B_fp16.safetensors` | `diffusion_models/` | 10.0 GB |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `text_encoders/` | 6.7 GB |
| `wan2.2_vae.safetensors` | `vae/` | 1.4 GB |

Set `COMFY_SERVER` if ComfyUI is not on `127.0.0.1:8188`.

## Editing it

- **Change the copy** — edit `text` / `vo` in `storyboard.json`, re-run
  `render_vo.py`, then re-render cards. Durations re-fit themselves.
- **Change a b-roll shot** — edit its `prompt`, then
  `python promo/comfy_broll.py --only S03 --force`.
- **Preview one card cheaply** — `python promo/render_cards.py --only S08 --still 3.0`
  writes a single PNG instead of a whole clip.
