# DHCP research: Packet Tracer versus sim

Captured 2026-10-22 from the live Packet Tracer lab through the bridge and the
headless simulator. The raw captures are [Packet Tracer](../harness/artifacts/dhcp-research-pt.json)
and [sim](../harness/artifacts/dhcp-research-sim.json). The existing
`sim-dhcp-scenario.json` was used as the simulator harness model.

## Scope and evidence

Both runs exercised the same DHCP command families: pool configuration with
network/default-router/DNS/lease/exclusions, PC renew/release/all, binding/pool/
conflict/statistics/running-config inspection, binding clears, relay, pool
exhaustion, excluded addresses, a wrong gateway, no-server APIPA, snooping
trust, binding output, and `?`/completion under `ip dhcp`.

The simulator capture contains 49 observations. The live PT capture contains 83
observations, including restore and ping checks. PT's bridge sometimes returned
prior PC terminal history around a new PC command; that text is preserved in the
raw artifact. The final independent checks still showed the restored static PC
addresses and gateway replies.

## Observed behavior

- The sim leased `192.168.30.21` after excluding `.1-.20`; its binding output was
  the IOS-style `Bindings from all pools not associated with VRF:` table. PT
  leased from the live VLAN 10 pool and showed `DHCP Servers: 192.168.10.1` in
  the PC view.
- Both sides rejected `show ip dhcp server statistics`; PT returned
  `ERROR_INVALID`, while sim returned the invalid-input marker.
- Sim accepted `clear ip dhcp binding *` and a specific address with no output.
  PT returned `ERROR_INVALID` for both forms in this Packet Tracer build.
- The sim relay gave the far PC `10.10.0.2` with gateway `10.10.0.1` and showed
  the DHCP server in `ipconfig /all`. The PT topology has both routers' VLAN 20
  subinterfaces on the same switched segment, so its relay result cannot prove
  a routed helper path; it is recorded as a topology limitation.
- The sim exhausted a one-address effective pool: PC1 received `10.50.0.254`
  and PC2 timed out. The PT live VLAN had existing leases and the attempted
  exclusion experiment did not produce a comparable exhausted state; its
  binding table still showed `192.168.10.11` and `.12`.
- The sim propagated an intentionally wrong default router (`10.60.0.254`) to
  the PC. PT likewise showed the configured DHCP gateway in the captured PC
  output, but the bridge's mixed terminal history makes that particular raw
  transcript less clean.
- The sim no-server case ended at APIPA `169.254.1.29/16`. PT's PC command
  output did not provide a clean equivalent APIPA capture in this run.
- Sim snooping learned `0060.a80a.001f 10.70.0.2 ... dhcp-snooping ... Fa0/1`
  with Gi0/1 trusted. PT showed snooping enabled for VLAN 10, Fa0/1 trusted,
  and zero bindings; its `show ip dhcp snooping statistics` was rejected.
- Sim `ip dhcp ?`/completion is available in configuration mode. PT's global
  `ip dhcp ?` listed `excluded-address`, `pool`, and `relay`; a bare `ip dhcp`
  was captured as a rejected/incomplete command.

## Discrepancies

| Area | Packet Tracer observation | Sim observation | Classification |
|---|---|---|---|
| PC command surface | `ipconfig /renew`, `/release`, and `/all` are Packet Tracer PC output; `/dhcp` was captured as `Invalid Command` in some live terminal-history segments | Windows-like `ipconfig /dhcp` enables DHCP, then `/renew`, `/release`, and `/all` expose the sim lease | `text-mismatch` and `behavior-mismatch` |
| Lease allocation | Live VLAN 10 pool allocated `.11`/`.12` in the capture and showed PT-specific lease columns | Exclusions are honored deterministically; first free address after `.1-.20` was `.21` | `text-mismatch` |
| Binding output | PT uses a compact header and `Client-ID/Hardware address` formatting; bridge output is sometimes mixed with prior PC history | Sim emits the stable IOS-style binding table used by job 2 | `text-mismatch` |
| `clear ip dhcp binding` | `clear ip dhcp binding *` and a single address returned `ERROR_INVALID` | Both forms were accepted and cleared in-memory bindings | `behavior-mismatch` |
| Server statistics | `show ip dhcp server statistics` returned `ERROR_INVALID` | Same feature is rejected with the simulator invalid-input marker | `text-mismatch` |
| Relay | Existing lab places Router0/Router1 VLAN 20 interfaces on one switched segment; helper experiment cannot isolate a routed far LAN | Dedicated routed relay topology leased `10.10.0.2` through `10.0.0.0/24` | `needs-real-gear` |
| Pool exhaustion | Existing live leases and shared VLAN state prevented a clean tiny-pool exhaustion proof | Second client timed out after the one-address effective pool was consumed | `behavior-mismatch` and `needs-real-gear` |
| Wrong gateway | PT PC output includes Packet Tracer's IPv4/default-gateway presentation | Sim copies the pool's wrong `default-router` into `ipconfig /all` | `text-mismatch` |
| No server / APIPA | Clean APIPA text was not obtained from the live PC bridge capture | Sim produced `169.254.1.29`, mask `255.255.0.0`, gateway `0.0.0.0` | `missing-feature` |
| Snooping status | PT supports enable/VLAN/trust and shows Fa0/1 trusted; statistics command was rejected; binding count was zero | Sim supports status, trusted Gi0/1, statistics, and learned binding output | `behavior-mismatch` and `missing-feature` |
| `ip dhcp ?` and Tab | PT help lists `excluded-address`, `pool`, and `relay`; bare command is rejected | Sim help/completion is configuration-mode aware and exposes the simulator command tree | `text-mismatch` |
| Bridge capture fidelity | PT adapter can return stale terminal-history text around PC commands, although status and later gateway checks were successful | Headless JSON-lines capture is isolated per request and preserves one command's raw lines | `needs-real-gear` |

## What job 2 relies on

The laundromat scenario (`src/sim/scenarios/laundromat`) depends on a router
interface at `192.168.20.1/24`, an excluded range `192.168.20.1-.20`, and pool
`LAUNDRY` with network `192.168.20.0/24` and default router `192.168.20.1`.
Kiosk and office PCs use DHCP renew and must receive `.21` and the next free
address; the printer remains statically configured at `192.168.20.5`.

The later work-order task checks that R1's command history contains
`show ip dhcp binding`, so command acceptance and history matter even after the
lease state is correct. The story then inserts a ghost lease with network-style
IP text, MAC `0166.6666.6666.04`, and the old lease timestamp. The simulator's
binding header, spacing, automatic-binding row, and command history therefore
matter more to job 2 than PT's differing PC presentation or optional statistics
commands.

## Restoration

The temporary DHCP pools, exclusions, helper address, and snooping VLAN were
removed. The final live checks captured Router0/Router1 subinterfaces up/up,
DHCP snooping disabled with VLANs `none`, and gateway replies including
`Reply from 192.168.10.1: bytes=32 time<1ms TTL=255` and
`Reply from 192.168.20.1: bytes=32 time<1ms TTL=255`.

No simulator or game behavior was changed; this report and the raw research
artifacts are the phase input for any later DHCP fidelity work.
