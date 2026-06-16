$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Url = "http://127.0.0.1:5174/"
$ApiUrl = "http://127.0.0.1:3334/api/health"
$LogDir = Join-Path $Root ".newtbuilder_logs"

function Get-NpmPath {
  $command = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $command) {
    $command = Get-Command npm -ErrorAction SilentlyContinue
  }
  if (-not $command) {
    throw "npm was not found. Install Node.js LTS, then launch NewtBuilder again."
  }
  return $command.Source
}

function Test-LocalPort {
  param([int]$Port)

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $result = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $result.AsyncWaitHandle.WaitOne(250)) {
      return $false
    }
    $client.EndConnect($result)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Wait-ForUrl {
  param(
    [string]$TargetUrl,
    [int]$Seconds = 30
  )

  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-WebRequest -Uri $TargetUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
      return $true
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  return $false
}

try {
  Set-Location $Root
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

  $npm = Get-NpmPath

  if (-not (Test-Path (Join-Path $Root "node_modules"))) {
    Write-Host "Installing NewtBuilder dependencies. This only needs to happen once..."
    & $npm install
    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed. See the console output above."
    }
  }

  if (-not (Test-LocalPort 3334)) {
    Write-Host "Starting NewtBuilder API..."
    Start-Process -FilePath $npm `
      -ArgumentList @("run", "server") `
      -WorkingDirectory $Root `
      -RedirectStandardOutput (Join-Path $LogDir "server.log") `
      -RedirectStandardError (Join-Path $LogDir "server.err.log") `
      -WindowStyle Hidden
  }

  if (-not (Test-LocalPort 5174)) {
    Write-Host "Starting NewtBuilder app..."
    Start-Process -FilePath $npm `
      -ArgumentList @("run", "client") `
      -WorkingDirectory $Root `
      -RedirectStandardOutput (Join-Path $LogDir "client.log") `
      -RedirectStandardError (Join-Path $LogDir "client.err.log") `
      -WindowStyle Hidden
  }

  Write-Host "Waiting for NewtBuilder..."
  $appReady = Wait-ForUrl -TargetUrl $Url -Seconds 45
  $apiReady = Wait-ForUrl -TargetUrl $ApiUrl -Seconds 10

  if (-not $appReady) {
    throw "The app did not become ready at $Url. Check $LogDir for logs."
  }

  if (-not $apiReady) {
    Write-Warning "The app opened, but the API health check did not respond yet. If data does not load, check $LogDir."
  }

  Start-Process $Url
} catch {
  Write-Host ""
  Write-Host "NewtBuilder could not start:" -ForegroundColor Red
  Write-Host $_.Exception.Message
  Write-Host ""
  Write-Host "Logs are in: $LogDir"
  Write-Host ""
  Read-Host "Press Enter to close"
  exit 1
}
