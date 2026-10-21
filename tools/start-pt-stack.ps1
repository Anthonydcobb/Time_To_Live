$ErrorActionPreference = "Stop"

$project = Split-Path $PSScriptRoot -Parent
$bridgePort = 39094
$ptPort = 39000
$dashboardPort = if ($env:PT_TTL_DASHBOARD_PORT) { [int]$env:PT_TTL_DASHBOARD_PORT } else { 5173 }
$secret = if ($env:PT_TTL_AUTH_SECRET) { $env:PT_TTL_AUTH_SECRET } else { "CHANGE_ME_BEFORE_USE" }

function Test-Bridge($port) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
        return $health.ok -eq $true
    } catch { return $false }
}

function Test-Dashboard {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$dashboardPort/pt-dashboard.html" -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch { return $false }
}

if (-not (Test-Bridge $bridgePort)) {
    $nodeCommand = "Set-Location '$project'; `$env:PT_BRIDGE_PORT='$bridgePort'; node tools\pt-bridge.mjs"
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $nodeCommand -WorkingDirectory $project | Out-Null
    $ready = $false
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 250
        if (Test-Bridge $bridgePort) { $ready = $true; break }
    }
    if (-not $ready) { throw "Node bridge did not become ready on port $bridgePort" }
} else {
    Write-Host "Node bridge already running on port $bridgePort"
}

if (-not (Get-NetTCPConnection -LocalPort $dashboardPort -State Listen -ErrorAction SilentlyContinue)) {
    $viteCommand = "Set-Location '$project'; npm run dev -- --host 127.0.0.1 --port $dashboardPort --strictPort"
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $viteCommand -WorkingDirectory $project | Out-Null
}

$dashboardReady = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 250
    if (Test-Dashboard) { $dashboardReady = $true; break }
}
if (-not $dashboardReady) { throw "Vite dashboard did not become ready at http://127.0.0.1:$dashboardPort/pt-dashboard.html; set PT_TTL_DASHBOARD_PORT to an available port if needed" }

$javaCommand = "`$env:PT_TTL_AUTH_SECRET='$secret'; & '$project\harness\pt-exapp\build-bridge.ps1' 127.0.0.1 $ptPort $bridgePort"
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $javaCommand -WorkingDirectory $project | Out-Null

$pollerReady = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$bridgePort/health" -TimeoutSec 2
        if ($health.pollerConnected -eq $true) { $pollerReady = $true; break }
    } catch { }
}
if ($pollerReady) {
    Write-Host "Packet Tracer ExApp connected to the bridge."
} else {
    Write-Warning "Bridge is running, but the Packet Tracer ExApp has not checked in. Open Packet Tracer, enable external IPC, and verify the Java bridge window."
}

Start-Process "http://localhost:$dashboardPort/pt-dashboard.html" | Out-Null
Write-Host "Packet Tracer stack starting. Dashboard: http://localhost:$dashboardPort/pt-dashboard.html"
