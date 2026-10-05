"""Translation repair for segments NLLB rendered badly.

NLLB-200 distilled-600M is small, and on a minority of segments it fails in
recognisable ways: it copies the source through untranslated, it truncates, it
loops a phrase, or it returns something wildly longer or shorter than the source
could possibly be. Those segments are sent to a chat model for a second attempt.

Two decisions worth knowing about:

*Only suspect segments are sent.* `suspect_reason` below has to name a concrete
defect before a segment leaves this machine. That keeps the cost and the latency
proportional to how often NLLB actually fails, and it means the great majority of
a transcript is never transmitted anywhere.

*Every failure is soft.* No key, no network, a timeout, a malformed reply, a
refusal, a reply that looks worse than what we had — all of them keep NLLB's
original translation. This stage can only improve a segment or leave it alone;
it can never cost the user a dub.

The provider is configured, not hardcoded: any OpenAI-compatible
`/chat/completions` endpoint works. Called with stdlib urllib rather than a new
HTTP dependency, since the request is one small JSON POST.
"""
from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.request

from ..config import get_settings
from ..languages import get as get_lang
from ..schemas import Segment

log = logging.getLogger(__name__)

# A target this much longer or shorter than its source is not a translation of
# it. Real language-pair ratios sit well inside this; NLLB's failures do not.
MIN_RATIO, MAX_RATIO = 0.35, 2.6
# Shorter than this and the ratio test is noise — "Yes." is legitimately 1/20th
# of its source, and "Ha, albatta." is legitimately three times it.
MIN_CHARS_FOR_RATIO = 25
# Short sources still get an overlong guard, because the asymmetry is real: a
# brief line can honestly translate short, but a four-word sentence coming back
# as a paragraph is the model rambling, not the language being verbose. Both
# tests must trip, so a short source with a merely longish target is left alone.
SHORT_OVERLONG_RATIO, SHORT_OVERLONG_CHARS = 4.0, 60
# A word repeated this many times in a row is a decoder loop, not emphasis.
REPEAT_RUN = 4
# Never send more than this many segments in one request.
BATCH = 12


def _repeats(text: str) -> bool:
    """True if some word runs REPEAT_RUN times consecutively."""
    words = re.findall(r"\w+", text.lower(), flags=re.UNICODE)
    run, prev = 1, None
    for w in words:
        run = run + 1 if w == prev else 1
        if run >= REPEAT_RUN:
            return True
        prev = w
    return False


def suspect_reason(seg: Segment) -> str | None:
    """Why this segment's translation looks wrong, or None if it looks fine.

    Returning the reason rather than a bool is deliberate: it goes in the log,
    so when this stage starts firing on everything the cause is already written
    down.
    """
    src = (seg.source_text or "").strip()
    tgt = (seg.target_text or "").strip()
    if not src:
        return None
    if not tgt:
        return "empty"
    if tgt == src:
        return "untranslated (target identical to source)"
    if _repeats(tgt):
        return "repeated word run"
    ratio = len(tgt) / len(src)
    if len(src) >= MIN_CHARS_FOR_RATIO:
        if ratio < MIN_RATIO:
            return f"truncated (target {ratio:.2f}x source)"
        if ratio > MAX_RATIO:
            return f"overlong (target {ratio:.2f}x source)"
    elif ratio > SHORT_OVERLONG_RATIO and len(tgt) > SHORT_OVERLONG_CHARS:
        return f"overlong (target {ratio:.2f}x a short source)"
    return None


def available() -> bool:
    s = get_settings()
    return bool(s.refine_enabled and s.refine_api_key and s.refine_base_url)


def _language_name(code: str) -> str:
    lang = get_lang(code)
    return lang.name if lang else code


def _post(payload: dict) -> dict | None:
    s = get_settings()
    url = s.refine_base_url.rstrip("/") + "/chat/completions"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {s.refine_api_key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=s.refine_timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # The body often says exactly what is wrong (bad key, quota, model
        # name). The key itself is in a header, never in what gets logged.
        body = exc.read().decode("utf-8", "replace")[:200] if exc.fp else ""
        log.warning("refine: HTTP %s from provider — %s", exc.code, body)
    except Exception as exc:
        log.warning("refine: request failed (%s)", type(exc).__name__)
    return None


def refine(segments: list[Segment], source_lang: str,
           target_lang: str) -> tuple[int, dict[int, str]]:
    """Retranslate the segments whose translations look wrong.

    Returns (number examined, {segment index: reason}) and edits `target_text`
    in place for the ones that came back better. Segments that look fine are
    never sent.
    """
    if not available():
        return 0, {}
    suspects = {i: r for i, seg in enumerate(segments)
                if (r := suspect_reason(seg))}
    if not suspects:
        return 0, {}

    s = get_settings()
    src_name, tgt_name = _language_name(source_lang), _language_name(target_lang)
    fixed = 0
    order = list(suspects)
    for start in range(0, len(order), BATCH):
        idx = order[start:start + BATCH]
        lines = [{"id": i, "source": segments[i].source_text,
                  "current": segments[i].target_text or ""} for i in idx]
        prompt = (
            f"You are correcting machine translations for a video dub from "
            f"{src_name} into {tgt_name}. Each item has the original line and a "
            f"machine translation that may be wrong, truncated, repetitive, or "
            f"left untranslated.\n\n"
            f"Return corrected {tgt_name} for every item. Keep each one close in "
            f"length to its source line, because it has to be spoken over the "
            f"same moment of video. Preserve names and numbers. Translate the "
            f"meaning, not the words. Reply with JSON only, in the form "
            f'{{"items":[{{"id":0,"text":"..."}}]}}.\n\n'
            f"{json.dumps(lines, ensure_ascii=False)}"
        )
        data = _post({
            "model": s.refine_model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
        })
        if not data:
            continue
        try:
            content = data["choices"][0]["message"]["content"]
            items = json.loads(content).get("items", [])
        except Exception as exc:
            log.warning("refine: unusable reply (%s)", type(exc).__name__)
            continue
        for item in items:
            try:
                i, text = int(item["id"]), str(item["text"]).strip()
            except (KeyError, TypeError, ValueError):
                continue
            if i not in suspects or not text:
                continue
            # Do not accept a "correction" that trips the same tests the
            # original failed — a worse answer is still a worse answer.
            candidate = Segment(id=segments[i].id, start=segments[i].start,
                                end=segments[i].end,
                                source_text=segments[i].source_text,
                                target_text=text)
            if suspect_reason(candidate):
                log.info("refine: rejected replacement for segment %s (%s)",
                         i, suspect_reason(candidate))
                continue
            segments[i].target_text = text
            fixed += 1
    log.info("refine: %s/%s suspect segments repaired", fixed, len(suspects))
    return fixed, suspects
