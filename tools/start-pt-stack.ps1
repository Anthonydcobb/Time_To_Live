$ErrorActionPreference = "Stop"

$project = Split-Path $PSScriptRoot -Parent
$bridgePort = 39094
$ptPort = 39000
$secret = if ($env:PT_TTL_AUTH_SECRET) { $env:PT_TTL_AUTH_SECRET } else { "CHANGE_ME_BEFORE_USE" }

function Test-Bridge($port) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
        return $health.ok -eq $true
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

if (-not (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)) {
    $viteCommand = "Set-Location '$project'; npm run dev"
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $viteCommand -WorkingDirectory $project | Out-Null
}

$javaCommand = "`$env:PT_TTL_AUTH_SECRET='$secret'; & '$project\harness\pt-exapp\build-bridge.ps1' 127.0.0.1 $ptPort $bridgePort"
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $javaCommand -WorkingDirectory $project | Out-Null

Start-Process "http://localhost:5173/pt-dashboard.html" | Out-Null
Write-Host "Packet Tracer stack starting. Dashboard: http://localhost:5173/pt-dashboard.html"
