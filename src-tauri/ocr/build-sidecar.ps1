$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $root '.venv'

if (-not (Test-Path $venv)) {
  python -m venv $venv
}

$python = Join-Path $venv 'Scripts\python.exe'
$models = Join-Path $root 'models'
$dist = Join-Path $root 'dist'
$build = Join-Path $root 'build'

& $python -m pip install --upgrade pip
& $python -m pip install -r (Join-Path $root 'requirements.txt')
& $python -m pip install pyinstaller

New-Item -ItemType Directory -Force -Path $models | Out-Null
& $python (Join-Path $root 'sidecar.py') --warmup chinese
& $python (Join-Path $root 'sidecar.py') --warmup english

if (Test-Path $dist) {
  Remove-Item -Recurse -Force $dist
}
if (Test-Path $build) {
  Remove-Item -Recurse -Force $build
}

& $python -m PyInstaller `
  --noconfirm `
  --clean `
  --noconsole `
  --onedir `
  --name rapidocr-sidecar `
  --distpath $dist `
  --workpath $build `
  --specpath $build `
  --collect-submodules rapidocr `
  --collect-submodules onnxruntime `
  --collect-submodules cv2 `
  --collect-submodules jieba `
  --collect-data rapidocr `
  --collect-data jieba `
  --add-data "$models;models" `
  --add-data "$(Join-Path $root 'corrections.json');." `
  (Join-Path $root 'sidecar.py')

Write-Host 'Bundled OCR sidecar created at:' (Join-Path $dist 'rapidocr-sidecar\rapidocr-sidecar.exe')
