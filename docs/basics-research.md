# Basic IOS command research: corrected simulator capture

Captured 2026-10-22. The simulator was rerun with
`tools/run-basics-research-sim.mjs` after fixing the harness. The runner now:

- records `promptBefore`, `promptAfter`, mode, and every settlement;
- answers `Destination filename [startup-config]?` and `[confirm]` with
  Enter before the next command;
- returns to privileged EXEC between standalone commands;
- keeps configuration mode for the explicit `do` sequence, then returns to
  privileged EXEC; and
- writes raw command output separately from prompt/settlement output.

The corrected capture has 65 observations in
[basics-research-sim.json](../harness/artifacts/basics-research-sim.json).
The original live Packet Tracer capture remains in
[basics-research-pt.json](../harness/artifacts/basics-research-pt.json).
No `src/`, `src/game`, `src/web`, `script/`, or `art/` files were
changed.

The Real IOS 15 references are Cisco's
[configuration-files guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/config-mgmt/configuration/15-sy/config-mgmt-15-sy-book/cm-config-files.html),
[IOS configuration command reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/Cisco_IOS_Configuration_Fundamentals_Command_Reference.pdf),
and [Catalyst 2960 command reference](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst2960/software/15-0_2_se/command/reference/cr2960/ComRef.html).

## Corrected fix list

1. **Implement only the missing EXEC commands: `show history` and
   `show users`.** The corrected simulator capture shows the same invalid
   marker for both:

       sim show history:
                    ^
       % Invalid input detected at '^' marker.

       sim show users:
                   ^
       % Invalid input detected at '^' marker.

   IOS 15 accepts both commands. A fresh IOS session may have no history rows,
   but it does not reject the command; `show users` has the standard table
   header:

       Line       User       Host(s)              Idle       Location

       Interface    User               Mode         Idle     Peer Address

   This is a real simulator gap, classified `sim-wrong`.

There is no simulator fix item for full interface detail, `show interfaces
status`, startup configuration, `write memory`, or configuration-mode
`do`. Those previous findings were harness errors or a router/switch scope
mistake:

- Full router and switch interface detail is present in the corrected raw
  capture.
- `show interfaces status` is a switch command; the router's invalid response
  is correct, and the switch returns the port table.
- `show startup-config` correctly returns
  `startup-config is not present` before the save test.
- After the harness answers the destination prompt, `write memory` returns
  `Building configuration...` and `[OK]`.
- `do show version` now runs at both `Router(config)#` and
  `Router(config-if)#`.

## Verified simulator output matching IOS 15

These are behavior/layout matches, allowing expected dynamic values, MACs,
timestamps, fictional product strings, and PT hardware wording to differ.

| Command or behavior | Corrected simulator evidence |
|---|---|
| Full router interface detail | `GigabitEthernet0/0 is up, line protocol is up`; `MTU 1500 bytes, BW 1000000 Kbit/sec`; `Full Duplex, 1Gbps`; counters follow. |
| Full switch interface detail | `FastEthernet0/1 is up, line protocol is up (connected)`; `MTU 1500 bytes, BW 100000 Kbit/sec`; `Full-duplex, 100Mb/s`; counters follow. |
| Administratively-down router port | `GigabitEthernet0/1 is administratively down, line protocol is down` with MTU/BW, Auto Duplex/Speed, and counters. |
| Interface summary | `show ip interface brief` reports `GigabitEthernet0/0.10  192.168.10.1 ... up ... up` and unused ports as `administratively down down`. |
| Switch status | `show interfaces status` returns `Port Name Status Vlan Duplex Speed Type` and connected/notconnect rows. |
| Startup config before save | `startup-config is not present`. |
| Save prompt and save alias | Settlement records prompt `Destination filename [startup-config]? `, response `""`, then `Building configuration...` / `[OK]`; `write memory` independently returns the same two lines. |
| Running-config filters | `show running-config | include interface` returns only interface lines; `| section interface` returns each interface block and its commands. |
| VLAN/MAC/ARP/CDP/route families | On their valid device types, the simulator returns IOS-shaped tables: VLAN brief, MAC address table, ARP columns, CDP capability/device rows, and connected/local route codes. Router-only or switch-only commands are rejected on the other device type as IOS does. |
| Version layout | `show version` includes version, ROM, uptime, image, memory, interface count, and config register. Fictional product/image strings are intentionally excluded. |
| Parser errors | `show ip` -> `% Incomplete command.`; invalid input includes the caret marker; `show i` -> `% Ambiguous command:  "show i"`. |
| Abbreviations | `sh ip int br` returns the same interface summary as the full command. |
| Help and completion APIs | `help("show ?")` / `help("show ip ?")` return command lists; `complete("show ip int br")` returns `show ip int brief `. |
| Config-mode `do` | The observation mode is `Router(config)#` for the first `do show version` and `Router(config-if)#` for the second; both return the version layout and leave the console usable. |

## Packet Tracer transport limitations

These are not simulator gaps:

- The live bridge records parser outcomes as `ERROR_INCOMPLETE`,
  `ERROR_INVALID`, and `ERROR_AMBIGUOUS` while leaving raw output empty;
  the simulator records the IOS text and caret.
- The bridge cannot send a Tab keypress or answer a second interactive prompt
  in one command transaction, so Tab and copy completion are
  `pt-limitation` observations.
- PT PC responses may include stale terminal history in a bridge delta. Final
  gateway reachability was still verified with 4/4 replies.

## Evidence and restoration

The corrected simulator's two final gateway checks each report:

    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),

The live PT running topology and gateway addressing were left intact. The
previous PT save probe created startup-config; the bridge could not complete
the erase confirmation. Manual cleanup is: open Router0 and Switch0, choose
the **CLI** tab, enter `erase startup-config`, press **Enter** at
`[confirm]`, then run `show startup-config` and verify
`startup-config is not present`.
