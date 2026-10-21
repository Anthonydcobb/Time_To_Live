# Handoff: where Time To Live is

Read this first if you're picking up the project, human or AI. Update it whenever you finish something or change a plan.

Last updated: 2026-10-19.

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
| Portraits and inspect close-ups preload and only appear once decoded (no stale speaker); close-ups sit on top of the dialogue box | `src/game/ui.ts` |
| CRT overlay: soft on the start screen, "haunted" during the apparition, then an 8 s fade while you walk (`crt.on` / `crt.fade`) | `src/game/crt.ts` |
| Work order as a folded paper ticket top right: J or a click unfolds the tasks, a "✓ task" note pops when one ticks off, pinned inside the game picture's corner and above any laptop, PC or panel | `src/game/main.ts`, `game.css` |
| Dialogue as a rusted console (framed portrait, LEDs, green screen, ghost words) with roots and cables that spread on the haunt (`overgrowth.ts`); scratchy torn edges on portraits and close-ups (`grime.ts`); a blurred dark copy of the room fills the letterbox bars; the dev panel folds to a tab top left (backtick) | `src/game/` |
| Job 2 in the game: after the store, work order #0002 goes up on the board and the van goes to Spin Cycle Eternal (grey box from `art/concepts/locations/spin-cycle-laundromat-layout.jpg`). Gus (bust from his concept), DHCP hints from Walter, Dryer 4's close-up that breaks up like a bad TV signal into an empty window (`cardGone` on a prop, first look only), the lost and found and the shift logbook. The room follows `art/concepts/locations/spin-cycle-laundromat-layout-v2.jpg` now (22x16): one big room with the dryer wall along the top, washer islands, the folding table, Gus in a corner booth with a service window, and a back office (rack, desk with PC1, logbook, printer) behind a locked back door. Gus gives you the keys the first time you talk to him; the door is a `door` prop that stays solid until the story sets `open:<room>:<id>` and emits `open`. Once the network tasks are done Walter asks for `show ip dhcp binding` (a task that checks R1's command history, since that one is about looking, not live state). A second later a ghost lease (192.168.20.0, MAC 0166.6666.6666.04, Oct 14 1974 03:14 AM) statics into the R1 terminal under the real two, flickers with the lights and statics back out (`ui.ghostLine`, `TerminalView.insertAbove`). No phantom device any more. `Story.job` is whichever job is current; the work order and network clock follow it. Dev panel: **Job 2** jumps straight there, **Finish job 2** does the network work and leaves the binding check to you | `src/game/story.ts`, `rooms.ts` |
| Dialogue markup: `*word*` cold blue, `~word~` red; speaker name as a tab on the box | `src/game/markup.ts` |

**PR state:** #1 → `main`, then #2 to #6 each stacked on the one before. None are merged yet. Merge them in order, #1 first.

## Next up

### Phase 0 progress (2026-10-19)

- Added `tools/sim-server.mjs`, a Vite-backed JSON-lines child process for driving the headless simulator without changing `src/sim`.
- Added `tools/run-sim-spike.mjs`, which builds a router/switch/PC LAN, configures `R1 Gi0/0`, waits through link and spanning-tree timers, runs IOS and PC commands, and writes raw output to `harness/artifacts/sim-spike.json`.
- The spike reached `192.168.1.1` from `PC1` with 4/4 replies and 0% loss. `npm test` (115 tests) and `npm run build` pass.
- Packet Tracer 9.0.0 is installed and running, but the Windows-control layer cannot expose its window. Manual GUI copy-out is preserved at `harness/artifacts/pt-spike-manual.json`. More importantly, the first automated IPC capture succeeded: `harness/pt-script-module/Main.js` used `ipc.network()`, `getDeviceAt(0)`, and `enterCommand()` to return status code 0 plus exact `show spanning-tree` text; the raw capture is at `harness/artifacts/pt-spike-ipc.json`. The remaining Phase 0 work is connecting this Script Module to the local adapter transport.
- Added the loopback-only bridge contract in `tools/pt-bridge.mjs` and `harness/pt-bridge/README.md`. The custom web view path was blocked by Packet Tracer 9's unavailable `webView` API, so `harness/pt-exapp/` now provides the working Java ExApp path: it authenticates over PTMP, polls the bridge, executes `enterCommand()`, and posts raw results. End-to-end verification on `127.0.0.1:39092` queued `show spanning-tree` for `Switch0` and received `STATUS_OK` plus the real CLI output. `build-bridge.ps1` is the live runner; keep the Node bridge and Java bridge in separate PowerShell windows.
- Added `tools/pt-bridge-client.mjs` and `tools/run-pt-spike.mjs`. The project-side client now queues a command and polls for the result; `node tools/run-pt-spike.mjs` was verified end-to-end and wrote `harness/artifacts/pt-spike-bridge.json` with `STATUS_OK` and raw `show spanning-tree` output.
- Added `tools/pt-adapter.mjs` with reusable command, configuration-sequence, and multi-command snapshot functions. `node tools/run-pt-adapter-spike.mjs` was verified against `Switch0`; `show version`, `show ip interface brief`, `show vlan brief`, `show spanning-tree`, and `show mac address-table` all returned `STATUS_OK`, with raw output in `harness/artifacts/pt-adapter-snapshot.json`.
- Added live topology discovery through the ExApp using the reserved `__network__` adapter command. `node tools/run-pt-topology-spike.mjs` was verified through a clean bridge on `127.0.0.1:39093`: it discovered `Switch0`, `Switch1`, and `Power Distribution Device0`, captured snapshots for all three, and confirmed the two 2960 switches are CLI-capable while the power device is not. Raw output is in `harness/artifacts/pt-topology-snapshot.json`.
- Added `tools/pt-topology.mjs` and `tools/run-pt-normalized-spike.mjs`. The normalized payload preserves raw command results while exposing device identity, CLI capability, interface state, VLAN summaries, and spanning-tree data. The live run found 27 interfaces and 5 VLANs on each 2960 switch; the power device remains correctly marked non-CLI. Artifact: `harness/artifacts/pt-topology-normalized.json`.
- Added `tools/pt-config.mjs` and `tools/run-pt-config-plan.mjs`. Configuration plans are dry-run by default and write `harness/artifacts/pt-config-plan.json`; applying requires the explicit `PT_APPLY_CONFIG=true` environment flag.
- Extended live topology discovery with link endpoint records. The verified capture found the active `Switch0 0/1` and `Switch1 0/1` Ethernet-cross endpoints, both up; remote port labels are empty in Packet Tracer's exposed API, so the adapter preserves both endpoint records without guessing an edge. Link capture remains in `harness/artifacts/pt-topology-snapshot.json`.
- Added CDP neighbor capture to normalized snapshots. Both CLI switches now report one CDP neighbor, including the local/remote interface IDs and platform; the normalized artifact is `harness/artifacts/pt-topology-normalized.json`.
- Added normalized CDP adjacency edges. The live normalized run produced two directional switch adjacencies (`Switch0 0/1` and `Switch1 0/1`) with switch capability `S` and platform `2960`; because both devices still use the default hostname `Switch`, the artifact preserves the Packet Tracer device name on the source and the CDP device ID on the target rather than inventing a match.
- Added serial-number-backed device identity to discovery. The live capture now distinguishes `Switch0` (`CAT10101NZW-`), `Switch1` (`CAT1010UJ6R-`), and the power device (`PTT0810Z61P`) even though both switches share the default hostname.
- Added `tools/validate-pt-topology.mjs` as a repeatable acceptance check. It verifies the required switch/power-device invariants, allows additional end devices, checks unique serials, up link endpoints, CLI capability, and CDP presence. The live topology now includes `PC0` (four devices total) and passes all checks.
- Applied the reviewed Switch0 plan through the live bridge using the documented `enable`/`global`/blank mode contract: `interface vlan 1`, `description TTL management interface`, and `end` all returned `STATUS_OK`. `show running-config` confirmed the description in the Vlan1 stanza. The plan artifact is `harness/artifacts/pt-config-plan.json`.
- Added `tools/run-pt-config-compare.mjs` for before/after `show running-config` capture, command-status verification, and line-level added/removed configuration reporting. It was verified against Switch0; the repeat application was idempotent, with all four commands `STATUS_OK` and no additional diff. Artifact: `harness/artifacts/pt-config-compare.json`.

Phase 1 (the simulator) still has gaps:
1. Real spanning tree: BPDUs, root election, blocking, portfast and BPDU guard. This is for job 4, and the cultists sending BPDUs through wall jacks hook into it. Timers are already per VLAN per port in `devices/switch.ts`.
2. `interface range`, SSH and telnet over vty, `ip helper-address`, LLDP.
3. VTP modes, voice VLANs, `show interfaces status`.
4. A terminal program on the PC that uses the console cable.

Unverified against real gear (best recollection, check when someone has a Catalyst handy): the error text for `no interface` on a physical port, and whether a subinterface shows "administratively down" when only its parent is shut. From IOS 15 docs and memory rather than a capture (Ant's CML only runs IOL, IOS XE 17): the 2911 `show running-config` skeleton (no license udi, redundancy, Embedded-Service-Engine0/0, line 2 or scheduler lines yet) and the 2911/2960 hardware and media lines in `show interfaces`. Frame byte counts and the 5-minute rates are approximate. The 2960 keeps `Administrative Trunking Encapsulation: dot1q` and `Native VLAN tagging: enabled` (IOL says negotiate/disabled, but a 2960 only does dot1q). The setup facility isn't simulated. In Story Mode only (`IosConsole.story`, which `story.ts` turns on for R1 and S1; off by default so Sandbox Mode and automated tests see plain IOS), answering yes to the setup dialog gets angrier each time (Ant's request): the first yes looks like IOS and backs out, then the box asks again with escalating rants, a glitched prompt, an interface summary listing "You" at 192.168.1.66, and on the sixth yes it gives up ("Some changes made." while changing nothing). The console remembers, so later factory boots only accept no and say thank you. Boot doesn't print the post-boot log burst (%SYS-5-RESTART, interface logs) yet.

Phase 2 is the vertical slice. Ant picked 16 px art (drawn at 4x) and Phaser on 2026-10-18. The grey-box corner store is built (`src/game/`, branch `claude/corner-store-slice`): home base with the walkie-talkie (Walter), Gary's locked door, the job board and Bob's desk; the shop with Mrs. Finch, the register and back office PCs, the rack (console into R1 or S1) and a port panel where you can pull and replug cables. The work order ticks off from the live network. When it's all done, a phantom PC (MAC 6666.6666.6666, 192.168.1.66) plugs into S1 Fa0/24 through the wall behind the cooler and pings the register now and then, the lights flicker, and the job report's BOUNDARY INTEGRITY line fades. The town sign goes from 4,218 to 4,219 on the way home. `src/game/story.ts` holds every line and trigger. Sprites in so far: the contractor's walk and Mrs. Finch (stage 1, calm), both 16x32 sheets in `public/assets/sprites/characters/`. A prop with `sprite` set in `rooms.ts` draws that sheet's first frame instead of a grey box. The shop follows Ant's blueprint (`art/concepts/locations/mrs-finch-store-layout.jpg`): 21x14 tiles (the back wall is two tiles tall) with the hallway and back office on the left (the rack and PC1 are in the office now), fridges along the back wall with the wall jack beside them, three shelf aisles, and the counter on the right. The camera follows you in rooms bigger than the screen, and props marked `decor` block you without an E prompt. The shop's floor and walls come from `public/assets/sprites/tiles/store-tiles.png` (frame layout and weights in `rooms.ts`); Bob's office follows Ant's blueprint too (`art/concepts/locations/bobs-office-layout.jpg`): the same 21x14 shell as the store, with the corridor to Gary's padlocked door top left, Bob's own office below it (his desk with the walkie, the BELLWETHER files, the photo), and the main office with two tech-desk clusters, the incident board, a server rack (look-only for now; a home-lab candidate) and the coffee machine by the front door. It has its own linoleum floor (`office-tiles`, store walls, its own floor weights via `floor` on the room) and lights; the bulb by Gary's door flickers. Every office prop has art on the `office-props` sheet (frame list in `rooms.ts`), with files, boxes and storage borrowed from `store-decor`. Gary's door has a haunted frame (6) with tentacles through the seam, not used yet. Every store prop now has art: fridges, counter (with the CRT for PC0), rack, wall jack (roots once haunted), and the set dressing on one `store-decor` sheet of 32x80 cells (frames: 0/13/14 aisle shelves, 1-2 wall shelves, 3 desk with PC1, 4 chair, 5 files, 6-7 boxes, 8 storage, 9-10 baskets, 11 broom, 12 bins). Props with `hidden` (PC0, PC1) are drawn by another prop's sprite. The store is dark with lamp pools (`lights` on the room). Dialogue shows a portrait for speakers listed in `PORTRAITS` in `ui.ts`, picked by `mood` on a line (0 calm, 1 paranoid, 2 frantic). Ant chose illustrated busts that stand over the dialogue box; Mrs. Finch has one (mood 0, cut from `art/concepts/characters/mrs-finch-dialogue-concept.jpg` by `art/source/portraits/make-bust.py`). Moods without a bust fall back to her 64 px pixel portraits, so paranoid and frantic busts still need drawing. Every line today is mood 0, which fits her denial in job 1. Walter's bust is his radio (you only ever hear him), and the contractor, Simone, has a bust registered as `SIMONE` for when she gets lines. Sound is all generated live in `src/game/audio.ts` (Web Audio, no files): tube hum in both rooms, the fridges' rustle and whispers in the store (louder near the fridges and the wall jack, and after the haunt), a crackle whenever a flickering lamp stutters, a beating drone once haunted, a throb behind Gary's door, and walkie squelch and static on Walter's lines. It starts on the Click to play click; M mutes. Real recorded sounds (footsteps, chains, knocks) are still to come, planned for `audio/source` and `public/assets/audio` with a credits file. The walkie on the office floor is a sprite that switches to an empty charger the moment you pick it up (story emits `walkie`). Mrs. Finch stands behind the counter but doesn't walk yet; her stage 2 and 3 versions aren't drawn. Still to do: the rest of Ant's sprites (spec in the shared `design/art-spec-corner-store.md`, PNGs land in the shared `art/` folder), the home lab, a sanity meter, sound, and saving progress.

## Open questions for Ant

- Art style. Ant likes Welcome to Elderfield and is collecting reference screenshots. Who makes the art is also undecided: AI, asset packs or an artist.
- Story beats per job, and where automation topics go on the job ladder.
- Whether to keep building simulator depth first or start the Phase 2 slice next.
- **Cult books for the know-only CCNA topics** (Ant loves this; still to brainstorm). Bookshelves and books you can read that teach concepts you understand rather than configure, written as cult and horror texts. The library (job 4) is the natural home, with strays elsewhere (a hymnal at the funeral home, a field manual in Gus's office). Reading one could add a lore entry to the grimoire, so the concepts are collectible and reviewable for real study. Seeds so far:
  - *The Seven Floors*: the OSI model as a seven-layer descent. Each floor up, the message forgets more of what carried it. It still teaches what each layer does and encapsulation.
  - NTP strata as keepers of time: "Stratum 0 is the source. No one has seen it." It could tie into Gus being stuck in 1974 because his clock synced to the wrong source.
  - JSON as a summoning grammar: braces bind, keys name, values give. "Name a thing without quotes and it will not answer." It sets up Cryptis and the controller.
  - TTL, the game's title: packets that live a fixed number of hops and die, and the ones that don't. Save it for late in the game.
  - Other know-only topics from Hermes's CCNA split: SDN and controllers, REST APIs, AAA (RADIUS/TACACS+), SNMP (MIBs, traps), syslog severity levels, QoS concepts, wireless architecture, threat types.

## Job ladder

| # | Job | CCNA topics |
|---|---|---|
| 1 | Corner store | Static IPs, hostname, passwords, interface IPs, `no shutdown` |
| 2 | 24-hour laundromat | DHCP on the router, a networked printer |
| 3 | Dentist's office | VLANs, trunks, router-on-a-stick |
| 4 | Library | Layer 3 switch, STP, EtherChannel |
| 5 | Funeral home and crematorium | Two sites, a WAN link, static routes, SSH (you can't be at both sites, so this is where remote access is earned; see `docs/noc-and-remote-access.md`) |
| 6 | Town hall and sheriff | OSPF, ACLs |
| 7 | Community radio station | NAT/PAT, wireless |
| 8 | Hospital | Port security, HSRP, syslog/NTP |
| 9 | The Void-View Hotel | Everything, IPv6, fixing someone else's broken network |
