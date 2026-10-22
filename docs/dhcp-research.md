# DHCP research: Packet Tracer, sim, and real IOS 15

Captured 2026-10-22 from Packet Tracer and the headless simulator. CML was not
reachable for this revision: no local CML captures were present, `vmrun list`
reported `Total running VMs: 0`, and no local listeners were present on the
usual CML ports. The real-IOS column therefore uses Cisco IOS 15 DHCP command
and configuration references, and marks platform-dependent rows `needs-cml`.

## Fix list for the sim

Priority order for job 2 and command fidelity:

1. Add `show ip dhcp server statistics` behavior and IOS-style counters
   (`sim-wrong`).
2. Keep `clear ip dhcp binding *|address` behavior; it matches IOS 15. PT's
   rejection is a Packet Tracer limitation, not a simulator defect.
3. Preserve the IOS 15 `show ip dhcp binding` header and User name column; PT's
   shorter table is the outlier.

## Scope and evidence

Both runs exercised pool configuration with network/default-router/DNS/lease/
exclusions, PC renew/release/all, binding/pool/conflict/statistics/running-config
inspection, binding clears, relay, exhaustion, excluded addresses, a wrong
gateway, no-server APIPA, snooping trust/bindings, and `?`/completion.

Raw captures: [Packet Tracer](../harness/artifacts/dhcp-research-pt.json) and
[sim](../harness/artifacts/dhcp-research-sim.json). The simulator capture has
49 observations; the PT capture has 83, including restoration and ping checks.
Some PT PC responses include stale terminal history from the bridge, preserved
without normalization.

### Clean PT rerun status

The added segment was verified before the rerun: Router1 Gi0/1 reached
`10.99.0.1` up/up, Switch4 showed its uplink and PC port connected, and PC3
returned `Reply from 10.99.0.1: bytes=32 time<1ms TTL=255` with a temporary
static address. The DHCP experiment could not start because PT reported
`Port is not using DHCP.` for `ipconfig /release` and `ipconfig /dhcp` returned
`Invalid Command.` The bridge does not expose the PC Desktop > IP Configuration
control needed to switch PC3 from Static to DHCP, so the relay, clean exhaustion,
and APIPA attempts are preserved as raw blocked attempts rather than presented
as DHCP results.

## Observed behavior

- The sim leased `192.168.30.21` after excluding `.1-.20`; its binding output
  begins `Bindings from all pools not associated with VRF:` and includes the
  `User name` header.
- Real IOS 15 documents `clear ip dhcp binding {address | *}` and
  `show ip dhcp server statistics`; PT rejected both disputed command families,
  while the sim correctly accepted the binding clear but incorrectly rejected
  server statistics.
- The sim relay gave the far PC `10.10.0.2` with gateway `10.10.0.1`. The PT
  lab's two router subinterfaces share one switched VLAN, so its helper result
  cannot prove a routed far-LAN relay.
- The sim exhausted a one-address effective pool: PC1 received `10.50.0.254`
  and PC2 timed out. The PT live VLAN retained unrelated leases and did not
  produce a comparable clean exhaustion result.
- The sim no-server case produced APIPA `169.254.1.29/16`. The PT bridge did
  not yield a clean APIPA-only transcript.
- Sim snooping learned `0060.a80a.001f 10.70.0.2 ... dhcp-snooping ... Fa0/1`
  with Gi0/1 trusted. PT showed snooping enabled for VLAN 10, Fa0/1 trusted,
  and zero bindings; its statistics command was rejected.

## Discrepancies

| Area | Packet Tracer observation | Sim observation | Real IOS 15 | Classification |
|---|---|---|---|---|
| PC command surface | PT PC accepts `/renew`, `/release`, `/all`; `/dhcp` was rejected in captured terminal history | Sim models Windows-like `/dhcp`, then `/renew`, `/release`, `/all` | IOS 15 router docs define DHCP server/relay commands, not a PC shell; exact PC behavior needs a real endpoint capture. [DHCP guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipaddr_dhcp/configuration/15-s/dhcp-15-s-book.pdf) | `needs-cml` |
| Lease allocation | Live VLAN 10 allocated `.11`/`.12` | Exclusions were honored; first free address after `.1-.20` was `.21` | IOS 15 DHCP pool allocation honors excluded addresses and exposes leased counts in `show ip dhcp pool`. [DHCP guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipaddr_dhcp/configuration/15-s/dhcp-15-s-book.pdf) | `pt-limitation` |
| Binding output | PT used the shorter `Client-ID/Hardware address` table | Sim emitted the longer VRF/User name IOS-style table | IOS 15 documents `show ip dhcp binding` as the server binding table; the 15M&T guide's format includes the IOS 15 multi-line header and User name field. [15M&T DHCP guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipaddr_dhcp/configuration/15-mt/dhcp-15-mt-book/config-dhcp-server.html) | `pt-limitation` |
| `clear ip dhcp binding` | `*` and a single address returned PT `ERROR_INVALID` | Both forms were accepted and cleared automatic bindings | IOS 15 explicitly specifies `clear ip dhcp binding {address | *}`; `*` clears all automatic bindings. [IOS IP addressing command reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipaddr/command/ipaddr-cr-book.pdf) | `pt-limitation` |
| Server statistics | `show ip dhcp server statistics` returned PT `ERROR_INVALID` | Sim rejected it with its invalid-input marker | IOS 15 supports the command and says it displays counts of DHCP messages sent and received. [DHCP monitoring guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipaddr_dhcp/configuration/15-s/dhcp-15-s-book/dhcp-serv-rad-proxy.html) | `sim-wrong` |
| Relay | Existing PT VLAN 20 is shared by both routers, so the helper test was not a routed far-LAN test | Dedicated routed topology leased `10.10.0.2` through the relay | IOS 15 supports relay through `ip helper-address` on the client-facing routed interface; exact counters and output need CML. [DHCP guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipaddr_dhcp/configuration/15-mt/dhcp-15-mt-book/config-dhcp-server.html) | `needs-cml` |
| Pool exhaustion | Existing live leases prevented a clean tiny-pool proof | Second client timed out after the effective one-address pool was consumed | IOS 15 `show ip dhcp binding` is the documented way to verify leased addresses and pool exhaustion. [DHCP guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipaddr_dhcp/configuration/15-s/dhcp-15-s-book.pdf) | `pt-limitation` |
| Wrong gateway | PT PC output showed the pool-provided gateway, but the bridge transcript was mixed | Sim copied the intentionally wrong `default-router` into `ipconfig /all` | IOS 15's DHCP pool supports `default-router`; exact PC presentation needs CML. [DHCP guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipaddr_dhcp/configuration/15-s/dhcp-15-s-book.pdf) | `needs-cml` |
| No server / APIPA | No clean APIPA-only PT transcript was obtained | Sim produced `169.254.1.29`, mask `255.255.0.0`, gateway `0.0.0.0` | APIPA is endpoint behavior, not IOS DHCP-server output; needs a real PC/CML endpoint capture. [DHCP guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipaddr_dhcp/configuration/15-s/dhcp-15-s-book.pdf) | `needs-cml` |
| Snooping status | PT showed VLAN 10 snooping and Fa0/1 trusted, zero bindings; statistics was rejected | Sim supports status, trust, statistics, and learned binding output | IOS 15 switch references support `show ip dhcp snooping`, binding inspection, and snooping counters; exact platform output needs CML. [IOS IP addressing command reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipaddr/command/ipaddr-cr-book.pdf) | `needs-cml` |
| `ip dhcp ?` and Tab | PT help listed `excluded-address`, `pool`, and `relay`; bare command was rejected/incomplete | Sim's config-mode help/completion exposes its DHCP command tree | IOS 15 has DHCP global and pool submodes documented in the DHCP guide; exact help ordering and abbreviation behavior needs CML. [DHCP guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipaddr_dhcp/configuration/15-s/dhcp-15-s-book.pdf) | `needs-cml` |
| Bridge capture fidelity | PT adapter sometimes returned stale PC terminal history around a new command | JSON-lines harness isolates each simulator request | This is an adapter limitation, not IOS behavior; a CML capture is needed to settle the clean transcript. | `needs-cml` |

## What job 2 relies on

The laundromat scenario depends on R1 at `192.168.20.1/24`, excluded
`192.168.20.1-.20`, pool `LAUNDRY`, network `192.168.20.0/24`, and
`default-router 192.168.20.1`. Kiosk and office PCs renew into `.21` and the
next free address; the printer stays static at `.5`.

The work-order task checks R1's command history for `show ip dhcp binding`, and
the story inserts a ghost lease with IP text, MAC `0166.6666.6666.04`, and the
old lease timestamp. The stable IOS 15 binding header, spacing, automatic row,
and command-history behavior therefore matter directly to job 2.

## Restoration

Temporary DHCP pools, exclusions, helper address, and snooping VLAN were
removed. Final PT checks showed Router0/Router1 subinterfaces up/up, snooping
disabled with VLANs `none`, and gateway replies including
`Reply from 192.168.10.1: bytes=32 time<1ms TTL=255` and
`Reply from 192.168.20.1: bytes=32 time<1ms TTL=255`.

No simulator or game behavior was changed.
