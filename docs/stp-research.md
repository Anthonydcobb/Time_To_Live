# STP research: Packet Tracer versus sim

Captured 2026-10-22 from the rebuilt live Packet Tracer topology and the
existing capped sim harness. Raw Packet Tracer observations are preserved in
`harness/artifacts/stp-research-pt.json`; the sim link-failure capture is in
`harness/artifacts/sim-stp-scenario.json`.

## Scope and topology limit

The live lab is now a three-switch loop:

```text
Router0--Switch0--Switch1--Switch2--Router1
             |                 |
            PC0              PC1/PC2
             \_______________/
```

The added `Switch0 Fa0/4` to `Switch2 Fa0/5` cross-over is up on both ends.
The raw topology snapshot now reports 16 live link endpoints.

## Observed results

Packet Tracer accepted `show spanning-tree`, per-VLAN output for VLANs 10 and
20, `show spanning-tree summary`, `detail`, `active`, and interface-detail
variants. It returned `ERROR_INVALID` for `show spanning-tree root` and
`show spanning-tree blockedports`. The live output reported PVST, extended
system ID, short path cost, 19-cost FastEthernet links, and the expected root,
designated, and root-port roles.

Lowering Switch1's VLAN 10/20 priority to 24576 made it root for those VLANs;
Packet Tracer reported priority 24586/24596 including the VLAN system-ID
extension and showed the downstream Switch1 Fa0/2 as `Altn BLK` during the
capture. Restoring priority 32768 returned the default election.

PortFast configuration on Switch2 Fa0/3 was visible in interface detail as
`The port is in the portfast mode`. Root guard configuration produced a live
`Root Inconsistent` entry on Switch1 Fa0/2 while the guarded state was
captured. A fourth switch was then attached to Switch2 Fa0/6 as a BPDU source;
the second run captured `Fa0/6 err-disabled` in VLAN 10. The test port was
shut down and its guard settings were removed afterward.

The Packet Tracer link-failure capture shut Switch0 Fa0/1. During the
capture, Switch0 selected Fa0/4 as its root path through the surviving side of
the loop, demonstrating redundant-path reconvergence.

The sim triangle capture reported, before/during/after its S1 Gi0/1 failure,
forwarding/blocking counts of `5/2`, `4/0`, and `5/2`, with root priority
`24577` throughout. It therefore supplies a real sim observation for a
redundant link failure, but it is not the same physical topology as the live
PT lab.

## Discrepancies

| Area | Packet Tracer observation | Sim observation | Classification |
|---|---|---|---|
| Topology | Three-switch loop with the added Fa0/4-Fa0/5 path | Three-switch triangle with one alternate blocked port | `needs-real-gear` / experimental-topology mismatch |
| Root election | Per-VLAN PVST root priority includes system-ID extension, e.g. 32778 for VLAN 10; priority change made Switch1 root | Triangle fixture pins S1 at 24576 and reports root priority 24577 | `text-mismatch` and `needs-real-gear` |
| Port roles | PT reports `Root`, `Desg`, and during the priority capture `Altn BLK` with FastEthernet cost 19 | Sim reports roles/states with GigabitEthernet cost 4 and a fixed triangle | `behavior-mismatch` for comparable roles; cost is topology/interface dependent |
| Link failure | PT selected the surviving loop path via Switch0 Fa0/4 after Fa0/1 shutdown | Sim changes from 5 forward/2 blocked to 4 forward/0 blocked and back | `behavior-mismatch`; convergence/event timing and topology differ |
| Command variants | PT supports `show spanning-tree summary`, `detail`, `active`, and interface detail; `root` and `blockedports` returned `ERROR_INVALID` | Existing sim capture only exercises `show spanning-tree`; no equivalent variant observations are present | `missing-feature` |
| PortFast | PT interface detail explicitly reports `The port is in the portfast mode` | No PortFast observation or equivalent state exists in the sim artifact | `missing-feature` |
| BPDU Guard | With Switch3 as a BPDU source, PT reported `Fa0/6 err-disabled` in VLAN 10 | No BPDU Guard command/event observation | `missing-feature` |
| Root Guard | PT reported `Root Inconsistent` on the guarded interface during capture | No root-guard command or inconsistent-port state exists | `missing-feature` |
| Output format | PT uses IOS-style PVST sections, VLAN names, system-ID extension, timers, and interface-detail prose | Sim output uses the simulator's existing `show spanning-tree` text and fixture-specific GigabitEthernet roles | `text-mismatch` |

## Blocked experiments

No planned experiment remains blocked. The mismatched-mode case was captured
and restored; PT reported Switch0 Fa0/4 as `auto`, `n-802.1q`, and still
`trunking` while the peer remained forced trunking.

No simulator fixes were made. This report is the phase-5 input, not an
implementation proposal.
