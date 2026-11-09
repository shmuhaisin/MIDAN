# Runs MIDAN on this Windows machine (PowerShell 5.1 or later) and leaves it running:
#
#   Supabase Cloud (the default; .env NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co): Auth, Data API, Storage and
#   the database are the cloud project's. Only these run here: AI service (8000) -> API (4000) -> web (3100).
#   Nothing local stands in for Supabase, and the API doesn't start without DATABASE_URL (docs/supabase-cloud.md).
#
#   Local Supabase (only when .env points at http://localhost): PostgreSQL (LOCAL_PG_PORT, 54323) -> local Supabase
#   (LOCAL_SUPABASE_PORT 54321, SMTP 54326, Auth 54329, PostgREST 54328) -> AI -> API -> web.
#
#   powershell -ExecutionPolicy Bypass -File scripts\local-up-windows.ps1
#
# A service that already answers is left as it is. A missing one is started in the background (it keeps running after
# this script ends), with its output in .local\logs. Nothing else is ever stopped: if a port is taken by another program,
# the script says which and stops. Needs .env (node scripts\local-env.mjs) and the one-time setup in
# docs/local-development-windows.md. Ports come from .env (LOCAL_*), as in scripts/local-ports.mjs.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Logs = Join-Path $Root '.local\logs'
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

$EnvFile = Join-Path $Root '.env'
if (-not (Test-Path $EnvFile)) { throw '.env is missing: copy .env.example to .env and fill in the Supabase Cloud values (docs/supabase-cloud.md).' }
# Every setting from .env goes to the services this script starts (the AI service reads only its environment).
# MIGRATION_DATABASE_URL is for scripts/apply-cloud-migrations.mjs only, so no service started here receives it.
foreach ($line in Get-Content $EnvFile -Encoding UTF8) {
  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$' -and $Matches[1] -ne 'MIGRATION_DATABASE_URL') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') }
}
function Port($name, $default) { $v = [Environment]::GetEnvironmentVariable($name, 'Process'); if ($v) { [int]$v } else { $default } }
$PgPort = Port 'LOCAL_PG_PORT' 54323
$SupabasePort = Port 'LOCAL_SUPABASE_PORT' 54321
$SupabaseUrl = [Environment]::GetEnvironmentVariable('NEXT_PUBLIC_SUPABASE_URL', 'Process')
$Cloud = $SupabaseUrl -match '^https://[a-z0-9-]+\.supabase\.co/?$'
$Local = $SupabaseUrl -match '^http://(localhost|127\.0\.0\.1)(:\d+)?/?$'
if (-not $Cloud -and -not $Local) { throw "NEXT_PUBLIC_SUPABASE_URL must be the Supabase Cloud project (https://<ref>.supabase.co) or, for the local stack, http://localhost:<port>. It is '$SupabaseUrl'." }

function Answers($url) {
  try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri $url; return $r.StatusCode -lt 500 } catch { return $false }
}
function Listening($port) {
  $client = New-Object Net.Sockets.TcpClient
  try { $client.Connect('127.0.0.1', $port); return $true } catch { return $false } finally { $client.Dispose() }
}
function Owner($port) {
  $line = netstat -ano -p TCP | Select-String -Pattern ":$port\s+.*LISTENING" | Select-Object -First 1
  if (-not $line) { return '' }
  $procId = ($line.ToString().Trim() -split '\s+')[-1]
  $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue).CommandLine
  return "PID $procId $cmd"
}
function WaitFor($name, $url, $seconds) {
  for ($i = 0; $i -lt $seconds; $i++) { if (Answers $url) { Write-Host "  $name ready: $url"; return } ; Start-Sleep -Seconds 1 }
  throw "$name didn't answer at $url within $seconds s. See $Logs."
}
function Start-Background($name, $file, $arguments, $workDir) {
  $out = Join-Path $Logs "$name.log"; $err = Join-Path $Logs "$name.err.log"
  $p = Start-Process -FilePath $file -ArgumentList $arguments -WorkingDirectory $workDir -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $out -RedirectStandardError $err
  Write-Host "  started $name (PID $($p.Id)); logs: $out"
}
function Ensure($name, $url, $port, $seconds, [scriptblock]$start) {
  if (Answers $url) { Write-Host "  $name already running: $url"; return }
  if (Listening $port) { throw "Port $port, needed by $name, is taken by another program: $(Owner $port). Nothing was stopped; stop it yourself or change the port in .env." }
  & $start
  WaitFor $name $url $seconds
}

if ($Cloud) {
  Write-Host "MIDAN on Supabase Cloud: $SupabaseUrl"
  # The cloud project must answer before anything starts; nothing local is started in its place.
  $key = [Environment]::GetEnvironmentVariable('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'Process')
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri "$SupabaseUrl/auth/v1/health" -Headers @{ apikey = $key } | Out-Null; Write-Host '  Supabase Cloud Auth answers' }
  catch { throw "Supabase Cloud Auth at $SupabaseUrl doesn't answer with this key: $($_.Exception.Message)" }
} else {
Write-Host 'MIDAN with local Supabase'

# 1. PostgreSQL (the cluster in .local\pg). Started through Git Bash, the same script as on Linux and macOS.
if (Listening $PgPort) { Write-Host "  PostgreSQL already running on $PgPort" }
else {
  $bash = @("$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $bash) { throw "PostgreSQL isn't running on $PgPort and Git Bash wasn't found to start it (scripts/local-db.sh start)." }
  & $bash -lc "cd '$($Root -replace '\\','/')' && LOCAL_PG_PORT=$PgPort scripts/local-db.sh start" | Write-Host
  if (-not (Listening $PgPort)) { throw "PostgreSQL didn't start on $PgPort; see .local\pg\server.log." }
}

# 2. Local Supabase: its own preflight checks every port it needs and names the owner of a taken one.
Ensure 'supabase' "http://localhost:$SupabasePort/auth/v1/health" $SupabasePort 40 {
  & node (Join-Path $Root 'scripts\local-supabase.mjs') check
  if ($LASTEXITCODE -ne 0) { throw 'Local Supabase ports are not free (see above). Nothing was stopped.' }
  Start-Background 'supabase' 'node' 'scripts/local-supabase.mjs' $Root
}
}

# 3. AI service: the Python environment in .local\ai-venv when there is one, otherwise uv.
Ensure 'ai' 'http://127.0.0.1:8000/health' 8000 90 {
  $python = Join-Path $Root '.local\ai-venv\Scripts\python.exe'
  if (Test-Path $python) { Start-Background 'ai' $python '-X utf8 -m uvicorn midan_ai.main:app --host 127.0.0.1 --port 8000' (Join-Path $Root 'services\ai') }
  else { Start-Background 'ai' 'uv' 'run --env-file ../../.env uvicorn midan_ai.main:app --host 127.0.0.1 --port 8000' (Join-Path $Root 'services\ai') }
}

# 4. API (compiles, then runs; routes under /v1). It needs the database connection of the same Supabase project.
$ApiStarted = $true
if (-not [Environment]::GetEnvironmentVariable('DATABASE_URL', 'Process')) {
  $ApiStarted = $false
  Write-Warning 'API not started: DATABASE_URL is empty in .env. Add the Supabase project database connection (docs/supabase-cloud.md). Pages that need the API show an error until then.'
} else {
Ensure 'api' 'http://localhost:4000/v1/health' 4000 180 {
  Start-Background 'api' 'cmd.exe' '/d /c npm run start:dev -w @midan/api' $Root
}
}

# 5. Web (Next.js dev server; the first page compiles on first visit).
Ensure 'web' 'http://localhost:3100/en' 3100 180 {
  Start-Background 'web' 'cmd.exe' '/d /c npm run dev:web' $Root
}

Write-Host ''
if ($Cloud) {
  Write-Host "MIDAN is running: http://localhost:3100 on Supabase Cloud ($SupabaseUrl)$(if (-not $ApiStarted) { '; API not started (DATABASE_URL missing)' } else { '; API http://localhost:4000/v1' })"
  Write-Host 'Emails (verification, recovery) are sent by the Supabase project. Logs: .local\logs'
} else {
  Write-Host "MIDAN is running: http://localhost:3100  (API http://localhost:4000/v1, emails http://localhost:$SupabasePort/__mail)"
  Write-Host 'Test accounts are in .env.test.local. Logs: .local\logs'
}
