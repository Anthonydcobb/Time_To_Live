# STP research: Packet Tracer, sim, and real IOS 15

Captured 2026-10-22 from the rebuilt live Packet Tracer topology and the
existing capped sim harness. CML was not reachable for this revision (`vmrun
list` reported `Total running VMs: 0`, with no local CML captures or usual CML
listeners), so the Real IOS 15 column cites Cisco's Layer 2 command references
and marks platform/topology questions `needs-cml`.

## Fix list for the sim

Priority order for the game:

1. Implement the documented `show spanning-tree` variants (`root`,
   `blockedports`, `summary`, `detail`, `active`, and interface detail) and
   match their IOS 15 field names (`sim-wrong`).
2. Add PortFast operational state and `show spanning-tree ... interface ...
   detail` output (`sim-wrong`).
3. Add BPDU Guard err-disabled state and Root Guard inconsistent-port state
   (`sim-wrong`).

## Scope and topology limit

The live lab is a three-switch loop:

```text
Router0--Switch0--Switch1--Switch2--Router1
             |                 |
            PC0              PC1/PC2
             \_______________/
```

The added Switch0 Fa0/4 to Switch2 Fa0/5 crossover was up on both ends. The
raw PT artifact is [stp-research-pt.json](../harness/artifacts/stp-research-pt.json);
the sim link-failure artifact is [sim-stp-scenario.json](../harness/artifacts/sim-stp-scenario.json).

## Observed results

PT accepted default, per-VLAN, summary, detail, active, and interface-detail
forms. It rejected `show spanning-tree root` and `blockedports`, even though
IOS 15 documents those keywords. Lowering Switch1 priority made it root;
PortFast, Root Guard, BPDU Guard err-disable, and link-failure reconvergence
were captured and restored. The sim triangle reported forwarding/blocking
counts `5/2`, `4/0`, and `5/2` before/during/after a link failure.

## Discrepancies

| Area | Packet Tracer observation | Sim observation | Real IOS 15 | Classification |
|---|---|---|---|---|
| Topology | Three-switch loop with a live Fa0/4-Fa0/5 path | Three-switch triangle with one alternate blocked port | IOS STP behavior is topology-dependent; a CML capture is required before treating either physical fixture as the behavioral reference. [STP guide](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst6500/ios/15-4SY/config_guide/sup2T/15_4_sy_swcg_2T/spanning_tree.html) | `needs-cml` |
| Root election | PT PVST root priority included extended system-ID values such as 32778 for VLAN 10 | Sim fixture pins S1 at 24576 and reports root priority 24577 | IOS 15 PVST uses a per-VLAN bridge ID with extended system ID, priority, and MAC; equal-priority election depends on bridge ID. [STP guide](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst6500/ios/15-4SY/config_guide/sup2T/15_4_sy_swcg_2T/spanning_tree.html) | `needs-cml` |
| Port roles and cost | PT reports `Root`, `Desg`, and `Altn BLK` with FastEthernet cost 19 | Sim reports roles with GigabitEthernet cost 4 in a different topology | IOS 15 reports Root/Designated/Alternate roles, states, and path cost; exact values depend on interface speed and topology. [LAN switching command reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/lanswitch/command/lsw-cr-book/lsw-s1.html) | `needs-cml` |
| Link failure | PT selected the surviving loop path through Switch0 Fa0/4 after Fa0/1 shutdown | Sim changed `5/2` to `4/0` and back | IOS STP recomputes roles and forwarding state after a failed path; timing and selected path need a matched CML topology. [STP guide](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst6500/ios/15-4SY/config_guide/sup2T/15_4_sy_swcg_2T/spanning_tree.html) | `needs-cml` |
| Command variants | PT supports summary/detail/active/interface detail but rejects `root` and `blockedports` | Existing sim capture only exercises `show spanning-tree` | IOS 15 documents `active`, `blockedports`, `detail`, `inconsistentports`, `interface`, `root`, `summary`, and VLAN forms. [IOS 15 STP command reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/lanswitch/command/lsw-cr-book/lsw-s1.html) | `sim-wrong` |
| PortFast | PT interface detail says `The port is in the portfast mode` | No PortFast state or equivalent output | IOS 15 supports PortFast on access interfaces and exposes operational state through spanning-tree interface output. [2960 optional STP guide](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst2960/software/release/15-0_2_se/configuration/guide/scg2960/swstpopt.html) | `sim-wrong` |
| BPDU Guard | PT captured `Fa0/6 err-disabled` after a superior VLAN 10 BPDU | No BPDU Guard command/event state | IOS 15 BPDU Guard places a PortFast interface receiving a BPDU into error-disabled state. [BPDU Guard reference](https://www.cisco.com/c/en/us/support/docs/lan-switching/spanning-tree-protocol/10586-65.html) | `sim-wrong` |
| Root Guard | PT captured `Root Inconsistent` on the guarded interface | No Root Guard command or inconsistent-port state | IOS 15 documents Root Inconsistent output under `show spanning-tree inconsistentports`. [LAN switching command reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/lanswitch/command/lsw-cr-book/lsw-s1.html) | `sim-wrong` |
| Output format | PT uses IOS-like PVST sections, VLAN names, system-ID extension, timers, and interface prose | Sim output uses existing simulator text and fixture-specific GigabitEthernet roles | IOS 15 `show spanning-tree` output includes protocol, root/bridge IDs, roles, states, cost, timers, and interface status fields. [STP command reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/lanswitch/command/lsw-cr-book/lsw-s1.html) | `sim-wrong` |

## Restoration

The temporary priority, mode, PortFast, BPDU Guard, Root Guard, test-switch,
and link-failure changes were removed or reversed. No simulator fixes were made;
this report is the research input for later implementation.
