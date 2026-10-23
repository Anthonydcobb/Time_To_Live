# VLAN, trunk, and router-on-a-stick research

Captured 2026-10-22 from the headless dentist scenario and the live Packet
Tracer bridge. The simulator runner settles blank/confirmation/destination
prompts, records the prompt before and after every command, records the mode,
and returns to privileged EXEC between standalone commands. The PT bridge
does not expose a console prompt or interactive keypresses, so PT observations
explicitly record that transport limitation. CML was not available; rows that
need a platform-accurate IOS capture are marked `needs-cml`.

Artifacts: [Packet Tracer](../harness/artifacts/vlans-research-pt.json) and
[simulator](../harness/artifacts/vlans-research-sim.json).

The comparison uses Cisco's [Catalyst 2960 IOS 15.0(2)SE command
reference](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst2960/software/15-0_2_se/command/reference/cr2960/ComRef.html),
[IOS LAN switching configuration guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/lanswitch/configuration/15-s/lsw-15-s-book.html),
and [Cisco's native-VLAN mismatch
reference](https://www.cisco.com/c/en/us/support/docs/lan-switching/8021q/116376-technote-nativ-vlan-00.html).

## Fix list, in game priority order

1. **Implement `show vlan id N` (`sim-wrong`).** The game job asks players to
   verify a specific VLAN. The simulator currently quotes:

   ```text
                    ^
   % Invalid input detected at '^' marker.
   ```

   Real IOS 15 accepts the same command and begins:

   ```text
   VLAN Name                             Status    Ports
   ---- -------------------------------- --------- -------------------------------
   10   STAFF                            active    Fa0/2
   VLAN Type  SAID       MTU   Parent RingNo BridgeNo Stp  BrdgMode Trans1 Trans2
   ```

   PT returned that IOS-shaped VLAN detail, so this is not a PT limitation.

2. **Fix SVI autostate protocol state (`sim-wrong`).** With VLAN 30 created,
   `interface vlan 30`, an address, `no shutdown`, and an active access port
   moved into VLAN 30, the simulator still reports:

   ```text
   Vlan30                 192.168.30.1    YES manual down                  down
   ```

   Real IOS 15 and PT report the autostate transition as:

   ```text
   Vlan30                 192.168.30.1    YES manual up                    up
   ```

   The simulator's initial `down/down` before the access port moved is
   correct; the second observation is the defect relevant to a teaching job.

3. **Correct the DTP result when one end is statically access
   (`sim-wrong`).** In the simulator's `access-desirable` case, the desirable
   end says:

   ```text
   Administrative Mode: dynamic desirable
   Operational Mode: trunk
   ```

   Real IOS 15 keeps both ends non-trunking when the other end is statically
   access; the expected line is:

   ```text
   Operational Mode: static access
   ```

   PT also showed the desirable end as `Operational Mode: trunk` in this
   capture, so the PT result is recorded as a platform limitation for this
   matrix cell, not evidence against the IOS behavior.

4. **Correct DTP negotiation with `switchport nonegotiate`
   (`sim-wrong`).** For a static trunk with `nonegotiate` facing a dynamic
   desirable port, the simulator reports on the dynamic side:

   ```text
   Administrative Mode: dynamic desirable
   Operational Mode: trunk
   ```

   Real IOS 15 does not form a negotiated trunk on that side; it reports:

   ```text
   Administrative Mode: dynamic desirable
   Operational Mode: static access
   ```

   The simulator does correctly reject trying to set a dynamic mode while
   `nonegotiate` is present:

   ```text
   Command rejected: Conflict between 'nonegotiate' and 'dynamic' status on this interface: Gi0/2
   ```

   PT produced the same trunk-side/dynamic-side mismatch in this live bridge
   test, so that PT row is `pt-limitation`; the simulator behavior still needs
   correction against IOS 15.

5. **Emit the native-VLAN mismatch CDP log (`both-missing`).** After the two
   connected trunks were configured with native VLAN 99 versus VLAN 1, both
   simulator and PT `show logging` captures contained link/configuration
   messages but no native mismatch line. Real IOS 15 emits:

   ```text
   %CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on FastEthernet0/1 (99), with Switch FastEthernet0/1 (1).
   ```

   This requires checking CDP adjacency timing in CML before treating the
   exact interface wording as final; the comparison is classified
   `both-missing` pending that capture.

No fix item is listed for trunk allowed-VLAN add/remove/except/none, native
VLAN configuration, router subinterfaces including `encapsulation dot1Q 99
native`, voice VLAN, deleted-VLAN inactive access ports, or the ordinary DTP
auto/desirable matrix: those behaviors were observed in the simulator with
IOS-shaped output and are included below as matching evidence.

## Verified matching IOS 15

| Behavior | Simulator evidence | PT evidence |
|---|---|---|
| VLAN creation and naming | `show vlan brief` includes `10 STAFF` and `20 XRAY` | `show vlan brief` includes `10 STAFF` and `20 XRAY` |
| `show vlan id N` layout once supported by the device | PT returned the full VLAN detail layout; simulator gap is isolated to parser rejection | `VLAN Name ... Status ... Ports`, then `VLAN Type SAID MTU ...` |
| DTP auto/auto | Both ends: `Administrative Mode: dynamic auto`, `Operational Mode: static access` | Both ends: same result |
| DTP auto/desirable | Both ends: `Operational Mode: trunk` | Both ends: `Operational Mode: trunk` |
| DTP desirable/desirable | Both ends: `Operational Mode: trunk` | Both ends: `Operational Mode: trunk` |
| Static trunk facing auto | Both ends: `Operational Mode: trunk` | Both ends: `Operational Mode: trunk` |
| Trunk `nonegotiate` command and rejection | `Negotiation of Trunking: Off`; dynamic configuration is rejected with the IOS conflict text | `Negotiation of Trunking: Off`; bridge accepts the dynamic peer but this matrix result is marked PT-limited |
| Allowed VLAN mutations | `show interfaces trunk` ends with `Vlans allowed on trunk` / `none` after the explicit `none` command | PT shows the same final empty allowed list on the tested trunk |
| Native VLAN and router subinterface | `GigabitEthernet0/0.99 ... up ... up`; `Encapsulation 802.1Q Virtual LAN, Vlan ID 99` | `show ip interface brief` shows `.99 192.168.99.1 ... up up` |
| Deleted VLAN with assigned port | `Access Mode VLAN: 77 (Inactive)` after `no vlan 77` | `Access Mode VLAN: 77 (Inactive)` after `no vlan 77` |
| Voice VLAN | `Voice VLAN: 150 (VLAN0150)` | `Voice VLAN: 150` and PT creates VLAN 150 when it does not exist |
| SVI autostate before a member port is active | Simulator reports `Vlan30 ... down down`, which matches IOS behavior before autostate | PT reports `Vlan30 ... up down` while the SVI exists but the VLAN has no active member |
| Inter-VLAN routing | After convergence the simulator replies across 192.168.10.0/24 and 192.168.20.0/24; the first two-packet probe records the expected initial ARP loss | PC0 `ping 192.168.20.1` and PC1 `ping 192.168.10.1` produced replies in the live lab |

The simulator DTP cases were run on a real connected pair added to the
scenario, while the dentist scenario's Gi0/1-to-router link was used for the
router-on-a-stick and ping checks. Every simulator command observation has a
mode and prompt-before/prompt-after field; configuration commands that ended
in config mode were settled with `end` or `ctrl-Z` before the next standalone
command.

## PT transport limits and restoration

The bridge does not expose the interactive IOS prompt, so PT JSON has
`prompt: null` and `promptStatus: bridge does not expose console prompts or
interactive settlement`. It also cannot provide CML-grade confirmation of the
CDP native-mismatch log. These are `pt-limitation` or `needs-cml`, not
simulator fix claims.

The temporary VLANs, SVI, voice VLAN, native VLAN, router subinterface, and
test port changes were removed. Final PT `show vlan brief` has VLANs 1, 10,
20, and the default 1002-1005 set; `show interfaces trunk` again reports the
baseline trunks with allowed VLANs `10,20`; Router0's `.10` and `.20` are
`up/up`; and final endpoint checks included:

```text
Reply from 192.168.10.1: bytes=32 time<1ms TTL=255
Reply from 192.168.20.1: bytes=32 time<1ms TTL=255
Packets: Sent = 4, Received = 4, Lost = 0 (0% loss)
```

The bridge sometimes returns a stale PC transcript on the first command; a
separate paced recheck returned four replies from PC0 to `192.168.10.1` and
PC0 to `192.168.20.1`, and the live lab remained in its baseline state.
