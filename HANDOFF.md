# Handoff: where Time To Live is

Read this first if you're picking up the project, human or AI. Update it whenever you finish something or change a plan.

Last updated: 2026-10-18.

## The game in one paragraph

Time To Live is a 2D top-down horror game set in Static Springs, a Night Vale style town. You're a network contractor for Bob's Bandwidth & Bloodletting. Each job is a strange local business that needs a network, and you bring the gear, cable it and configure it with a command line that behaves exactly like Cisco IOS. The jobs climb the CCNA 200-301 curriculum, from a corner store with static IPs to The Void-View Hotel. Network attacks are the hauntings. The full design doc lives outside the repo in the project's shared files at `design/design-doc.md`. Ask Ant for it if you can't reach it.

## People and rules

- **Story so far:** the mentor is Walter, job 1's client is Mrs. Finch, and Bellwether is the neighboring town that vanished but still answers pings. See the design doc.
- **Owner:** Ant (GitHub Anthonydcobb). Ant is studying for the CCNA and makes the design calls. Ask before changing anything in the design.
- **The CLI must match real IOS:** same modes, abbreviations, `?` help, errors and show output. When unsure, copy real IOS 15 output.
- **The simulation is real, not answer checking.** Frames actually move. Work orders check live network state, never typed commands.
- **Never say "Cisco" in game branding.** Devices are made by Cryptis Systems (the CR-2911 router and CS-2960-24TT switch).
- **Incantations:** commands are learned like RPG skills. Each new job's scenario lists what it teaches. Unlearned commands still work when typed, by design.
- **Cables:** any Ethernet cable links any two Ethernet ports, since auto-MDIX is assumed. Ant dropped straight-through vs crossover on purpose. Console cables only fit console ports.

## Stack and layout

TypeScript, Vite, Vitest, xterm.js and Phaser 3 on Node 22. Packaging with Electron or Tauri comes later.

```
src/sim/      The simulator. No DOM, runs on a virtual clock, fully unit tested.
src/web/      The bench page: topology diagram, device tabs, terminals, work order.
              terminal.ts is the xterm terminal, shared with the game.
src/game/     The game (game.html): Phaser rooms, dialogue, laptop overlay, port panel, story script.
tests/        Vitest tests (cli, network, depth, topology).
```

The README has the full feature list and the file-by-file layout.

```sh
npm install
npm run dev      # bench at http://localhost:5173, game at /game.html (?debug shows hitboxes)
npm test
npm run build    # typecheck and production build
```

Key ideas:
- `Clock` is virtual time. The browser advances it from real time, and tests call `clock.advance()`.
- Commands that take time (ping, traceroute, the typo DNS lookup) return a `Job` that streams output and can be aborted.
- `Network.connect(a, b, cable)` plugs in a cable. Link state, line protocol (1 s later) and the fake 30 s spanning tree delay follow from there.
- A scenario such as `src/sim/scenarios/corner-store.ts` builds the network and returns a diagram `layout` and the work order `tasks`. Each task has a `done()` check against live state.

## Done

| What | Where |
|---|---|
| IOS parser and console: modes, abbreviations, `?`, Tab, history, real errors, `do`, sub-mode fallback | PR #1 |
| Config: hostname, enable secret and password, type 7, banner motd, line con and vty, interface IPs, static routes, default gateway, Vlan1 SVI, save, erase, reload | PR #1 |
| Simulation: ARP, MAC learning and flooding, routing (connected, local, static), ICMP echo, unreachable and TTL exceeded, link and line protocol logs | PR #1 |
| Show commands: run, start, ip int brief, interfaces, ip route, arp, mac address-table, vlan brief, version, clock | PR #1 |
| PCs with `ipconfig`, `ping`, `tracert`, `arp -a` | PR #1 and #2 |
| Real-time ping and traceroute with abort, console ports and cables, CDP | PR #2 |
| Logical topology diagram, device tabs, and a work order that ticks itself off | PR #3 |
| Incantations: unlearned commands show as runes in `?` help; jobs teach them and using one learns it (`src/sim/grimoire.ts`) | PR #4 |
| DHCP server on the router (with IOS's ping check and conflicts), Windows-style DHCP client with APIPA fallback, job 2 (the laundromat) and a job picker | PR #5 |
| VLANs, 802.1Q trunks, DTP, per-VLAN spanning tree timers, SVIs with autostate, router-on-a-stick subinterfaces, native VLAN mismatch, job 3 (the dentist) | PR #6 |

**PR state:** #1 → `main`, then #2 to #6 each stacked on the one before. None are merged yet. Merge them in order, #1 first.

## Next up

Phase 1 (the simulator) still has gaps:
1. Real spanning tree: BPDUs, root election, blocking, portfast and BPDU guard. This is for job 4, and the cultists sending BPDUs through wall jacks hook into it. Timers are already per VLAN per port in `devices/switch.ts`.
2. `interface range`, SSH and telnet over vty, `ip helper-address`, LLDP.
3. VTP modes, voice VLANs, `show interfaces status`.
4. A terminal program on the PC that uses the console cable.

Unverified against real gear (best recollection, check when someone has a Catalyst handy): the error text for `no interface` on a physical port, and whether a subinterface shows "administratively down" when only its parent is shut. From IOS 15 docs and memory rather than a capture (Ant's CML only runs IOL, IOS XE 17): the 2911 `show running-config` skeleton (no license udi, redundancy, Embedded-Service-Engine0/0, line 2 or scheduler lines yet) and the 2911/2960 hardware and media lines in `show interfaces`. Frame byte counts and the 5-minute rates are approximate. The 2960 keeps `Administrative Trunking Encapsulation: dot1q` and `Native VLAN tagging: enabled` (IOL says negotiate/disabled, but a 2960 only does dot1q). Answering yes to the setup dialog backs out as if Ctrl-C was pressed; the setup facility isn't simulated. Boot doesn't print the post-boot log burst (%SYS-5-RESTART, interface logs) yet.

Phase 2 is the vertical slice. Ant picked 16 px art (drawn at 4x) and Phaser on 2026-10-18. The grey-box corner store is built (`src/game/`, branch `claude/corner-store-slice`): home base with the walkie-talkie (Walter), Gary's locked door, the job board and Bob's desk; the shop with Mrs. Finch, the register and back office PCs, the rack (console into R1 or S1) and a port panel where you can pull and replug cables. The work order ticks off from the live network. When it's all done, a phantom PC (MAC 6666.6666.6666, 192.168.1.66) plugs into S1 Fa0/24 through the wall behind the cooler and pings the register now and then, the lights flicker, and the job report's BOUNDARY INTEGRITY line fades. The town sign goes from 4,218 to 4,219 on the way home. `src/game/story.ts` holds every line and trigger. Still to do: Ant's sprites (spec in the shared `design/art-spec-corner-store.md`, PNGs land in the shared `art/` folder), the home lab, a sanity meter, sound, and saving progress.

## Open questions for Ant

- Art style. Ant likes Welcome to Elderfield and is collecting reference screenshots. Who makes the art is also undecided: AI, asset packs or an artist.
- Story beats per job, and where automation topics go on the job ladder.
- Whether to keep building simulator depth first or start the Phase 2 slice next.

## Job ladder

| # | Job | CCNA topics |
|---|---|---|
| 1 | Corner store | Static IPs, hostname, passwords, interface IPs, `no shutdown` |
| 2 | 24-hour laundromat | DHCP on the router, a networked printer |
| 3 | Dentist's office | VLANs, trunks, router-on-a-stick |
| 4 | Library | Layer 3 switch, STP, EtherChannel |
| 5 | Funeral home and crematorium | Two sites, a WAN link, static routes |
| 6 | Town hall and sheriff | OSPF, ACLs |
| 7 | Community radio station | NAT/PAT, wireless |
| 8 | Hospital | SSH, port security, HSRP, syslog/NTP |
| 9 | The Void-View Hotel | Everything, IPv6, fixing someone else's broken network |
