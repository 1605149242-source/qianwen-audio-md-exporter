$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$Port = 4317
$Url = "http://127.0.0.1:$Port/"
$LogsDir = Join-Path $Root "logs"
$OutLog = Join-Path $LogsDir "web-ui.out.log"
$ErrLog = Join-Path $LogsDir "web-ui.err.log"
$StatusLog = Join-Path $LogsDir "web-ui-launcher.log"

function Write-Status($Message) {
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $StatusLog -Value "[$stamp] $Message" -Encoding UTF8
}

function Test-WebReady {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
    return ($response.StatusCode -eq 200)
  } catch {
    return $false
  }
}

New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
Write-Status "Launcher started."

if (-not (Test-Path $Root)) {
  Write-Status "Project folder not found: $Root"
  throw "Project folder not found: $Root"
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Status "Node.js was not found in PATH."
  throw "Node.js was not found in PATH. Please install Node.js or add it to PATH."
}

if (Test-WebReady) {
  Write-Status "Web UI is already running. Opening $Url"
  Start-Process $Url
  exit 0
}

$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
  $owners = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($owner in $owners) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
    Write-Status "Port $Port is occupied by pid=$owner command=$($proc.CommandLine)"
  }
  throw "Port $Port is occupied, but $Url is not responding. See $StatusLog"
}

Write-Status "Starting Web UI on port $Port."
Start-Process `
  -FilePath "node" `
  -ArgumentList @("src\web.js", "--port", "$Port") `
  -WorkingDirectory $Root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $OutLog `
  -RedirectStandardError $ErrLog

for ($i = 0; $i -lt 30; $i += 1) {
  Start-Sleep -Milliseconds 500
  if (Test-WebReady) {
    Write-Status "Web UI is ready. Opening $Url"
    Start-Process $Url
    exit 0
  }
}

Write-Status "Web UI did not become ready in time. stdout=$OutLog stderr=$ErrLog"
throw "Web UI did not become ready in time. See $OutLog and $ErrLog"
