#!/bin/bash -e
set -o pipefail

# Assembles an engine release's files in <out dir>: the edge-voice-engine
# wheel, the Mac moonshine-voice wheels this repository builds, a docopt wheel,
# one hash-locked requirements file per platform, and SHA256SUMS. Users install
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
ENGINE_TAG=$(sed -n 's/^const ENGINE_TAG = "\(.*\)";$/\1/p' "${ROOT}/src/setup.ts")
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

mkdir -p "${OUT}"
uv build --wheel "${ROOT}/engine" -o "${OUT}"
# engine-requirements.py checks these against the locks' hashes.
gh release download "${ENGINE_TAG}" -p "*.whl" -D "${OUT}" --clobber

# docopt (needed by the faster engine) is source-only on PyPI. Build its wheel
# here, from the source archive the lock pins, so users never build anything.
grep -A1 "^docopt==" "${ROOT}/locks/darwin-arm64-mlx.txt" | tr -d '\\\n' > "${WORK}/docopt.txt"
uv venv -q "${WORK}/pip" --python 3.12
uv pip install -q --python "${WORK}/pip" pip==25.2
"${WORK}/pip/bin/python" -I -m pip wheel -q --no-deps --require-hashes -r "${WORK}/docopt.txt" -w "${OUT}"

python3 -I "${ROOT}/scripts/engine-requirements.py" "${OUT}" "${BASE}" "${OUT}"
(cd "${OUT}" && shasum -a 256 -- *.whl requirements-*.txt > SHA256SUMS)
cat "${OUT}/SHA256SUMS"
