#!/bin/bash -e
set -o pipefail

# Writes locks/<platform>.txt: every package the speech engine installs on that
# platform, its dependencies included, at exact versions with their hashes.
# Setup installs them with --require-hashes, so a changed or substituted
# package fails to install instead of running. Run again after changing the
# engine's version, the Mac wheels or the faster engine's packages in
# engine/pins.json, and commit the result.
#
# Needs uv and gh (the Mac wheels come from this repository's release).
#
#   scripts/lock-engine.sh
#   scripts/lock-engine.sh --upgrade-package filelock==4.2.1
#
# Existing output pins are preserved unless explicitly upgraded. Additional uv
# compile arguments apply to every platform; a package-specific cooldown
# exception needs maintainer approval, never a blanket newer cutoff.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCKS="${ROOT}/locks"
PYTHON=3.12
# Only releases at least two weeks old: a compromised or broken release is
# usually caught and pulled within days, so the locks never pick up a new one.
COOLDOWN="$(date -u -v-14d +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -d '14 days ago' +%Y-%m-%dT00:00:00Z)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
COMPILE_ARGS=("$@")

# What the engine installs, from engine/pins.json.
eval "$(python3 -I - "${ROOT}/engine/pins.json" <<'PINS'
import json, shlex, sys
pins = json.load(open(sys.argv[1]))
values = {
    "engine": pins["moonshine"]["package"],
    "engine_tag": pins["moonshine"]["release"],
    "mlx_packages": "\n".join(pins["mlx"]["packages"]),
    "model_url": pins["mlx"]["spacyModel"]["url"],
    "model_sha256": pins["mlx"]["spacyModel"]["sha256"],
    "wheel_sums": "\n".join(f"{w['sha256']}  {w['asset']}" for w in pins["moonshine"]["macWheels"].values()),
}
for name, value in values.items():
    print(f"{name}={shlex.quote(value)}")
PINS
)"
version=$(echo "${engine}" | grep -o '[0-9][0-9.]*' | head -1)

# The Mac wheels (built here, not on PyPI) and spaCy's English model (not on
# PyPI either), for uv to find and hash. Each is checked against the checksum
# reviewed into pins.json first, so a changed download can't become a new
# trusted hash in the locks.
mkdir -p "${WORK}/wheels"
gh release download "${engine_tag}" -R tattorba87/obsidian-edge-voice -p '*.whl' -D "${WORK}/wheels"
curl -sSLf -o "${WORK}/wheels/${model_url##*/}" "${model_url}"
printf '%s\n%s  %s\n' "${wheel_sums}" "${model_sha256}" "${model_url##*/}" | (cd "${WORK}/wheels" && shasum -a 256 -c -)

compile() {
	local name="$1" platform="$2" macos="$3"
	shift 3
	echo "[lock-engine] ${name} (${platform})"
	MACOSX_DEPLOYMENT_TARGET="${macos}" uv pip compile - --quiet --generate-hashes --no-header \
		--python-version "${PYTHON}" --python-platform "${platform}" --exclude-newer "${COOLDOWN}" \
		--find-links "${WORK}/wheels" "$@" "${COMPILE_ARGS[@]}" -o "${LOCKS}/${name}.txt"
}

mkdir -p "${LOCKS}"
# Macs get the wheels built here (macOS 13.4 and later); elsewhere PyPI's.
echo "moonshine-voice==${version}" | compile darwin-arm64 aarch64-apple-darwin 13.4
echo "moonshine-voice==${version}" | compile darwin-x64 x86_64-apple-darwin 13.4
echo "moonshine-voice==${version}" | compile linux-x64 x86_64-manylinux_2_34 ""
echo "moonshine-voice==${version}" | compile linux-arm64 aarch64-manylinux_2_34 ""
# Windows on ARM runs the x64 Python under emulation, so it uses this one too.
echo "moonshine-voice==${version}" | compile win32-x64 x86_64-pc-windows-msvc ""
# The faster engine on Apple silicon (MLX needs macOS 14), installed on top of
# darwin-arm64, so constrained to the same versions of what they share.
model_name="${model_url##*/}"
model_version=$(echo "${model_name}" | cut -d- -f2)
{
	echo "${mlx_packages}"
	echo "en-core-web-sm==${model_version}"
} | compile darwin-arm64-mlx aarch64-apple-darwin 14.0 --constraint "${LOCKS}/darwin-arm64.txt"

echo "[lock-engine] done: ${LOCKS}"
