"""The voices people can get, described for people.

Built from voices.json, so only voices with pinned SHA-256 hashes are offered
and `voices get` never refuses one of them. Names, accents and genders come
from the voice IDs (Kokoro's `af_`/`bm_` prefixes, Piper's speaker and quality
suffix); sizes are what still has to be downloaded on this computer, so the
first Kokoro voice counts its shared model and the next ones only themselves.
Reads files and sizes only; it never downloads or hashes anything.
"""

import json
from pathlib import Path

LANGUAGES = {"en_us": "American English", "en_gb": "British English"}

# Best first. Kokoro's own grades (VOICES.md in hexgrad/Kokoro-82M): heart A,
# bella A-, nicole and emma B-, michael and fenrir C+, george C (Kokoro is
# Apache 2.0). Then Piper's high-quality voices trained on public-domain
# recordings; some other Piper voices (lessac, ryan) come from data licensed
# for research or non-commercial use only, so they aren't recommended.
RECOMMENDED = [
    "kokoro_af_heart",
    "kokoro_af_bella",
    "kokoro_bf_emma",
    "kokoro_am_michael",
    "kokoro_bm_george",
    "kokoro_af_nicole",
    "kokoro_am_fenrir",
    "piper_en_US-ljspeech-high",
    "piper_en_GB-cori-high",
]

# Piper voices whose speaker is one known person; multi-speaker sets are left blank.
PIPER_GENDERS = {
    "alan": "male",
    "alba": "female",
    "amy": "female",
    "bryce": "male",
    "cori": "female",
    "danny": "male",
    "hfc_female": "female",
    "hfc_male": "male",
    "jenny_dioco": "female",
    "joe": "male",
    "john": "male",
    "kathleen": "female",
    "kristin": "female",
    "kusal": "male",
    "lessac": "female",
    "ljspeech": "female",
    "norman": "male",
    "northern_english_male": "male",
    "reza_ibrahim": "male",
    "ryan": "male",
    "southern_english_female": "female",
}

# Piper speakers whose IDs don't title-case well (datasets, and names that repeat the gender).
PIPER_NAMES = {
    "arctic": "ARCTIC",
    "hfc_female": "HFC",
    "hfc_male": "HFC",
    "jenny_dioco": "Jenny",
    "l2arctic": "L2-ARCTIC",
    "libritts": "LibriTTS",
    "libritts_r": "LibriTTS-R",
    "ljspeech": "LJSpeech",
    "northern_english_male": "Northern English",
    "southern_english_female": "Southern English",
    "vctk": "VCTK",
}

# Listen before downloading: the voices' own pages, opened in a browser.
SAMPLES = {
    "Kokoro": "https://huggingface.co/spaces/hexgrad/Kokoro-TTS",
    "Piper": "https://rhasspy.github.io/piper-samples/",
}


def describe(language: str, voice: str) -> dict:
    """A voice's readable name, accent, gender, engine and quality, from its ID."""
    accent = LANGUAGES.get(language, language)
    if voice.startswith("kokoro_"):
        _, code, name = voice.split("_", 2)
        gender = {"f": "female", "m": "male"}.get(code[1:2], "")
        return {"name": name.title(), "accent": accent, "gender": gender, "engine": "Kokoro", "quality": ""}
    speaker = voice.removeprefix("piper_").split("-", 1)[-1]
    speaker, _, quality = speaker.rpartition("-") if "-" in speaker else (speaker, "", "")
    name = PIPER_NAMES.get(speaker) or speaker.replace("_", " ").title()
    return {
        "name": name,
        "accent": accent,
        "gender": PIPER_GENDERS.get(speaker, ""),
        "engine": "Piper",
        "quality": quality,
    }


def manifest_data() -> dict:
    return json.loads(Path(__file__).with_name("voices.json").read_text())


def catalog(cache: Path, data: dict | None = None) -> list[dict]:
    """Every verified voice, recommended first, with what this computer has of it."""
    data = data or manifest_data()
    files = data["moonshine"]["files"]
    faster = set(data["faster"]["voices"])
    voices = []
    for key, needed in data["moonshine"]["voices"].items():
        language, voice = key.split("/", 1)
        missing = [name for name in needed if not (cache / name).exists()]
        voices.append(
            {
                "id": voice,
                "language": language,
                **describe(language, voice),
                "recommended": voice in RECOMMENDED,
                "faster": voice in faster,
                "installed": not missing,
                "size": sum(files[name]["size"] for name in needed),
                "download": sum(files[name]["size"] for name in missing),
            }
        )
    rank = {voice: i for i, voice in enumerate(RECOMMENDED)}
    voices.sort(
        key=lambda v: (
            rank.get(v["id"], len(rank)),
            v["engine"] != "Kokoro",
            v["language"] != "en_us",
            v["name"],
            v["quality"],
        )
    )
    return voices


def language_of(voice: str, data: dict | None = None) -> str | None:
    """The language a verified voice belongs to, so `voices get` needs no --language."""
    data = data or manifest_data()
    for key in data["moonshine"]["voices"]:
        language, name = key.split("/", 1)
        if name == voice:
            return language
    return None


def megabytes(size: int) -> str:
    if size < 1_000_000:
        return "under 1 MB"
    return f"{round(size / 1_000_000)} MB"


def label(voice: dict, separator: str = " · ") -> str:
    """'Heart · American English · female · Kokoro', for lists."""
    parts = [voice["name"], voice["accent"], voice["gender"], voice["engine"]]
    if voice["quality"]:
        parts.append(voice["quality"] + " quality")
    return separator.join(part for part in parts if part)
