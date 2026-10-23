# Port security research

Raw captures: [Packet Tracer](../harness/artifacts/port-security-research-pt.json) and [simulator](../harness/artifacts/port-security-research-sim.json). The PT capture uses the existing PC0 on Switch0 Fa0/2 (access VLAN 10); no device or cable was added. Fa0/2 was restored to access VLAN 10 with port security and recovery settings removed, then verified connected with PC0 receiving four gateway replies. The simulator topology was isolated and discarded at process exit.

Cisco Catalyst 2960 IOS 15.0(2)SE is the authority for expected behavior. `vmrun` is unavailable in PATH, so no CML capture was possible. The Packet Tracer bridge returns cumulative PC terminal text and the lab has only one host connected directly to Fa0/2, which limits isolated violation tests.

## Priority fix list

1. **Protect mode forwards and reports violations — `sim-wrong`.** In the simulator, PC0's ping to PC2 succeeded with `Reply from 192.168.10.12`, and S1 logged `%PORT_SECURITY-2-PSECURE_VIOLATION`. IOS 15's violation table says protect drops packets with unknown source MACs and sends no trap, syslog, or counter increment. Change protect to silently drop the unknown-source frame. Cisco documents the actions in [Catalyst 2960 IOS 15.0(2)SE port security, Security Violations](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst2960/software/release/15-0_2_se/configuration/guide/scg2960/swtrafc.html).

2. **Restrict and shutdown counters remain zero — `sim-wrong`.** The simulator's `show port-security interface Fa0/1` reports `SecurityViolation (Count) 0` after a restrict violation, and also reports 0 in `Secure-shutdown` after a shutdown violation. IOS 15 specifies that restrict and shutdown increment the violation counter; the same guide's mode table says protect does not. Increment the count for restrict and shutdown events and keep protect at zero.

3. **Learned sticky MAC is missing from running-config — `sim-wrong`.** The simulator learns two source MACs on its secure test trunk and reports `CurrentAddr (Count) 2`, but `show running-config` contains only `switchport port-security mac-address sticky`; it omits the learned sticky MAC line. IOS 15 says learned sticky addresses are added to running configuration, for example `switchport port-security mac-address sticky 0000.0000.0001`. Render every learned sticky secure MAC in interface configuration. Cisco documents this in the [configuration steps for sticky secure addresses](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst2960/software/release/15-0_2_se/configuration/guide/scg2960/swtrafc.html).

4. **Err-disable recovery commands and timer are missing — `sim-wrong`.** The simulator rejects `show errdisable recovery`, `errdisable recovery cause psecure-violation`, and `errdisable recovery interval 30` as invalid input. After advancing virtual time 35 seconds, the port remains `Secure-shutdown`. IOS 15 documents recovery through `errdisable recovery cause psecure-violation` with the configured recovery interval, or manual `shutdown` / `no shutdown`. Add the global recovery controls, display command, timer, and port reactivation. See Cisco's [IOS 15.0(2)SE command reference](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst2960/software/release/15-0_2_se/command/reference/cr2960/cli3.html).

5. **Packet Tracer recovery CLI is unavailable — `pt-limitation`.** On the PT Catalyst 2960-24TT image labeled IOS 15.0(2)SE4, `show errdisable recovery`, the recovery-cause command, and the interval command returned `ERROR_INVALID`, while Cisco's IOS 15.0(2)SE reference documents the cause and interval commands. This is an emulator command-surface limitation; the simulator's corresponding missing commands remain a separate `sim-wrong` item.

6. **PT traffic-violation results need an independent IOS capture — `needs-cml`.** PT correctly learned PC0's MAC as sticky, showed maximum 2 / one current secure MAC, and kept Fa0/2 up. The lab's single directly attached PC could not generate a second source MAC on that access port. The attempted over-limit static-MAC sequence returned a maximum-limit message; a later capture showed `Secure-shutdown`, violation count 1, and `err-disabled`, but the sequence does not establish that a received unknown-source frame caused it. After 35 seconds, the port remained err-disabled; manual shutdown/no shutdown restored it. Use CML to settle actual protect/restrict/shutdown behavior, counters, logging, and automatic recovery on IOS.

## Verified matches

| Behavior | Simulator | Packet Tracer | Real IOS 15 comparison |
|---|---|---|---|
| Sticky learning and maximum count | With max 4, the trunk learned two MACs; `show port-security interface` reported current count 2. | Fa0/2 learned PC0 `00E0.A379.2D27`, showed maximum 2 and one sticky address, and running-config rendered the sticky MAC. | Sticky learning and maximum secure address controls are documented. Simulator's show-running omission is listed above. |
| Restrict drops unknown-source traffic | Unauthorized PC2 ping timed out; restrict log appeared; violation count stayed 0. | No clean isolated violation was generated on the one-host access port. | IOS drops the packet, logs/notifies, and increments the count. The simulator matches the drop and log, not the counter. |
| Shutdown and manual recovery | Unauthorized ping timed out; port became `Secure-shutdown`; the modeled interface was shut. | The over-limit command sequence ended with Fa0/2 err-disabled; manual shutdown/no shutdown brought it up. Trigger attribution is inconclusive. | IOS shuts the port and increments the violation count; manual shutdown/no shutdown recovers it. |
| Automatic err-disable recovery | Commands were invalid and 35 seconds did not recover the port. | Commands were `ERROR_INVALID`; 35 seconds did not recover Fa0/2. | IOS documents automatic recovery by cause and interval. |
| Protect mode | Unauthorized ping succeeded and a violation log appeared. | No clean isolated violation was generated. | IOS drops without logging or incrementing a counter. |

## Sources

- [Cisco Catalyst 2960 IOS 15.0(2)SE configuration guide: port security](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst2960/software/release/15-0_2_se/configuration/guide/scg2960/swtrafc.html) — sticky MAC behavior, defaults, violation definitions, mode action table, and recovery procedure.
- [Cisco Catalyst 2960 IOS 15.0(2)SE command reference](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst2960/software/release/15-0_2_se/command/reference/cr2960/cli3.html) — port-security commands and err-disable recovery syntax.

## Capture and restore notes

The simulator harness captured 98 observations across baseline, sticky/max, protect, restrict, shutdown, and recovery probes. The PT harness captured 129 observations, including the maximum-limit configuration response, secure-address table, violation counters, logs, err-disabled state, recovery-command responses, and final restoration. It used no topology edits. Final PT verification reports Fa0/2 connected, VLAN 10, no port-security commands in the interface configuration, port security disabled, and a successful ICMP reply from PC0 to `192.168.10.1`. CML was unavailable because `vmrun` was not found in PATH.
