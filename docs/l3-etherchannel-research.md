# Layer 3 switching and EtherChannel research

Research captures: [sim](../harness/artifacts/l3-etherchannel-research-sim.json) and [Packet Tracer](../harness/artifacts/l3-etherchannel-research-pt.json). The sim harness waited 35 s for STP, 5 s for LACP/PAgP bundling, 5 s after member failure, 35 s for recovery, and 35 s for routed-bundle convergence. PT used the same protocol waits where the case applied. IOS 15 behavior is authoritative; PT is recorded as a platform observation.

## Fix list

1. **Per-member failure and recovery — done (`sim-wrong`).** Before, one failed member made the bundle unusable: `Gi0/1(s) Gi0/2(s)`. After the 5 s failure wait, the sim records `Po1(SU) LACP Gi0/1(P) Gi0/2(D)`; after 35 s recovery both members are `(P)`. Forwarding and STP continue through the surviving member.

2. **Logical STP port and cost — done (`sim-wrong`).** Before, STP listed both physical members. After the 35 s STP wait it lists one `Po1` row, with short-method cost 3 for two Gi members and port ID `128.65` for group 1.

3. **Summary flags and command surface — done (`sim-wrong`).** Before, the summary header was garbled and detail/neighbor commands were missing. After, `show etherchannel summary` emits the IOS legend and `Po1(SU) LACP Gi0/1(P) Gi0/2(P)`, plus `show etherchannel port-channel`, `show interfaces port-channel`, `show lacp neighbor`, `show pagp neighbor`, `show etherchannel load-balance`, and `port-channel load-balance`.

4. **Negotiation and compatibility — done (`sim-wrong`).** Before, passive/passive, auto/auto, on/active, and LACP↔PAgP protocol mismatches were incorrectly shown as suspended. After 5 s, non-forming negotiated members—including LACP↔PAgP, which Cisco documents as incompatible protocols—are stand-alone `(I)` with `Po(SD)`; static `on` facing active stays bundled on the `on` side while the negotiating side is `(I)`. Incompatible speed/duplex or switchport settings are `(s)` and emit `%EC-5-CANNOT_BUNDLE2`. The simulated EtherChannel misconfig guard now defaults to enabled. The exact err-disable guard transition remains a PT/CML validation item.

5. **Port-channel interface and inheritance — done (`sim-wrong`).** Before, `interface Port-channel N` and its show/config surface were unavailable. After, the first `channel-group` creates the interface; Port-channel switchport/routed settings propagate to members and appear in running-config, `show interfaces port-channel N`, status/trunk views, and EtherChannel detail.

6. **Layer 3 switching and static routes — done (`sim-wrong`).** Before, a switch rejected `ip route 0.0.0.0 0.0.0.0 172.16.0.1` and routed ports omitted `no switchport`. After, the switch accepts the route and reports `S*  0.0.0.0/0 [1/0] via 172.16.0.1` plus `Gateway of last resort is 172.16.0.1 to network 0.0.0.0`; routed interfaces print `no switchport`. Static-route storage is shared with router behavior.

7. **Routed EtherChannel — done (`sim-wrong`).** After the 35 s bundling/STP wait, the sim reports `Po30(RU) LACP Fa0/3(P) Fa0/4(P)` and `C 172.31.0.0 is directly connected, Port-channel30`.

## Verified matching table

| Behavior | Simulator evidence | Real IOS 15 / PT classification |
|---|---|---|
| LACP active/active and active/passive form | `Po(SU)` with member `(P)` after 5 s | Matches IOS 15; PT active cases matched after its 5 s + STP wait |
| LACP passive/passive | `Po(SD)` and `(I)` | Matches IOS 15; PT formed it, so PT limitation |
| PAgP desirable/auto and desirable/desirable | Bundle `(P)` after 5 s | Matches IOS 15; PT observed where supported |
| PAgP auto/auto | `Po(SD)` and `(I)` | Matches IOS 15; PT limitation where output differs |
| `on/on` and `on/active` | `on/on` forms; `on/active` is asymmetric `(P)`/`(I)` | IOS 15 with misconfig guard may err-disable the static side; PT behavior is limitation until CML verifies the guard log |
| Member failure/recovery | surviving `(P)`/failed `(D)`, then both `(P)` | Matches IOS 15; PT recorded platform behavior |
| STP sees one Port-channel | one `Po` row, no member rows | Matches IOS 15; PT limits STP timing/detail fidelity |
| LACP↔PAgP protocol mismatch | `Po(SD)` and stand-alone `(I)` after 3 s | Matches Cisco IOS 15 protocol incompatibility rule; PT/CML status formatting remains a platform validation item |
| Incompatible member settings | suspended `(s)` plus `CANNOT_BUNDLE2` | Matches IOS 15 text family; exact platform log should be CML-verified |
| L3 routing off/on and SVIs | routed-port/SVI connected routes and inter-VLAN forwarding | Matches IOS 15 multilayer-switch behavior; 2960 PT cannot provide authoritative L3 coverage |
| Static default route | `S*` and gateway-of-last-resort lines | Matches IOS 15; PT 2960 limitation |
| Routed EtherChannel | `Po30(RU)` and connected Port-channel route | Matches IOS 15; requires 3560/CML for PT-side validation |

## PT limits

The rerun used a restored live lab with the added parallel link Switch0 Fa0/5 ↔ Switch1 Fa0/3. PT is a Catalyst 2960 emulator, so multilayer routing and routed EtherChannel are marked `pt-limitation`/`needs-cml`, not treated as IOS authority. The final PT restore was performed and both restore pings contained `Reply from` evidence.

## Sources

- [Cisco Catalyst 2960 IOS 15.0(2)SE EtherChannel guide](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst2960/software/release/15-0_2_se/configuration/guide/scg2960/swethchl.html)
- [Cisco Catalyst 3560/3750 IOS 15.0(2)SE EtherChannel guide](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst3750x_3560x/software/release/15-0_2_se/configuration/guide/3750x_cg/swethchl.html)
