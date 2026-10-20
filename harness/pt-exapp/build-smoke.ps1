$ErrorActionPreference = "Stop"

$jdk = "C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot"
$ptJar = "C:\Program Files\Cisco Packet Tracer 9.0.0\help\default\ipc\pt-cep-java-framework-9.0.0.0.jar"
$srcFiles = Get-ChildItem (Join-Path $PSScriptRoot "src") -Recurse -Filter "*.java" | Select-Object -ExpandProperty FullName
$out = Join-Path $PSScriptRoot "out"

New-Item -ItemType Directory -Force -Path $out | Out-Null
& (Join-Path $jdk "bin\javac.exe") -cp $ptJar -d $out $srcFiles
if ($LASTEXITCODE -ne 0) { throw "javac failed" }

& (Join-Path $jdk "bin\java.exe") -cp "$out;$ptJar" PacketTracerSmoke @args
exit $LASTEXITCODE
