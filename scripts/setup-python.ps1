# Creates the Python environment the plugin's TTS sidecar runs in, at
# %USERPROFILE%\.edge-voice\venv (the plugin's default interpreter
# setting on Windows). Installs moonshine-voice from PyPI. Needs uv:
# https://docs.astral.sh/uv/
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\setup-python.ps1

$ErrorActionPreference = "Stop"

$VenvDir = if ($env:EDGE_VOICE_VENV) { $env:EDGE_VOICE_VENV } else { Join-Path $HOME ".edge-voice\venv" }
$Python = Join-Path $VenvDir "Scripts\python.exe"

Write-Host "[setup-python] creating $VenvDir..."
New-Item -ItemType Directory -Force -Path (Split-Path $VenvDir) | Out-Null
uv venv --allow-existing $VenvDir
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
uv pip install --python $Python --reinstall moonshine-voice
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[setup-python] checking the native library loads..."
& $Python -I -c "import moonshine_voice; print('moonshine_voice', moonshine_voice.__file__)"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "[setup-python] done. The plugin's default interpreter is $Python"
