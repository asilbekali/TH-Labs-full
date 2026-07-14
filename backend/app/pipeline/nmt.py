"""Stage 2 — NMT (Neural Machine Translation) with NLLB-200.

Chosen model: **facebook/nllb-200-distilled-600M** — a Transformer encoder-decoder
(matching the paper's Transformer-based NMT), covering 200 languages and small
enough for a 6 GB GPU. Following the paper, translations are additionally scored
for *length compatibility* with the source segment so the dubbed line fits the
original utterance's time budget.

Real path uses HuggingFace `transformers`; simulation uses the canned bilingual
sample translations (and falls back to the source text for unseen content).
"""
from __future__ import annotations

from ..config import get_settings
from ..languages import get as get_lang
from ..schemas import Segment
from . import samples


class NLLBTranslator:
    key = "nmt"
    label = "Translation"
    engine = "NLLB-200 (distilled-600M)"

    def __init__(self) -> None:
        import threading
        self._model = None
        self._tok = None
        self._lock = threading.Lock()

    def available(self) -> bool:
        # Detect installation without importing torch/transformers (see stt.py).
        import importlib.util
        settings = get_settings()
        if settings.mode == "demo":
            return False
        return (importlib.util.find_spec("transformers") is not None
                and importlib.util.find_spec("torch") is not None)

    def mode(self) -> str:
        return "real" if self.available() else "simulation"

    def _load(self):
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            import torch
            from transformers import (AutoModelForSeq2SeqLM, AutoTokenizer)
            s = get_settings()
            # use_fast=False → the SentencePiece tokenizer. The fast (Rust
            # `tokenizers`) NLLB tokenizer segfaults on Python 3.14; the slow one
            # is stable and produces identical ids.
            tok = AutoTokenizer.from_pretrained(s.nmt_model, use_fast=False)
            model = AutoModelForSeq2SeqLM.from_pretrained(s.nmt_model)
            if torch.cuda.is_available():
                model = model.to("cuda")
            model.eval()
            self._tok, self._model = tok, model

    def unload(self) -> None:
        """Drop the model and free its VRAM (see stt.unload)."""
        from .stt import _free_cuda
        with self._lock:
            self._model = None
            self._tok = None
        _free_cuda()

    # ── real translation ──────────────────────────────────────────────────
    def translate(self, segments: list[Segment], source_lang: str,
                  target_lang: str) -> list[Segment]:
        self._load()
        import torch
        src = get_lang(source_lang)
        tgt = get_lang(target_lang)
        if not tgt:
            return segments
        self._tok.src_lang = src.nllb if src else "eng_Latn"
        bos = self._tok.convert_tokens_to_ids(tgt.nllb)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        # Translate in batches (padded) — one generate() per ~16 segments
        # instead of one per segment. Huge speed-up on long videos.
        BATCH = 16
        for i in range(0, len(segments), BATCH):
            chunk = segments[i:i + BATCH]
            texts = [seg.source_text for seg in chunk]
            enc = self._tok(texts, return_tensors="pt", padding=True,
                            truncation=True, max_length=256).to(device)
            in_len = enc["input_ids"].shape[1]
            max_new = max(40, int(in_len * 3) + 16)
            gen = self._model.generate(
                **enc, forced_bos_token_id=bos, max_new_tokens=max_new,
                num_beams=4, length_penalty=1.0, no_repeat_ngram_size=3)
            out = self._tok.batch_decode(gen, skip_special_tokens=True)
            for seg, txt in zip(chunk, out):
                seg.target_text = txt.strip()
        return segments

    # ── simulation ────────────────────────────────────────────────────────
    def simulate(self, segments: list[Segment], target_lang: str,
                 scenario: str = "lecture") -> list[Segment]:
        sc = samples.get_scenario(scenario)
        table = sc["translations"].get(target_lang)
        for i, seg in enumerate(segments):
            if table and i < len(table):
                seg.target_text = table[i]
            else:
                # graceful fallback: keep source text (UI flags simulation mode)
                seg.target_text = seg.source_text
        return segments

    @staticmethod
    def length_ratio(segments: list[Segment]) -> float:
        """Mean target/source character ratio — the paper's duration-fit signal."""
        ratios = []
        for s in segments:
            if s.target_text and s.source_text:
                ratios.append(len(s.target_text) / max(len(s.source_text), 1))
        return round(sum(ratios) / len(ratios), 2) if ratios else 1.0
