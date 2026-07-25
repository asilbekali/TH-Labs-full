# Run TH-Labs on a free Colab GPU

[`TH_Labs_Colab.ipynb`](./TH_Labs_Colab.ipynb) runs the **full** dubbing pipeline
(Whisper · NLLB-200 · edge-tts · OpenVoice cloning · Demucs) on Colab's free
**T4 GPU** and exposes the Studio UI on a public **Cloudflare quick-tunnel** URL —
no account, no ngrok token.

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
- **First load** downloads ~5–6 GB of models (a few minutes); the navbar badge
  flips to `N/4 AI live` when they're warm.
- **OmniVoice** (16 GB) does not fit a free T4 — OpenVoice cloning is used
  instead (fits, GPU-accelerated). Use an A100 (Colab Pro) for OmniVoice.
