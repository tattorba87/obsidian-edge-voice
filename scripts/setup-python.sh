#!/bin/bash -e
set -o pipefail

# Creates the Python environment the plugin's TTS sidecar runs in, at
# ~/.edge-voice/venv (the plugin's default interpreter setting).
#
# Usage:
#   scripts/setup-python.sh                  Install moonshine-voice from PyPI.
#   scripts/setup-python.sh <moonshine-repo> Build a wheel from a local checkout
#                                            of moonshine and install that.
#
# Use a local checkout on Intel Macs: the PyPI macOS wheel only carries an
# arm64 libmoonshine.dylib, so it cannot load on x86_64.

VENV_DIR="${EDGE_VOICE_VENV:-$HOME/.edge-voice/venv}"
REPO="$1"

if [ -n "${REPO}" ]; then
    REPO="$(cd "${REPO}" && pwd)"
    WHEEL=$(ls "${REPO}"/language-bindings/python/dist/moonshine_voice-*.whl 2>/dev/null | head -n 1)
    if [ -z "${WHEEL}" ] || [ "$2" == "--rebuild" ]; then
        echo "[setup-python] building the moonshine wheel in ${REPO}..."
        "${REPO}/scripts/build-pip.sh"
        WHEEL=$(ls "${REPO}"/language-bindings/python/dist/moonshine_voice-*.whl | head -n 1)
    fi
    PACKAGE="${WHEEL}"
else
    PACKAGE="moonshine-voice"
fi

echo "[setup-python] creating ${VENV_DIR}..."
mkdir -p "$(dirname "${VENV_DIR}")"
uv venv --allow-existing "${VENV_DIR}"
uv pip install --python "${VENV_DIR}/bin/python" --reinstall "${PACKAGE}"

echo "[setup-python] checking the native library loads..."
"${VENV_DIR}/bin/python" -I -c "import moonshine_voice; print('moonshine_voice', moonshine_voice.__file__)"
echo "[setup-python] done. The plugin's default interpreter is ${VENV_DIR}/bin/python"
