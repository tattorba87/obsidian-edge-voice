#!/bin/bash -e
set -o pipefail

# The Engine package workflow's check, on this computer: builds the engine
# release, serves it locally, runs the setup steps Edge Voice shows for this
# platform into a throwaway home folder, gets a voice, lists it, and has the
# engine speak (with the network cut off on macOS). No window opens and your
# own ~/.edge-voice is untouched.
#
#   scripts/check-engine-local.sh [--faster] [voice]
#
# uv's packages and the voices are kept in .scratch/ (engine-check-uv and
# engine-check-voices), so later runs download little.
# Needs uv, bun and gh.

FASTER=false
if [ "$1" = "--faster" ]; then FASTER=true; shift; fi
VOICE="${1:-kokoro_af_bella}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=8765
BASE="http://127.0.0.1:${PORT}"
WORK="$(mktemp -d)"
SERVER=""
cleanup() {
	if [ -n "${SERVER}" ]; then { kill "${SERVER}" && wait "${SERVER}"; } 2>/dev/null || true; fi
	rm -rf "${WORK}"
}
trap cleanup EXIT

echo "== Building the engine release"
"${ROOT}/scripts/build-engine-release.sh" "${WORK}/release" "${BASE}"

echo "== Serving it at ${BASE}"
python3 -m http.server "${PORT}" --bind 127.0.0.1 --directory "${WORK}/release" >/dev/null 2>&1 &
SERVER=$!
for _ in $(seq 30); do curl -sSf "${BASE}/SHA256SUMS" >/dev/null && break; sleep 1; done

read -r PLATFORM ARCH < <(bun -e 'console.log(process.platform, process.arch)')
echo "== The setup steps for ${PLATFORM}-${ARCH} (faster engine: ${FASTER})"
# A cache of its own that outlives the run, so PyPI packages download once; the
# wheels built here change between runs at the same URL, so they're dropped
# from it first. uv's Python builds are shared with yours. A fresh home for the engine.
export UV_CACHE_DIR="${ROOT}/.scratch/engine-check-uv"
UV_PYTHON_INSTALL_DIR="$(uv python dir)"
export UV_PYTHON_INSTALL_DIR
uv cache clean -q edge-voice-engine moonshine-voice docopt 2>/dev/null || true
export MOONSHINE_VOICE_CACHE="${ROOT}/.scratch/engine-check-voices"
mkdir -p "${MOONSHINE_VOICE_CACHE}" "${WORK}/home"
bun "${ROOT}/scripts/setup-steps.ts" "${PLATFORM}" "${ARCH}" "${FASTER}" "${VOICE}" "${BASE}" > "${WORK}/steps.json"
python3 -I -c "import json, sys; print('\n'.join(json.load(open(sys.argv[1]))))" "${WORK}/steps.json" |
	while IFS= read -r command; do
		echo "+ ${command}"
		HOME="${WORK}/home" bash -ec "${command}" < /dev/null
	done

PYTHON="${WORK}/home/.edge-voice/engine/bin/python"
echo "== The voice list"
HOME="${WORK}/home" "${PYTHON}" -I -m edge_voice_engine voices list | head -15

echo "== Speaking"
SPEAK=(python3 -I "${ROOT}/scripts/engine-speaks.py" "${PYTHON}" "${VOICE}")
[ "${FASTER}" = true ] && SPEAK+=(mlx)
if [ "${PLATFORM}" = darwin ]; then
	HOME="${WORK}/home" sandbox-exec -p '(version 1)(allow default)(deny network*)' "${SPEAK[@]}"
else
	HOME="${WORK}/home" "${SPEAK[@]}"
fi
echo "== The engine set up from the release and spoke."
