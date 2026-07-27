# Run TH-Labs on a free Colab GPU

[`TH_Labs_Colab.ipynb`](./TH_Labs_Colab.ipynb) runs the **full** dubbing pipeline
(Whisper · NLLB-200 · **OmniVoice** zero-shot voice cloning · Demucs) on Colab's
free **T4 GPU** and exposes the Studio UI on a public **Cloudflare quick-tunnel**
URL — no account, no ngrok token.

The React app is built to static files and served by the FastAPI backend, so the
whole app is **one port behind one tunnel**.

## Launch

**If the repo is public** — open directly in Colab:

```
https://colab.research.google.com/github/asilbekali/TH-Labs-full/blob/main/deploy/colab/TH_Labs_Colab.ipynb
```

**If the repo is private** (default) — in Colab: **File → Upload notebook →**
pick `deploy/colab/TH_Labs_Colab.ipynb`. The notebook's clone cell asks for a
GitHub token (scope: `repo`) so it can pull the private repo.

## Steps (in the notebook)

1. **Runtime → Change runtime type → T4 GPU**, Save.
2. Make sure your latest code is pushed to GitHub.
3. Run every cell top-to-bottom — the last cell prints your **public URL**.

## Notes

- **Ephemeral:** the session ends on idle (~90 min) or after ~12 h, and each run
  gives a **new URL**. For an always-on link, deploy to Hugging Face Spaces.
- **First load** downloads ~6 GB of models (a few minutes); the navbar badge
  flips to `N/5 AI live` when they're warm.
- **OmniVoice fits a free T4 comfortably** — it is ~3.1 GB on disk and **~2.2 GB
  of VRAM** in fp16 (measured), so Whisper-medium + NLLB + OmniVoice together
  use ≈8 GB of the T4's 16 GB. What blocks it on the dev laptop is not VRAM but
  **`transformers>=5.3`**, which is unreachable on Python 3.14 (the newer Rust
  `tokenizers` segfaults there). Colab runs Python 3.12, so it just works.
- **Install order matters:** `torchaudio` must be installed *before* `omnivoice`,
  and `numba>=0.61` pinned — otherwise the resolver backtracks to numba 0.53.1,
  which cannot build on Python ≥3.10. Cell 5 handles both.
- **Cell 6 is a preflight**: it verifies OmniVoice imports, that `uz`/`ru`/`en`
  map to valid OmniVoice ids, and that NLLB still translates under
  transformers 5.x — so failures surface in seconds, not mid-demo.
