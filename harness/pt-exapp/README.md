# Packet Tracer external IPC smoke client

This is the next automation layer after the successful Script Module proof. It
uses Packet Tracer's Java IPC framework to connect to the running application,
select the first device, and execute one CLI command. The external app must be
registered in Packet Tracer because IPC authentication uses the app ID and key.

The generator injects the secret into a temporary copy, so the XML template
does not need to be edited manually.

Generate the Packet Tracer app metadata with:

```powershell
Set-Location C:\Users\antho\Documents\Time_To_Live
& .\harness\pt-exapp\make-pta.ps1
```

Then add `harness\pt-exapp\pt-ttl-bridge.pta` through
`Extensions → IPC → Configure Apps`.

With Packet Tracer open and external IPC enabled, run from PowerShell:

```powershell
Set-Location C:\Users\antho\Documents\Time_To_Live
& .\harness\pt-exapp\build-smoke.ps1
```

Set the matching secret in the same PowerShell window first:

```powershell
$env:PT_TTL_AUTH_SECRET = "your-local-secret"
```

To run the live queue bridge, keep `tools\pt-bridge.mjs` running on port
`39092`, then start a second PowerShell window with the same secret:

```powershell
& .\harness\pt-exapp\build-bridge.ps1 127.0.0.1 39000 39092
```

Optional arguments are host, port, and command:

```powershell
& .\harness\pt-exapp\build-smoke.ps1 127.0.0.1 39000 "show version"
```
