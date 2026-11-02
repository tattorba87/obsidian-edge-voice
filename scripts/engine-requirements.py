"""Writes the requirements files an engine release carries, one per platform.

Each file is that platform's lock (locks/<platform>.txt: every package at an
exact version with its hashes) plus the engine wheel, so one
`uv pip install --require-hashes -r <file>` installs exactly what was locked
and refuses anything whose bytes differ. What isn't on PyPI as a wheel is
named by URL with its hash: the engine wheel, the Mac moonshine-voice wheels
and a docopt wheel (all in the release), and spaCy's English model (from
spaCy's own release). A URL can't be answered by a same-named package from
PyPI, which matters because we don't publish there.

    python scripts/engine-requirements.py <dist dir> <base url> <out dir>

<dist dir> holds the wheels (scripts/build-engine-release.sh puts them there);
<base url> is where the release's files will be downloadable from.
Windows on ARM uses the x64 file, as setup uses the x64 lock there.
"""

import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Platform, and the Mac wheel this repository builds for it.
PLATFORMS = {
    "linux-x64": None,
    "linux-arm64": None,
    "win32-x64": None,
    "darwin-x64": "x86_64",
    "darwin-arm64": "arm64",
}


def fail(message: str) -> None:
    sys.exit(f"engine-requirements: {message}")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def by_url(name: str, url: str, digest: str) -> str:
    return f"{name} @ {url} \\\n    --hash=sha256:{digest}\n"


def locked_hashes(block: str) -> list[str]:
    return re.findall(r"--hash=sha256:([0-9a-f]{64})", block)


def read_lock(name: str) -> dict[str, str]:
    """Splits locks/<name>.txt into {package: block}, each block a requirement with its hashes."""
    blocks: dict[str, str] = {}
    for block in re.split(r"\n(?=[A-Za-z0-9])", (ROOT / "locks" / f"{name}.txt").read_text().strip()):
        package = re.match(r"([A-Za-z0-9_.-]+)==", block)
        if package:
            blocks[package.group(1).lower()] = block.rstrip() + "\n"
    return blocks


def one(dist: Path, pattern: str) -> Path:
    found = sorted(dist.glob(pattern))
    if len(found) != 1:
        fail(f"expected one {pattern} in {dist}, found {len(found)}")
    return found[0]


def mac_wheel(blocks: dict[str, str], dist: Path, base: str, cpu: str) -> None:
    """Names this repository's moonshine-voice wheel, which must be the one the lock pins."""
    wheel = one(dist, f"moonshine_voice-*_{cpu}.whl")
    if sha256(wheel) not in locked_hashes(blocks["moonshine-voice"]):
        fail(f"{wheel.name} isn't the wheel locks pin")
    blocks["moonshine-voice"] = by_url("moonshine-voice", f"{base}/{wheel.name}", sha256(wheel))


def docopt_wheel(blocks: dict[str, str], dist: Path, base: str) -> None:
    """Names the docopt wheel built for the release (PyPI only has its source).

    build-engine-release.sh builds it from the source archive the lock pins,
    checked against that hash, so users install a wheel and build nothing.
    """
    wheel = one(dist, "docopt-*-py2.py3-none-any.whl")
    version = wheel.name.split("-")[1]
    if not blocks["docopt"].startswith(f"docopt=={version} "):
        fail(f"{wheel.name} isn't the locked docopt")
    blocks["docopt"] = by_url("docopt", f"{base}/{wheel.name}", sha256(wheel))


def spacy_model(blocks: dict[str, str]) -> None:
    """Names spaCy's English model by its URL in src/setup.ts; it isn't on PyPI."""
    setup = (ROOT / "src" / "setup.ts").read_text()
    model = re.search(r'const SPACY_MODEL = \{\s*url: "([^"]+)",\s*asset: "[^"]+",\s*sha256: "([0-9a-f]{64})"', setup)
    if not model:
        fail("SPACY_MODEL not found in src/setup.ts")
    if model.group(2) not in locked_hashes(blocks["en-core-web-sm"]):
        fail("SPACY_MODEL's checksum in src/setup.ts isn't the one the lock pins")
    blocks["en-core-web-sm"] = by_url("en-core-web-sm", model.group(1), model.group(2))


def main() -> None:
    if len(sys.argv) != 4:
        fail("usage: engine-requirements.py <dist dir> <base url> <out dir>")
    dist, base, out = Path(sys.argv[1]), sys.argv[2].rstrip("/"), Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    engine = one(dist, "edge_voice_engine-*.whl")

    for platform, cpu in PLATFORMS.items():
        blocks = read_lock(platform)
        if cpu:
            mac_wheel(blocks, dist, base, cpu)
        files = {platform: ("edge-voice-engine", blocks)}
        if platform == "darwin-arm64":
            mlx = read_lock("darwin-arm64-mlx")
            for package, block in mlx.items():
                # lock-engine.sh constrains the MLX lock by the base lock, so shared packages agree.
                if package in blocks and block.split()[0] != blocks[package].split()[0]:
                    fail(f"{package} differs between the darwin-arm64 locks")
            docopt_wheel(mlx, dist, base)
            spacy_model(mlx)
            files["darwin-arm64-mlx"] = ("edge-voice-engine[mlx]", {**mlx, **blocks})
        for name, (requirement, contents) in files.items():
            text = "".join(contents[package] for package in sorted(contents))
            text += by_url(requirement, f"{base}/{engine.name}", sha256(engine))
            (out / f"requirements-{name}.txt").write_text(text)
            print(f"requirements-{name}.txt")


if __name__ == "__main__":
    main()
