"""Supported languages.

Each entry carries both the Whisper ISO-639-1 code (for ASR / source language
auto-detect) and the NLLB-200 FLORES code (for the NMT stage), so the same list
drives every stage of the pipeline and the frontend dropdowns.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict


@dataclass(frozen=True)
class Language:
    code: str        # short id used by the API / UI (ISO-639-1 where possible)
    name: str        # English display name
    native: str      # endonym
    flag: str        # emoji flag
    whisper: str     # Whisper language code
    nllb: str        # NLLB-200 FLORES-200 code

    def as_dict(self) -> dict:
        return asdict(self)


LANGUAGES: list[Language] = [
    Language("en", "English", "English", "🇬🇧", "en", "eng_Latn"),
    Language("uz", "Uzbek", "Oʻzbekcha", "🇺🇿", "uz", "uzn_Latn"),
    Language("ru", "Russian", "Русский", "🇷🇺", "ru", "rus_Cyrl"),
    Language("es", "Spanish", "Español", "🇪🇸", "es", "spa_Latn"),
    Language("fr", "French", "Français", "🇫🇷", "fr", "fra_Latn"),
    Language("de", "German", "Deutsch", "🇩🇪", "de", "deu_Latn"),
    Language("it", "Italian", "Italiano", "🇮🇹", "it", "ita_Latn"),
    Language("pt", "Portuguese", "Português", "🇵🇹", "pt", "por_Latn"),
    Language("nl", "Dutch", "Nederlands", "🇳🇱", "nl", "nld_Latn"),
    Language("pl", "Polish", "Polski", "🇵🇱", "pl", "pol_Latn"),
    Language("tr", "Turkish", "Türkçe", "🇹🇷", "tr", "tur_Latn"),
    Language("ar", "Arabic", "العربية", "🇸🇦", "ar", "arb_Arab"),
    Language("fa", "Persian", "فارسی", "🇮🇷", "fa", "pes_Arab"),
    Language("hi", "Hindi", "हिन्दी", "🇮🇳", "hi", "hin_Deva"),
    Language("bn", "Bengali", "বাংলা", "🇧🇩", "bn", "ben_Beng"),
    Language("ur", "Urdu", "اردو", "🇵🇰", "ur", "urd_Arab"),
    Language("zh", "Chinese", "中文", "🇨🇳", "zh", "zho_Hans"),
    Language("ja", "Japanese", "日本語", "🇯🇵", "ja", "jpn_Jpan"),
    Language("ko", "Korean", "한국어", "🇰🇷", "ko", "kor_Hang"),
    Language("vi", "Vietnamese", "Tiếng Việt", "🇻🇳", "vi", "vie_Latn"),
    Language("id", "Indonesian", "Bahasa Indonesia", "🇮🇩", "id", "ind_Latn"),
    Language("th", "Thai", "ไทย", "🇹🇭", "th", "tha_Thai"),
    Language("uk", "Ukrainian", "Українська", "🇺🇦", "uk", "ukr_Cyrl"),
    Language("kk", "Kazakh", "Қазақша", "🇰🇿", "kk", "kaz_Cyrl"),
    Language("az", "Azerbaijani", "Azərbaycan", "🇦🇿", "az", "azj_Latn"),
    Language("sv", "Swedish", "Svenska", "🇸🇪", "sv", "swe_Latn"),
    Language("cs", "Czech", "Čeština", "🇨🇿", "cs", "ces_Latn"),
    Language("el", "Greek", "Ελληνικά", "🇬🇷", "el", "ell_Grek"),
    Language("he", "Hebrew", "עברית", "🇮🇱", "he", "heb_Hebr"),
    Language("ro", "Romanian", "Română", "🇷🇴", "ro", "ron_Latn"),
    Language("hu", "Hungarian", "Magyar", "🇭🇺", "hu", "hun_Latn"),
    Language("fi", "Finnish", "Suomi", "🇫🇮", "fi", "fin_Latn"),
]

_BY_CODE = {lang.code: lang for lang in LANGUAGES}


def get(code: str) -> Language | None:
    return _BY_CODE.get(code)


def all_dicts() -> list[dict]:
    return [lang.as_dict() for lang in LANGUAGES]
