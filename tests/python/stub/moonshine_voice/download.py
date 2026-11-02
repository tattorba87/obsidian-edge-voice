"""The stand-in's downloads: `voices get` may download; the engine serving the plugin may not."""

import os

from moonshine_voice import CATALOG, cache


def tts_asset_cache_path(cache_root=None):
    return cache()


def download_tts_assets(language, *, voice=None, show_progress=True, on_progress=None):
    if os.environ.get("MOONSHINE_STUB_OFFLINE"):
        raise RuntimeError("network use while offline")
    if voice not in CATALOG.get(language, []):
        raise RuntimeError(f"no voice {voice!r}")
    cache().mkdir(parents=True, exist_ok=True)
    (cache() / f"{voice}.ort").write_text("voice")
    return cache()
