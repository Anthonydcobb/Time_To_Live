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

For the normal live workflow, let the launcher choose a free current bridge
port and start the dashboard plus Java bridge windows:

```powershell
Set-Location C:\Users\antho\Documents\Time_To_Live
$env:PT_TTL_AUTH_SECRET = "your-local-secret"
& .\tools\start-pt-stack.ps1
```

Use the exact bridge port and dashboard URL printed by that command. If port
39094 is occupied by an older bridge, the launcher selects a replacement such
as 39095. Do not paste the `PS C:\...>` prompt text into PowerShell.

For the manual live queue workflow, keep `tools\pt-bridge.mjs` running on the
selected bridge port, then start a second PowerShell window with the same
secret:

```powershell
& .\harness\pt-exapp\build-bridge.ps1 127.0.0.1 39000 39095
```

The dashboard's bridge status is separate from the ExApp status. A bridge can
answer `/health` while `pollerConnected` is false; that means the Node queue
is alive but the Java bridge has not checked in with Packet Tracer.

The full launcher uses port 5173 by default and binds it strictly. Set
`$env:PT_TTL_DASHBOARD_PORT` before running `tools\start-pt-stack.ps1` when
another process already owns that port; the printed dashboard URL will use the
selected port.

Run `npm run pt:status` to discover the current bridge automatically. A
healthy HTTP bridge with `poller: "not-connected"` still needs the Packet
Tracer ExApp to poll it.

Optional arguments are host, port, and command:

```powershell
& .\harness\pt-exapp\build-smoke.ps1 127.0.0.1 39000 "show version"
```
