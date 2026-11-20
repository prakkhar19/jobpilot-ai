# Restore data-sync\latest (made on another machine with scripts/backup.sh) into this Windows install.
# Replaces this machine's JobPilot database with the backup, so you log in with the same account.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
function Fail($msg) { Write-Host ""; Write-Host "ERROR: $msg" -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }

$src = 'data-sync\latest'
foreach ($f in 'db.dump', 'appdata.tar.gz') { if (-not (Test-Path "$src\$f")) { Fail "$src\$f not found. Pull the latest code first (git pull)." } }

docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail "Docker Desktop is not running. Open it and run this again." }

$answer = Read-Host "This REPLACES the JobPilot data on this computer with the backup. Type RESTORE to continue"
if ($answer -ne 'RESTORE') { Write-Host "Aborted."; exit 1 }

# Use the same app secret as the source machine so saved AI keys can still be decrypted.
if (-not (Test-Path '.env')) {
    $b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    $pg = ([Convert]::ToBase64String($b) -replace '[^A-Za-z0-9]', '')
    $c = (Get-Content '.env.example' -Raw) -replace '(?m)^POSTGRES_PASSWORD=.*$', "POSTGRES_PASSWORD=$pg"
    [System.IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), $c.Replace("`r`n", "`n"))
}
if (Test-Path "$src\app_secret_key.txt") {
    $key = (Get-Content "$src\app_secret_key.txt" -Raw).Trim()
    $c = (Get-Content '.env' -Raw) -replace '(?m)^APP_SECRET_KEY=.*$', "APP_SECRET_KEY=$key"
    [System.IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), $c.Replace("`r`n", "`n"))
}

Write-Host "==> Building (first time takes 5-15 minutes)"
docker compose build
if ($LASTEXITCODE -ne 0) { Fail "Build failed. See the messages above." }

Write-Host "==> Stopping application services"
docker compose stop frontend worker scheduler backend 2>$null

Write-Host "==> Starting database"
docker compose up -d postgres redis
if ($LASTEXITCODE -ne 0) { Fail "Could not start the database." }
do { Start-Sleep -Seconds 2; docker compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' *> $null } while ($LASTEXITCODE -ne 0)

Write-Host "==> Restoring database"
docker compose cp "$src\db.dump" postgres:/tmp/db.dump
if ($LASTEXITCODE -ne 0) { Fail "Could not copy the database backup into the container." }
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner /tmp/db.dump; rm -f /tmp/db.dump'

Write-Host "==> Restoring files"
$abs = (Resolve-Path $src).Path
docker compose run --rm --no-deps -T -v "${abs}:/restore:ro" --entrypoint sh backend -c 'tar -C /data -xzf /restore/appdata.tar.gz'
if ($LASTEXITCODE -ne 0) { Fail "Could not restore files." }

Write-Host "==> Starting JobPilot"
docker compose up -d
Write-Host ""
Write-Host "Restore complete. Opening http://localhost:8080 - log in with your usual email and password." -ForegroundColor Green
Start-Process 'http://localhost:8080'
Read-Host "Press Enter to close"
