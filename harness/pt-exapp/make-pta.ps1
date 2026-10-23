$ErrorActionPreference = "Stop"

$meta = "C:\Program Files\Cisco Packet Tracer 9.0.0\bin\meta.exe"
$xml = Join-Path $PSScriptRoot "pt-ttl-bridge.xml"
$pta = Join-Path $PSScriptRoot "pt-ttl-bridge.pta"
$integrity = Join-Path $PSScriptRoot "out\PacketTracerSmoke.class"
$secret = $env:PT_TTL_AUTH_SECRET

if ([string]::IsNullOrWhiteSpace($secret)) {
    throw "Set PT_TTL_AUTH_SECRET before generating the .pta file."
}

if (-not (Test-Path $integrity)) {
    throw "Build the Java client first so this file exists: $integrity"
}

if (-not (Test-Path $meta)) { throw "Packet Tracer meta.exe was not found: $meta" }
$temporaryXml = Join-Path $PSScriptRoot "pt-ttl-bridge.generated.xml"
$xmlText = Get-Content -Raw $xml
$xmlText = $xmlText.Replace("CHANGE_ME_BEFORE_USE", $secret)
Set-Content -Path $temporaryXml -Value $xmlText -Encoding ascii
try {
    Push-Location $PSScriptRoot
    & $meta (Split-Path $pta -Leaf) (Split-Path $temporaryXml -Leaf) -i "out\PacketTracerSmoke.class"
    $metaExit = $LASTEXITCODE
} finally {
    Pop-Location
    Remove-Item -LiteralPath $temporaryXml -Force -ErrorAction SilentlyContinue
}
if ($metaExit -ne 0) { throw "meta.exe failed with exit code $metaExit" }
Write-Host "Created $pta"
