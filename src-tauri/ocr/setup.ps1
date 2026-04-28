$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $root '.venv'

if (-not (Test-Path $venv)) {
  python -m venv $venv
}

$python = Join-Path $venv 'Scripts\python.exe'

& $python -m pip install --upgrade pip
& $python -m pip install -r (Join-Path $root 'requirements.txt')

Write-Host 'OCR sidecar environment is ready:' $python
