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
        self._model = None
        self._tok = None

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
        import torch
        from transformers import (AutoModelForSeq2SeqLM, AutoTokenizer)
        s = get_settings()
        self._tok = AutoTokenizer.from_pretrained(s.nmt_model)
        self._model = AutoModelForSeq2SeqLM.from_pretrained(s.nmt_model)
        if torch.cuda.is_available():
            self._model = self._model.to("cuda")

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
        for seg in segments:
            enc = self._tok(seg.source_text, return_tensors="pt")
            if torch.cuda.is_available():
                enc = {k: v.to("cuda") for k, v in enc.items()}
            # length-compatibility: cap generated length near the source length
            max_len = max(16, int(len(seg.source_text.split()) * 2.2))
            gen = self._model.generate(**enc, forced_bos_token_id=bos,
                                       max_length=max_len, num_beams=4)
            seg.target_text = self._tok.batch_decode(
                gen, skip_special_tokens=True)[0].strip()
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
