# OSPFv2 single-area research

Captured 2026-10-23 using the headless simulator and Packet Tracer's live bridge. Cisco IOS 15 documentation is the authority; Packet Tracer is recorded as a platform observation. The PT routers identify as Cisco 2911 running IOS 15.1(4)M4. Both runs used a single area (area 0), a broadcast transit segment, and one remote LAN. Raw command/configuration captures are in [PT](../harness/artifacts/ospfv2-research-pt.json) and [sim](../harness/artifacts/ospfv2-research-sim.json).

The PT test used the existing Router0-to-Router1 VLAN 20 path through the current switch trunks. Router1 GigabitEthernet0/1 already had a cable to the Switch4/PC3 segment; the harness temporarily addressed and enabled that interface, then removed its address and restored shutdown. No cable or device was added. The restore capture confirms both routers have their original subinterfaces, no OSPF process, no test route, and Router1 Gi0/1 shut down with no address. The simulator network is discarded after capture.

## Priority fix list

1. **Implement the OSPF link-state database show commands (`sim-wrong`).** IOS/PT returned Router and Network LSAs with their links and metrics. The simulator rejected `show ip ospf database`, `show ip ospf database router`, and `show ip ospf database external` with the invalid-input marker. Cisco IOS 15 documents these commands for inspecting the database. [Cisco IOS 15 OSPF monitoring reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/iproute_ospf/configuration/15-mt/iro-15-mt-book/iro-cfg.html)

2. **Support explicit OSPF interface cost (`sim-wrong`).** PT accepted `ip ospf cost 25` on Router1 Gi0/1. Router0 then installed `O 10.30.0.0/24 [110/26] via 192.168.20.2`; the Router1 LSA listed stub-link metric 25. The simulator rejected the command and kept the learned route at `[110/2]`. IOS documents this interface command and defines the default bandwidth-based cost calculation. [Cisco OSPF interface cost reference](https://www.cisco.com/c/en/us/support/docs/ip/open-shortest-path-first-ospf/13689-17.html)

3. **Correct default-route origination in the routing table (`sim-wrong`).** With a static default route in the originator's table and `default-information originate`, PT installed `O*E2 0.0.0.0/0 [110/1]` on the peer and showed the Type 5 external LSA with metric type 2 and metric 1. The simulator instead displayed `S* 0.0.0.0/0 [110/0] via 192.168.20.1`, despite the configured OSPF origination. The IOS guide documents `default-information originate`; the normal default is a Type 2 external metric. [Cisco IOS 15 OSPF default-route guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/iproute_ospf/configuration/15-mt/iro-15-mt-book/iro-cfg.html)

4. **Complete neighbor detail and interface status output (`sim-wrong`).** The simulator produced the basic `show ip ospf neighbor` table and DR/BDR state, but rejected `show ip ospf neighbor detail`. Its `show ip ospf interface` output omits the IOS/PT timers, DR/BDR interface addresses, neighbor counts, and `No Hellos (Passive interface)` indicator. IOS 15 documents the detail command and those interface fields. [Cisco OSPF command reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/iproute_ospf/command/iro-cr-book/m_ospf-s1.html), [Cisco OSPF interface output reference](https://www.cisco.com/c/en/us/support/docs/ip/open-shortest-path-first-ospf/13689-17.html)

5. **Match OSPF route display details (`sim-wrong`, lower priority).** Both platforms learned the same baseline route at administrative distance 110 and metric 2. PT printed the prefix length, route age, and outgoing interface (`10.30.0.0/24 ... 00:00:46, GigabitEthernet0/0.20`); the simulator omitted those fields and printed the destination without `/24`.

6. **Validate three-router election behavior (`needs-cml`).** The existing lab supported the requested two-router election: equal priority 1 elected router ID `2.2.2.2` as DR and `1.1.1.1` as BDR. A third OSPF router is needed to observe `DROTHER` and priority-zero behavior in PT; none was added. Cisco specifies highest priority first, then highest router ID for ties, and priority zero is ineligible. [Cisco DR/BDR election reference](https://www.cisco.com/c/en/us/support/docs/ip/open-shortest-path-first-ospf/13689-17.html)

## Captured behavior

| Behavior | Packet Tracer / IOS 15 observation | Simulator observation | Classification |
|---|---|---|---|
| Single-area neighbor formation | `FULL/DR` and `FULL/BDR` on VLAN 20 after the 45-second election/convergence wait | Same neighbor IDs, state, and DR/BDR roles | Match in tested two-router case |
| DR/BDR | Router1 `2.2.2.2` was DR; Router0 `1.1.1.1` was BDR; both priorities were 1 | Same roles and priority values | Match in tested two-router case |
| `show ip ospf neighbor` | Summary table with priority, state, dead timer, address, and interface | Summary table with those fields | Match in tested case |
| `show ip ospf neighbor detail` | FULL state, DR/BDR, options, uptime, retransmission counters and queue fields | Invalid-input marker | `sim-wrong` |
| `show ip ospf interface` | Broadcast network, cost, role, priority, DR/BDR addresses, timers, neighbors | Network, cost, role, and priority only | `sim-wrong` |
| `show ip ospf database` | Router and Network LSAs present | Invalid-input marker | `sim-wrong` |
| Learned LAN route | `O 10.30.0.0/24 [110/2] via 192.168.20.2` | `O 10.30.0.0 [110/2] via 192.168.20.2` | `sim-wrong` display detail |
| Passive interface | `No Hellos (Passive interface)` on R1 Gi0/1; network remained advertised and reachable as an OSPF route on R0 | Passive config appeared in running-config and R0 retained the OSPF route; interface output did not say it was passive | `sim-wrong` output gap; no peer was present on this LAN to test adjacency suppression directly |
| Explicit interface cost | Gi0/1 cost 25 appeared in the interface view and Router0 learned metric 26 | `ip ospf cost 25` rejected; route metric remained 2 | `sim-wrong` |
| Default route | Peer installed `O*E2 ... [110/1]`; external database showed Type 5, metric type 2, metric 1 | Peer displayed `S* ... [110/0]`; external database command rejected | `sim-wrong` |

## Sources

- [Cisco IOS 15M&T OSPF configuration guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/iproute_ospf/configuration/15-mt/iro-15-mt-book/iro-cfg.html) — network statements, passive interface, default origination, and OSPF database commands.
- [Cisco IOS OSPF command reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/iproute_ospf/command/iro-cr-book/m_ospf-s1.html) — neighbor detail and database output command surface.
- [Cisco OSPF interface output and cost reference](https://www.cisco.com/c/en/us/support/docs/ip/open-shortest-path-first-ospf/13689-17.html) — cost, interface fields, DR/BDR election and priority rules.
