# NAT/PAT research

Raw captures: [Packet Tracer](../harness/artifacts/natpat-research-pt.json) and [simulator](../harness/artifacts/natpat-research-sim.json). The PT capture uses the existing PC0/PC2 inside VLAN 10 and PC1 outside VLAN 20 on the 2911. No device, cable, or endpoint address was added. Temporary NAT configuration and dynamic translations were removed; final Router0 captures show no NAT roles, mappings, or translations, and the existing hosts still reach their gateways.

Cisco IOS 15 documentation is authoritative. `vmrun` is unavailable in this environment, so CML could not be checked or used. Packet Tracer PC command output sometimes returns cumulative terminal history; the static inbound ping is therefore treated as inconclusive where its command echo is truncated.

## Priority fix list

1. **Dynamic NAT pool CLI and translation — `sim-wrong`.** Cisco IOS 15 accepts `ip nat pool`, an ACL selecting inside local addresses, and `ip nat inside source list <acl> pool <name>`. PT accepted the configuration, allocated `192.168.20.101` to PC2, and showed the two-address pool and one allocated address in `show ip nat statistics`. The simulator rejected both `ip nat pool TTL-POOL ...` and the corresponding `ip nat inside source list 1 pool TTL-POOL` with `% Invalid input`. Add IOS-style pool definition, binding, allocation, release, and show output. Cisco documents this sequence and the allocation model in its [IOS 15.0S NAT configuration guide](https://www.cisco.com/en/US/docs/ios-xml/ios/ipaddr_nat/configuration/15-0s/iadnat-addr-consv.html#wp1060823).

2. **Statistics header — `sim-wrong` (small text fix).** Cisco IOS 15 sample output and PT say `Total translations: N (...)`; the simulator says `Total active translations: N (...)`. The simulator reports its counts, interfaces, hit/miss counters, and overload mapping, so this is a display mismatch rather than missing statistics. Match the IOS header and casing/order (`Outside interfaces`, then `Inside interfaces`). Cisco's [IOS 15.2S monitoring guide](https://www.cisco.com/en/US/docs/ios-xml/ios/ipaddr_nat/configuration/15-2s/iadnat-monmain.html) documents `show ip nat translations`, `show ip nat statistics`, and sample output.

3. **NAT role in `show ip interface` — `pt-limitation`.** On PT, `show ip nat statistics` identifies Gi0/0.10 as inside and Gi0/0.20 as outside, and translations were created, but `show ip interface` for both subinterfaces says `Network address translation is disabled`. The simulator prints `IP NAT inside`/`IP NAT outside` in this view. Treat PT's interface-detail line as an emulator display limitation; the IOS 15 guide defines `ip nat inside` and `ip nat outside` as the interface role commands in the [static translation procedure](https://www.cisco.com/en/US/docs/ios-xml/ios/ipaddr_nat/configuration/15-0s/iadnat-addr-consv.html#wp1060823).

4. **Static NAT inbound reachability — `needs-cml`.** Both the simulator and PT installed and displayed the static `192.168.10.10` to `192.168.20.100` entry. The simulator returned four replies when PC1 pinged the mapped address. The PT bridge truncated PC1's command echo to `C:\\>ing 192.168.20.100` and returned `Invalid Command`, so the live PT ingress result cannot be classified from this capture. CML is needed to settle that behavior independently. Cisco describes static inside-source NAT as a fixed one-to-one mapping that makes the inside host reachable at its fixed global address.

## Verified matches

| Behavior | Simulator | Packet Tracer | IOS 15 comparison |
|---|---|---|---|
| Static inside-source entry | Config accepted; translation row present; PC1 got four replies to the global address | Config and row present; inbound ping capture inconclusive | Static local/global one-to-one mapping is documented; inbound PT behavior is `needs-cml` |
| Interface overload PAT | PC0 and PC2 both reached PC1 and translated to `192.168.20.1`; two active translations and the overload mapping appeared in statistics | Both inside sources appeared as ICMP translations using `192.168.20.1` | Matches documented overload behavior: multiple inside locals share one global address, with protocol identifiers distinguishing flows |
| `show ip nat translations` | Static, ICMP dynamic, and overload entries displayed | Static, pool, and overload entries displayed | Both expose the expected inside-global/inside-local/outside columns |
| `show ip nat statistics` counters | Hits, misses, interfaces, and mapping state displayed | Hits, misses, interfaces, and mapping state displayed | Core data matches; simulator's first-line header and interface label order differ from IOS sample text |
| `clear ip nat translation *` | Removed dynamic entries while retaining the static entry when tested; overload mapping stayed configured with active 0 | Same: static row remained on the static-only check; dynamic entries cleared and final restore cleared the table | Matches Cisco's documented behavior: `*` clears dynamic translations; configuration remains |

## Sources

- [Cisco IOS 15.0S NAT address conservation guide](https://www.cisco.com/en/US/docs/ios-xml/ios/ipaddr_nat/configuration/15-0s/iadnat-addr-consv.html) — static and dynamic inside-source NAT, pool creation, and overload.
- [Cisco IOS 15.2S NAT monitoring and maintenance guide](https://www.cisco.com/en/US/docs/ios-xml/ios/ipaddr_nat/configuration/15-2s/iadnat-monmain.html) — translation and statistics commands, sample output, and clearing dynamic translations.

## Capture and restore notes

The simulator harness uses an isolated `sim-server` network and discards it at exit. The PT harness recorded 82 observations. Its final running config has no NAT rules or ACL, both NAT interface roles are removed, `show ip nat translations` is empty, and PC0, PC2, and PC1 each returned a gateway reply. CML discovery was unavailable because `vmrun` was not found in PATH.
