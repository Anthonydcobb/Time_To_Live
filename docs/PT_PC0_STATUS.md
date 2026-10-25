# Packet Tracer PC0 VLAN 10 status

Captured 2026-10-22 from the live workspace. This note records the current
state without changing the Packet Tracer topology.

## Current topology and configuration

The intended live path is:

```text
PC0 Fa0 / 192.168.10.10/24
  -> Switch0 Fa0/2 (access VLAN 10)
  -> Switch0 Fa0/3 (802.1Q trunk, VLANs 10,20)
  -> Router0 GigabitEthernet0/0.10 (VLAN 10, 192.168.10.1/24)
```

There is also a switch-to-switch trunk:

```text
Switch0 Fa0/1 (802.1Q trunk, VLANs 10,20)
  -> Switch1 Fa0/1 (802.1Q trunk, VLANs 10,20)
```

The second access host is currently:

```text
PC1 Fa0 / 192.168.20.10/24, gateway 192.168.20.1
  -> Switch1 Fa0/2 (access VLAN 20)
```

Router0 currently has:

```text
GigabitEthernet0/0                 up/up, no IP address
GigabitEthernet0/0.10              encapsulation dot1Q 10
                                   192.168.10.1/24, up/up
GigabitEthernet0/0.20              encapsulation dot1Q 20
                                   192.168.20.1/24, up/up
```

Switch0 and Switch1 both have VLANs 10 and 20. Switch0 Fa0/2 is access VLAN
10; Switch1 Fa0/2 is access VLAN 20. Switch0 Fa0/1 and Fa0/3, and Switch1
Fa0/1, are forced trunks allowing VLANs 10 and 20. The old Switch0 VLAN 1
management address was removed and VLAN 1 was shut down so it would not
compete with Router0's `192.168.10.1` gateway. The same cleanup was sent to
Switch1.

The live topology discovery captured six devices: Switch0, Switch1, Router0,
PC0, PC1, and Packet Tracer's Power Distribution Device0. The dashboard hides
the power-distribution device operationally.

## Fixes actually attempted and observed results

All results below come from the bridge command outputs, not assumptions.

1. The first expanded health capture showed PC0 configured as
   `192.168.10.10`, PC1 at `0.0.0.0`, and Router0 interfaces administratively
   down. This established that the expanded router/PC path was not configured
   yet.

2. The first automated configuration attempt passed `interface`/`vlan` as
   command-mode metadata for subcommands. Packet Tracer returned
   `ERROR_INVALID` for switchport, `no shutdown`, router subinterface, and
   related subcommands. PC address commands still returned `STATUS_OK`. No
   successful switch/router subconfiguration was claimed from that attempt.

3. The command-mode handling was corrected so subcommands used the empty mode
   after entering global/interface configuration. This succeeded on Switch0,
   Switch1, and Router0. The resulting verification showed Router0
   `GigabitEthernet0/0.10 192.168.10.1 up/up` and
   `GigabitEthernet0/0.20 192.168.20.1 up/up`; PC1 was configured as
   `192.168.20.10/24` with gateway `192.168.20.1`; and both PCs reported the
   intended addresses. Switch1's repeated `name USERS` command once returned
   `ERROR_INVALID`, consistent with the VLAN name already existing; the rest
   of its access/trunk configuration succeeded.

4. Verification showed Switch0 Fa0/1 was still a default/access VLAN 1 port,
   even though it was the switch-to-switch link. Switch0 Fa0/1 was then
   changed to an 802.1Q trunk allowing VLANs 10 and 20. After STP convergence,
   `show interfaces trunk` on both switches reported VLANs 10 and 20 in the
   forwarding state. This fixed the missing inter-switch trunk, but PC0 still
   produced no ping reply.

5. The old Switch0 management SVI was removed from `192.168.10.1` and VLAN 1
   was shut down; the same cleanup was sent to Switch1. `show running-config`
   confirmed Switch0 `interface Vlan1` had `no ip address` and `shutdown`.
   Re-running PC0 pings produced no reply, so this did not fix the PC0 issue.

6. PC0's address was re-applied several times as
   `ipconfig 192.168.10.10 255.255.255.0 192.168.10.1`. Later `ipconfig`
   output confirmed the address, mask, and gateway. PC1's equivalent command
   and gateway test succeeded: `Reply from 192.168.20.1`.

7. A two-second wait was used to allow STP to converge. Subsequent output
   showed Switch0 Fa0/1 and Fa0/3, and Switch1 Fa0/1, forwarding VLANs 10 and
   20. PC0 still did not reply.

8. Router0 `show ip arp` repeatedly learned PC1 on
   `GigabitEthernet0/0.20`, but did not learn PC0 on VLAN 10. Switch0 did
   learn PC0's MAC `00e0.a379.2d27` on Fa0/2 in VLAN 10. This narrows the
   unresolved behavior to PC0's VLAN 10 traffic/ARP path rather than the
   bridge, router subinterface state, or trunk state.

The first captured post-configuration failure is timestamped
`2026-10-21T23:09:24Z` in the bridge result. The `Z` timestamp is UTC, which
was 7:09 PM EDT on October 21, not 11:09 PM. A later live status check was
timestamped `2026-10-22T02:43:41Z` (10:43 PM EDT). The earlier 11:09 PM
statement was therefore incorrect.

## Background processes and ports

A fresh Windows check found these listeners:

| Component | Current evidence |
|---|---|
| Legacy Node bridge | `127.0.0.1:39094`, PID 62120, `node.exe`; not the dashboard's selected bridge |
| Current Node bridge | `127.0.0.1:39095`, PID 75940, `node.exe`; this is the active dashboard bridge |
| Additional Node listener | `127.0.0.1:39194`, PID 62500, `node.exe`; not selected by the dashboard |
| Vite dev server | `127.0.0.1:5173`, PID 62788, `node.exe` |
| Packet Tracer IPC | Packet Tracer PID 48232 listening on `0.0.0.0:39000` |
| Java ExApp runners | Two `java.exe` processes were observed (PIDs 60984 and 67684). Exact command-line-to-PID mapping was unavailable because Windows denied process command-line inspection. The active runner is the one that printed `PT bridge connected; polling http://127.0.0.1:39095` and serviced the bridge. |

The dashboard uses:

```text
http://localhost:5173/pt-dashboard.html?bridge=http://127.0.0.1:39095
```

The last verified status was `ready: true`, `poller: connected`, `pending: 0`,
with 4,782 results processed. Ports 39094 and 39194 are not the dashboard's
active bridge.

## Cold-start procedure

Packet Tracer must be open with the topology loaded, IPC enabled, and its
listen port set to `39000`. The generated PTA must already be added under
`Extensions -> IPC -> Configure Apps`; if it is not registered, generate and
add it once:

```powershell
cd C:\Users\antho\Documents\Time_To_Live
$env:PT_TTL_AUTH_SECRET = "CHANGE_ME_BEFORE_USE"
.\harness\pt-exapp\make-pta.ps1
```

Then import:

```text
C:\Users\antho\Documents\Time_To_Live\harness\pt-exapp\pt-ttl-bridge.pta
```

For a normal cold start, use one PowerShell window and let the launcher choose
the bridge port:

```powershell
cd C:\Users\antho\Documents\Time_To_Live
$env:PT_TTL_AUTH_SECRET = "CHANGE_ME_BEFORE_USE"
.\tools\start-pt-stack.ps1
```

Use the exact bridge port and dashboard URL printed by the launcher. Confirm
with:

```powershell
npm run pt:status
```

The expected state is `ready: true` and `poller: "connected"`. Do not paste
the `PS C:\...>` prompt text into PowerShell. Do not start a second manual
Node bridge on a port already selected by the launcher.

## Resolved

### Clean reset and re-application proof (2026-10-22)

The live bridge accepted `erase startup-config` and `reload` for Switch0,
Switch1, and Router0, each with `"status": "STATUS_OK"`. The `.pkt` file was
not modified. The existing `tools/run-pt-live-expanded-config.mjs` was then
run once: Switch0 reported `"commandCount": 22, "failures": []`, Switch1
reported `"commandCount": 17, "failures": []`, and Router0 reported
`"commandCount": 14, "failures": []`.

Immediately after that run, STP was still converging. After waiting for
convergence, the same live stack reported all intended trunks forwarding:
`Fa0/1 10,20` and `Fa0/3 10,20` on Switch0, and `Fa0/1 10,20` on Switch1.
Switch0 then reported `VLAN0010` with `Fa0/2 Desg FWD` and `Fa0/3 Desg FWD`.
Router0's ARP table contained both `192.168.10.10 ... GigabitEthernet0/0.10`
and `192.168.20.10 ... GigabitEthernet0/0.20`.

The two first post-run PC0 commands were accepted with `"status":
"STATUS_OK"` for `ping 192.168.10.1` and `ping 192.168.20.10`, but the
Packet Tracer ExApp returned only the asynchronous ping header (or an empty
output) and did not capture the delayed reply lines. The forwarding proof is
therefore the converged STP state plus the learned Router0 ARP entries, not an
invented ping transcript.

Captured 2026-10-22 from the live Packet Tracer bridge. The suspected Dynamic
ARP Inspection/DHCP snooping/port-security cause was not present: Switch0
reported `Source Mac Validation : Disabled`, `No active or enabled vlans on
switch`, `Switch DHCP snooping is disabled`, and `Port Security : Disabled` on
Fa0/2. Router0 reported no access lists. No configuration change was required
in this session.

The recovered fault was a transient STP/ARP convergence state after the
earlier switch/trunk changes; allowing the live topology to converge and
relearn ARP restored forwarding. No configuration change was required in the
clean run. The earlier live verification was:

- PC0 `ping 192.168.10.1`: `Reply from 192.168.10.1: bytes=32 time<1ms TTL=255`.
- PC0 `ping 192.168.20.10`: `Reply from 192.168.20.10: bytes=32 time<1ms TTL=127`.
- Router0 `show ip arp` listed `192.168.10.10` on `GigabitEthernet0/0.10` and
  `192.168.20.10` on `GigabitEthernet0/0.20`.
- Switch1 `show interfaces trunk` reported VLANs `10,20` in the spanning-tree
  forwarding state and not pruned.

## Rebuilt live topology (2026-10-22)

Fresh bridge discovery after the reboot reported nine devices and fourteen
link endpoints: `Switch0`, `Switch1`, `Switch2`, `Router0`, `Router1`,
`PC0`, `PC1`, `PC2`, and `Power Distribution Device0`.

The verified endpoint map is:

```text
PC0 Fa0                 -> Switch0 Fa0/2
Switch0 Fa0/1           -> Switch1 Fa0/1
Switch0 Fa0/3           -> Router0 Gi0/0
Switch1 Fa0/2           -> Switch2 Fa0/1
Switch2 Fa0/2           -> Router1 Gi0/0
Switch2 Fa0/3           -> PC1 Fa0
Switch2 Fa0/4           -> PC2 Fa0
```

The bridge directly confirmed the switch links through CDP; the remaining
endpoint assignments are the matching live link records and MAC-table
evidence. Raw discovery is in `harness/artifacts/pt-topology-snapshot.json`;
normalized command and CDP captures are in
`harness/artifacts/pt-topology-normalized.json`.

The expanded configuration tooling now targets all three switches and both
routers. Switch-to-switch and switch-to-router links are forced trunks
allowing VLANs 10 and 20. `Switch2 Fa0/3` is access VLAN 20 for PC1 and
`Switch2 Fa0/4` is access VLAN 10 for PC2. Router0 provides `.1` gateways;
Router1 provides the parallel `.2` addresses.

The live run reported zero configuration failures for Switch0 (26 commands),
Switch1 (17), Switch2 (31), Router0 (14), and Router1 (14). After STP
convergence, all three switches reported their configured trunks forwarding
VLANs 10 and 20. Router0's ARP table learned PC0 `192.168.10.10`, PC2
`192.168.10.11`, and PC1 `192.168.20.10`.

Captured successful cross-PC replies included:

- PC0 to PC1: `Reply from 192.168.20.10: bytes=32 time<1ms TTL=127`
- PC0 to PC2: `Reply from 192.168.10.11: bytes=32 time<1ms TTL=128`
- PC1 to PC0: `Reply from 192.168.10.10: bytes=32 time<1ms TTL=127`
- PC1 to PC2: `Reply from 192.168.10.11: bytes=32 time<1ms TTL=127`
- PC2 to PC0: `Reply from 192.168.10.10: bytes=32 time<1ms TTL=128`
- PC2 to PC1: `Reply from 192.168.20.10: bytes=32 time<1ms TTL=127`

Raw STP experiment observations for the rebuilt topology are in
`harness/artifacts/stp-research-pt.json`.

For the BPDU Guard experiment, Anthony added `Switch3` and connected
`Switch3 Fa0/1` to `Switch2 Fa0/6`; fresh discovery reported 10 devices and
18 live link endpoints. The experiment configured Switch2 Fa0/6 as a
PortFast/BPDU-Guard VLAN 10 edge and Switch3 as a superior VLAN 10 root. PT
reported `Fa0/6 err-disabled` in VLAN 10, after which the test port was shut
down and its temporary guard settings were removed.

Anthony then added the redundant cross-over `Switch0 Fa0/4` to `Switch2
Fa0/5`. A fresh discovery reported both endpoints up and increased the live
link-endpoint count from 14 to 16. The expanded config now makes both ports
trunks carrying VLANs 10 and 20. The STP capture used this loop for equal-
priority MAC tie-break, path-cost selection, root guard with a superior
priority, and link-failure reconvergence; the raw observations remain in
`harness/artifacts/stp-research-pt.json`.
