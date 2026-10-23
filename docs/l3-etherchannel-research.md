# Layer 3 switching and EtherChannel research

This is a research capture only. No files under `src/` were changed. Raw
captures are [the simulator artifact](../harness/artifacts/l3-etherchannel-research-sim.json)
and [the Packet Tracer artifact](../harness/artifacts/l3-etherchannel-research-pt.json).

The simulator harness waited 35 s for STP, 5 s for LACP/PAgP bundling, 35 s
for member recovery, and 65 s for the CDP baseline. PT used the same waits.
The PT EtherChannel cases are not valid comparisons: topology inspection found
that the existing Switch0 Fa0/1 link goes to Switch1, but Switch0 Fa0/4 goes to
another switch. The harness therefore recorded standalone/suspended results
from mismatched physical neighbors and stopped before adding topology.

## Fix list

1. **EtherChannel detail and protocol command surface — `sim-wrong`.** The
   simulator does form a bundle, but its summary is too small:

   ```text
   sim: 1  Po1-       LACP         Gi0/1(P) Gi0/2(P)
   IOS 15: 1      Po1(SU)           LACP   Gi1/0/1(P) Gi1/0/2(P)
   ```

   Implement the IOS summary flags/legend and the missing `show etherchannel
   port-channel`, `show etherchannel load-balance`, `show lacp neighbor`, and
   `show pagp neighbor` output. IOS 15 documents these display commands and
   the `P`, `I`, `s`, `R`, `S`, and `U` meanings in the [EtherChannel command
   reference](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst2960/software/release/15-0_2_se/configuration/guide/scg2960/swethchl.html).

2. **Member compatibility enforcement — `sim-wrong`.** The mismatch case
   still reports bundled members in the simulator:

   ```text
   sim: Po20-       LACP         Gi0/1(P) Gi0/2(P)
   IOS 15: Po1(SU) LACP with an incompatible member shown as (s), or excluded
   from the active member list, with the corresponding EtherChannel log.
   ```

   Enforce matching speed, duplex, access/trunk mode, native VLAN, allowed
   VLANs, and other channel parameters; emit the IOS-style suspension/log
   evidence.

3. **Port-channel interface/config inheritance — `sim-wrong`.** The simulator
   accepts the physical `channel-group` commands but does not provide the
   IOS `interface Port-channel N` surface or the requested `show interfaces
   port-channel N` evidence:

   ```text
   sim: % Invalid input detected at '^' marker.
   IOS 15: interface Port-channel 1; show interfaces Port-channel 1
   ```

4. **L3 default route and routed EtherChannel — `sim-wrong`.** The simulator
   successfully routes between two routed switch ports and between two SVIs;
   `show ip route` includes connected `10.0.0.0/24`, `10.0.1.0/24`,
   `192.168.10.0/24`, and `192.168.20.0/24`. It does not create a routed
   port-channel or produce the IOS default-route/routed-bundle surface:

   ```text
   sim: % Invalid input detected at '^' marker.  (interface port-channel 30)
   IOS 15: interface Port-channel 30; no switchport; ip address ...; show ip route
   ```

5. **Layer 3 PT platform coverage — `pt-limitation` / `needs-cml`.** The live
   lab contains 2960 switches. PT rejected `ip routing`, routed physical ports,
   and the routed Port-channel experiment on that platform. A 3560
   multilayer switch or CML IOS 15 capture is required for the L3-switch and
   routed-EtherChannel comparison.

## Verified matching behavior

| Behavior | Simulator evidence | IOS 15 reference / PT status |
|---|---|---|
| LACP active/active and active/passive form | `show etherchannel summary` showed `LACP` and `(P)` after 5 s | IOS 15 pairing behavior; PT blocked by missing parallel neighbor link |
| LACP passive/passive does not form | Summary showed `(s)` after 5 s | IOS 15 does not form passive/passive; PT blocked |
| PAgP desirable/auto forms | Summary showed `PAgP` and `(P)` after 5 s | IOS 15 pairing behavior; PT blocked |
| PAgP auto/auto does not form | Summary showed `(s)` after 5 s | IOS 15 pairing behavior; PT blocked |
| Static `on/on` forms; `on/active` does not | `(P)` for on/on, `(s)` for on/active | IOS 15 static `on` requires both sides; PT blocked |
| STP sees the bundle as one logical path | Bundle members reached forwarding after the 35 s STP wait | Existing simulator STP test passes; PT comparison blocked |
| IP routing off/on | Off: inter-subnet ping timed out; on: replies arrived after ARP convergence and `show ip route` listed connected routes | IOS 15 behavior; PT 2960 limitation |
| SVI inter-VLAN routing | `VLAN10` reached `VLAN20` after the 35 s wait; both connected SVI routes appeared | IOS 15 multilayer-switch behavior; PT 2960 limitation |

## PT limits and required resume step

`npm run pt:status` was healthy before the run (`ready: true`, poller
connected). The PT bridge exposes no interactive prompts and returned blank PC
transcripts during the final ping recheck, so the artifact does not claim ping
reply proof. Switch0/Switch1 trunk status and Router0 subinterfaces were
rechecked; the temporary channel-group, speed/duplex, and SVI/routing changes
were removed. The artifact records the PT limitation rather than treating the
invalid non-parallel links as EtherChannel evidence.

To resume the blocked PT portion, Anthony must add one parallel cable in the
Packet Tracer GUI:

1. Choose the Connections lightning-bolt tool and a copper Ethernet cable.
2. Click **Switch0**, choose **FastEthernet0/5**.
3. Click **Switch1**, choose **FastEthernet0/3**.
4. Confirm both ports show connected/up, then tell Codex to resume. The
   harness is prepared to bundle Switch0 Fa0/1 + Fa0/5 with Switch1 Fa0/1 +
   Fa0/3 and to remove the temporary Port-channel afterward.

## Sources

- [Cisco IOS 15.0(2)SE Catalyst 2960 EtherChannel guide](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst2960/software/release/15-0_2_se/configuration/guide/scg2960/swethchl.html)
- [Cisco IOS 15.0(2)SE Catalyst 3560/3750 EtherChannel guide](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst3750x_3560x/software/release/15-0_2_se/configuration/guide/3750x_cg/swethchl.html)
