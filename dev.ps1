# Zoiko Sema — local dev launcher.
#
# Starts the API on port 8002 (the ONLY port the Vite proxy, docker mapping,
# and client env expect — running it on uvicorn's default 8000 is what causes
# the "HTTP 502" on login) and the Vite dev server together.
#
# Usage:  ./dev.ps1        (from the repo root, in PowerShell)
# Stop:   Ctrl+C           (stops both)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# --- API (FastAPI/uvicorn) on 8002, using the server venv --------------------
$py = Join-Path $root 'server\venv\Scripts\python.exe'
if (-not (Test-Path $py)) { $py = 'python' }  # fall back to PATH python

Write-Host 'Starting API on http://127.0.0.1:8002 ...' -ForegroundColor Cyan
$api = Start-Process -PassThru -NoNewWindow -WorkingDirectory (Join-Path $root 'server') `
  -FilePath $py -ArgumentList '-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8002','--reload'

# --- Client (Vite) on 5173, proxying /api -> 127.0.0.1:8002 ------------------
try {
  Write-Host 'Starting client on http://localhost:5173 ...' -ForegroundColor Cyan
  Push-Location (Join-Path $root 'client')
  npm run dev
}
finally {
  Pop-Location
  if ($api -and -not $api.HasExited) {
    Write-Host 'Stopping API ...' -ForegroundColor Cyan
    Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
  }
}
