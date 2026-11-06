"""Writes engine/THIRD-PARTY-NOTICES.txt: the licences of what the engine release
redistributes but didn't write itself.

    python3 -I scripts/third-party-notices.py

Engine releases carry moonshine-voice wheels for macOS built by this repository
(see engine/pins.json). Those wheels contain Moonshine's native library, which
compiles in the libraries under Moonshine's core/third-party, and a copy of ONNX
Runtime, which brings its own third-party notices. Their licences are fetched
from Moonshine's source at the tag the wheels are built from, and from ONNX
Runtime's at the bundled version. Needs network; review the diff, then commit.
The docopt wheel the release also carries is MIT, and its licence is inside it.
"""

import sys
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "engine" / "THIRD-PARTY-NOTICES.txt"
MOONSHINE_TAG = "v0.1.5"
ONNXRUNTIME_TAG = "v1.23.2"
MOONSHINE = f"https://raw.githubusercontent.com/moonshine-ai/moonshine/{MOONSHINE_TAG}"
ONNXRUNTIME = f"https://raw.githubusercontent.com/microsoft/onnxruntime/{ONNXRUNTIME_TAG}"

# What libmoonshine and the wheels bundle (doctest only builds Moonshine's tests).
NOTICES = [
    ("Moonshine (moonshine-voice)", "MIT", f"{MOONSHINE}/LICENSE"),
    ("ONNX Runtime", "MIT", f"{MOONSHINE}/core/third-party/onnxruntime/LICENSE.txt"),
    ("Eigen", "MPL 2.0", f"{MOONSHINE}/core/third-party/Eigen/COPYING.MPL2"),
    ("kaldi-native-fbank", "Apache 2.0", f"{MOONSHINE}/core/third-party/kaldi-native-fbank/LICENSE"),
    ("KISS FFT", "BSD-3-Clause", f"{MOONSHINE}/core/third-party/kissfft/COPYING"),
    ("JSON for Modern C++ (nlohmann/json)", "MIT", f"{MOONSHINE}/core/third-party/nlohmann/LICENSE.MIT"),
    ("UTF8-CPP", "BSL 1.0", f"{MOONSHINE}/core/third-party/utf-8/LICENSE.txt"),
    ("utf8proc", "MIT", f"{MOONSHINE}/core/third-party/utf8proc/LICENSE.md"),
    ("ONNX Runtime's third-party notices", "various", f"{ONNXRUNTIME}/ThirdPartyNotices.txt"),
]


def fetch(url: str) -> str:
    # Fixed HTTPS URLs at pinned tags, listed above.
    with urlopen(url, timeout=60) as response:  # nosec B310
        return response.read().decode("utf-8").replace("\r\n", "\n").strip()


def main() -> int:
    parts = [
        "Third-party notices for Edge Voice engine releases",
        "",
        "Engine releases redistribute moonshine-voice wheels for macOS, built by this",
        f"repository from Moonshine {MOONSHINE_TAG}. They contain the software below; each",
        "licence follows. Edge Voice itself is MIT licensed (LICENSE in the repository).",
        "Source for the unmodified Moonshine and bundled libraries, including Eigen's",
        f"MPL-covered headers: https://github.com/moonshine-ai/moonshine/tree/{MOONSHINE_TAG}/core/third-party",
        "The matching release source is freely available at that versioned URL.",
        "",
        *(f"- {name}: {licence}" for name, licence, _ in NOTICES),
    ]
    for name, licence, url in NOTICES:
        parts += ["", "", "=" * 78, f"{name} ({licence})", url, "=" * 78, "", fetch(url)]
    OUT.write_text("\n".join(parts) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1000} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
