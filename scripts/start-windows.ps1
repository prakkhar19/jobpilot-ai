# One-click start for Windows: creates .env with random secrets (first run only), builds and starts
# JobPilot in Docker, waits until it is ready and opens it in the browser.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Fail($msg) { Write-Host ""; Write-Host "ERROR: $msg" -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }

Write-Host "== JobPilot AI ==" -ForegroundColor Green

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail "Docker is not installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and run this again."
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Starting Docker Desktop..."
    $dd = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path $dd) { Start-Process $dd }
    $tries = 0
    do { Start-Sleep -Seconds 5; $tries++; docker info *> $null } while ($LASTEXITCODE -ne 0 -and $tries -lt 36)
    if ($LASTEXITCODE -ne 0) { Fail "Docker Desktop is not running. Open it, wait until it says 'Engine running', then run this again." }
}

if (-not (Test-Path '.env')) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $pg = ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', '')
    $content = (Get-Content '.env.example' -Raw) -replace '(?m)^POSTGRES_PASSWORD=.*$', "POSTGRES_PASSWORD=$pg"
    [System.IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), $content.Replace("`r`n", "`n"))
    Write-Host "Created .env with a random database password."
}

Write-Host "Building and starting (the first time takes 5-15 minutes)..."
docker compose up --build -d
if ($LASTEXITCODE -ne 0) { Fail "docker compose failed. See the messages above." }

$port = 8080
$line = Select-String -Path '.env' -Pattern '^JOBPILOT_PORT=(\d+)' | Select-Object -First 1
if ($line) { $port = $line.Matches[0].Groups[1].Value }
$url = "http://localhost:$port"

Write-Host "Waiting for JobPilot to be ready..."
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    try { if ((Invoke-WebRequest "$url/healthz" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $ready = $true; break } } catch {}
    Start-Sleep -Seconds 5
}
if (-not $ready) { Fail "JobPilot did not become ready. Run 'docker compose ps' and 'docker compose logs backend' to see why." }

Write-Host ""
Write-Host "JobPilot is running at $url" -ForegroundColor Green
Write-Host "Chrome extension: chrome://extensions -> Developer mode -> Load unpacked -> pick the 'extension' folder."
Write-Host "Stop it with stop.bat. Your data is kept."
Start-Process $url
Read-Host "Press Enter to close this window (JobPilot keeps running)"
