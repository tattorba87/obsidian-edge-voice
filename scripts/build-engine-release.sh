#!/bin/bash -e
set -o pipefail

# Assembles an engine release's files in <out dir>: the edge-voice-engine
# wheel, the Mac moonshine-voice wheels this repository builds, a docopt wheel,
# one hash-locked requirements file per platform, THIRD-PARTY-NOTICES.txt and SHA256SUMS. Users install
# with one of the requirements files (see README); <base url> is where the
# release's files will be downloadable from, and is written into those files.
#
#   scripts/build-engine-release.sh <out dir> <base url>
#
# Needs uv and gh (the Mac wheels come from this repository's release).

OUT="$1"
BASE="$2"
[ -n "$OUT" ] && [ -n "$BASE" ] || { echo "usage: $0 <out dir> <base url>" >&2; exit 2; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE_TAG=$(python3 -I -c "import json, sys; print(json.load(open(sys.argv[1]))['moonshine']['release'])" "${ROOT}/engine/pins.json")
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

mkdir -p "${OUT}"
# Hash enforcement applies to the isolated backend, including any backend dependencies.
uv build --wheel "${ROOT}/engine" --force-pep517 --build-constraints "${ROOT}/engine/build-constraints.txt" --require-hashes -o "${OUT}"
# engine-requirements.py checks these against the locks' hashes.
gh release download "${ENGINE_TAG}" -p "*.whl" -D "${OUT}" --clobber

# docopt (needed by the faster engine) is source-only on PyPI. Build its wheel
# here, from the source archive the lock pins, so users never build anything.
grep -A1 "^docopt==" "${ROOT}/locks/darwin-arm64-mlx.txt" | tr -d '\\\n' > "${WORK}/docopt.txt"
uv venv -q "${WORK}/pip" --python 3.12
uv pip install -q --python "${WORK}/pip" --require-hashes --no-build -r "${ROOT}/engine/docopt-build-requirements.txt"
# No isolated build environment may fetch an unhashed backend: use only the
# already hash-checked setuptools/wheel above, and the hash-locked docopt source.
"${WORK}/pip/bin/python" -I -m pip wheel -q --no-build-isolation --no-deps --require-hashes -r "${WORK}/docopt.txt" -w "${OUT}"

python3 -I "${ROOT}/scripts/engine-requirements.py" "${OUT}" "${BASE}" "${OUT}"
# The licences of what the release redistributes (scripts/third-party-notices.py).
cp "${ROOT}/engine/THIRD-PARTY-NOTICES.txt" "${OUT}/"
(cd "${OUT}" && shasum -a 256 -- *.whl requirements-*.txt THIRD-PARTY-NOTICES.txt > SHA256SUMS)
cat "${OUT}/SHA256SUMS"
