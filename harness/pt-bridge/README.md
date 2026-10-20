# Packet Tracer bridge spike

The local bridge is intentionally loopback-only. Start it with:

```text
node tools/pt-bridge.mjs
```

It exposes:

- `GET /health`
- `POST /v1/command` with `{ "device": "Switch0", "line": "show spanning-tree", "mode": "enable" }`
- `GET /v1/commands/next` for the Packet Tracer Script Module poller
- `POST /v1/result` with `{ "id": "...", "statusCode": 0, "output": "..." }`
- `GET /v1/result/:id`

The working-file draft for that custom web view is `harness/pt-script-module/Bridge.htm`; the Script Module handler is `harness/pt-script-module/Main.js`.
