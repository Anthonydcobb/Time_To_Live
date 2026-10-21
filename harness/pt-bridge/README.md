# Packet Tracer bridge spike

The local bridge is intentionally loopback-only. Start it with:

```text
node tools/pt-bridge.mjs
```

The default loopback port is `39094`; override it with `PT_BRIDGE_PORT` when
another local bridge is already using that port. Client tools can use
`PT_BRIDGE_URL` for the same override.

It exposes:

- `GET /health`, which reports bridge queue counts plus `lastPollAt` and
  `pollerConnected`; the latter is true only when the Java Packet Tracer
  ExApp has polled the command queue within the last three seconds.
- `POST /v1/command` with `{ "device": "Switch0", "line": "show spanning-tree", "mode": "enable" }`
- `GET /v1/commands/next` for the Packet Tracer Script Module poller
- `POST /v1/result` with `{ "id": "...", "statusCode": 0, "output": "..." }`
- `GET /v1/result/:id`

If `/health` returns `ok: true` but `pollerConnected: false`, the Node bridge
is running but the Java ExApp is not connected to Packet Tracer. Restart the
ExApp bridge after updating the bridge code so it begins polling the new
process.

The working-file draft for that custom web view is `harness/pt-script-module/Bridge.htm`; the Script Module handler is `harness/pt-script-module/Main.js`.
