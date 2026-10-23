# Handoff: where Time To Live is

Read this first if you're picking up the project, human or AI. Update it whenever you finish something or change a plan.

Last updated: 2026-10-23.

## Latest handoff update (2026-10-23, Claude)

- **Sound files** the game plays live in `public/assets/sound/`, by where they play
  (`music/`, `ui/`, `office/`), and its README lists each one, where it plays, its volume
  setting and its source. Only files in use go there; agy's unused drafts are still in
  `public/assets/audio/`. Paths are set at the top of `src/game/audio.ts`.
- **Music:** rooms can have a looping track (`MUSIC` in `src/game/audio.ts`). Bob's office
  plays take 6 of Bob's theme (`music/bobs-office-theme-loop.mp3`, copied from
  `art/music/`). `MUSIC_LEVEL` is 0.1: Ant found 0.35 drowned out the hum and flickers.
  `art/music/` is uncommitted.
- **Gary's door bang:** talking to Gary plays `office/gary-door-bang.mp3` (`audio.garyBang`),
  the first second of a Pixabay door bang. Check its license before release.
- **Job 4 (Library) sim fixes done.** Codex's 2a3b3dd (Packet Tracer rerun on the
  Switch0 Fa0/5 ↔ Switch1 Fa0/3 cable) and 7ede0e6 (the A–J fixes) were reviewed by
  Claude and pushed. A bundle survives a dead member (`(P)`/`(D)`), STP sees one `Po`,
  non-forming pairs are `(I)`/`Po(SD)`, the misconfig guard defaults on, the L3 switch
  takes `ip route`, routed ports print `no switchport`, and routed Port-channels work.
  `channel-group` now lives on the interface config, not the switchport. Open question:
  `channelMemberState` returns `(s)` for LACP facing PAgP; real IOS probably shows
  stand-alone `(I)` there, since neither side negotiates. Check in CML.
- **Walter's walkie** squelches open once when he starts talking and closes (longer
  tail, falling chirp) when another speaker, the end of the talk or a screen takes over,
  instead of keying per line (`audio.walkie`, `Ui.advance`).
- **Typing sound:** soft key clicks loop while a dialogue line types out and stop when
  it's all on screen (`audio.typing`, called from `Ui.renderLine`). The file is
  `public/assets/sound/ui/dialogue-typing-loop.mp3`, a copy of agy's
  `art/music/ui-sfx/dialogue-typing-soft-muted.mp3`. Level is `TYPING_LEVEL` (0.5).
- **Audio direction for agy** is in `docs/audio-direction.md`: cosmic horror over
  Dungeon Crawler Carl, Silent Hill first, lo-fi drums with a Night Vale feel, walkie
  static for Walter, metal door banging for Gary.
- `script/dialogue.md` starts with a cheat-sheet table of everything you can write.
- Run the game at `http://localhost:5173/game.html` (`/` is the bench terminal).

## Latest handoff update (2026-10-22, Phase 5)

- Implemented simulator-only STP fixes: IOS `show spanning-tree` variants,
  PortFast defaults and interface detail, BPDU Guard err-disable/recovery, and
  Root Guard inconsistent-port recovery.
- Implemented `show ip dhcp server statistics` with message and binding
  counters. Re-ran the STP and DHCP simulator research harnesses.
- Tests: 26 files, 226 tests passed; production build passed. Commits are
  `e25e655`, `d25ae8c`, `1edf8fb`, `601a1c0`, `43b3273`, `23f7ecb`, and
  `62cbfc7`.

## Latest handoff update (2026-10-22, Codex)

- Corrected the DHCP and STP reports to use real IOS 15 as the reference, with
  Cisco command/configuration sources, reclassified discrepancies as
  `sim-wrong`, `pt-limitation`, `both-missing`, or `needs-cml`, and added
  priority fix lists. CML was not reachable from this host.
- The clean PT relay rerun required adding a routed far LAN through the GUI:
  Router1 Gi0/1 was connected to a new 2960 switch and PC3 on the new segment.
- The routed segment is physically verified and PC3 was switched to DHCP in
  the PT GUI. The final paced capture recorded a relay lease of `10.99.0.11`,
  a zero-usable-address exhaustion pool, and PT APIPA
  `169.254.161.183/16` with gateway `0.0.0.0`. Temporary configuration was
  then removed; Router1 Gi0/1 is administratively down with no address and
  Router0's DHCP section is empty.

## Latest handoff update (2026-10-22, Codex)

- Completed the DHCP Packet Tracer versus simulator research capture. Raw
  observations are in `harness/artifacts/dhcp-research-pt.json` and
  `harness/artifacts/dhcp-research-sim.json`; the discrepancy report is
  `docs/dhcp-research.md`.
- The capture covered pool/exclusion, PC renew/release/all, bindings/pools/
  conflicts/statistics/running-config, clears, relay, exhaustion, wrong
  gateway, APIPA, snooping trust/bindings, and `?`/completion.
- Restored the temporary PT DHCP/helper/snooping configuration and reverified
  the VLAN/routing gateways. PT bridge terminal-history contamination around
  some PC commands is recorded as a research observation, not normalized away.

## Latest handoff update (2026-10-22, Codex)

- Cold-started the PT stack after the reboot. The launcher reported the ExApp
  connected; `npm run pt:status` returned `ready: true`, `poller: "connected"`,
  and `pending: 0` on bridge `http://127.0.0.1:39094`.
- Fresh discovery found the rebuilt nine-device lab: Switch0/1/2, Router0/1,
  PC0/1/2, and the power device. Raw and normalized topology artifacts were
  refreshed.
- Updated `tools/run-pt-live-expanded-config.mjs` for the real ports and both
  routers. The live apply reported zero failures on all five network devices;
  all three PCs exchanged verified ping replies after STP convergence.
- Added the raw PT STP capture at `harness/artifacts/stp-research-pt.json`,
  the sim capture remains `harness/artifacts/sim-stp-scenario.json`, and the
  discrepancy report is `docs/stp-research.md`.
- Full loop-dependent STP cases remain blocked until the live Packet Tracer
  topology has a redundant switch link/BPDU source added through the GUI.
- Anthony added `Switch0 Fa0/4` to `Switch2 Fa0/5`; discovery verified both
  endpoints up. The STP capture now includes 48 PT observations covering
  equal-priority MAC tie-break, path cost, root guard, PortFast, command
  variants, and redundant-link failure. Only BPDU-Guard err-disable (no BPDU
  source) and intentionally disruptive STP-mode mismatch remain blocked.
- Anthony added Switch3 on `Switch2 Fa0/6`; the BPDU Guard run captured
  `Fa0/6 err-disabled` with a superior VLAN 10 BPDU. The temporary test port
  was shut down and its guard settings were removed. Only mismatched STP mode
  injection remained; it has now been captured and restored as well. The PT
  STP artifact contains 55 observations and no blocked experiments.

## Latest handoff (2026-10-22)

- Fixed automatic Packet Tracer bridge discovery when the default `39094`
  listener is unreachable; `npm run pt:status` now discovers
  `http://127.0.0.1:39095` and reports `ready: true`, `poller: "connected"`,
  and `pending: 0`.
- Updated the shared bridge client to use the same replacement-port discovery,
  so the live config scripts work with the current `39095` bridge.
- Clean-reset Switch0, Switch1, and Router0 through the live CLI bridge with
  erase/reload, ran the existing expanded config once, and recorded the clean
  STP/ARP convergence evidence in `docs/PT_PC0_STATUS.md`. The `.pkt` file was
  not touched. Packet Tracer's ExApp did not return delayed PC ping reply
  lines, so the note records that capture limitation explicitly.
- Added `tests/pt-stack-health.test.ts` covering replacement-port discovery.
- Validation complete: `npm run audit:network` returned `"ok": true` for 12
  artifacts, `npm test` returned `26 passed` and `207 passed`, and
  `npm run build` completed the Vite production build successfully.

## The game in one paragraph

Time To Live is a 2D top-down horror game set in Static Springs, a Night Vale style town. You're a network contractor for Bob's Bandwidth & Bloodletting. Each job is a strange local business that needs a network, and you bring the gear, cable it and configure it with a command line that behaves exactly like Cisco IOS. The jobs climb the CCNA 200-301 curriculum, from a corner store with static IPs to The Void-View Hotel. Network attacks are the hauntings. The full design doc lives outside the repo in the project's shared files at `design/design-doc.md`. Ask Ant for it if you can't reach it.

## People and rules

- **Story so far:** the mentor is Walter, job 1's client is Mrs. Finch, and Bellwether is the neighboring town that vanished but still answers pings. See the design doc.
- **Owner:** Ant (GitHub Anthonydcobb). Ant is studying for the CCNA and makes the design calls. Ask before changing anything in the design.
- **The CLI must match real IOS:** same modes, abbreviations, `?` help, errors and show output. When unsure, copy real IOS 15 output.
- **The simulation is real, not answer checking.** Frames actually move. Work orders check live network state, never typed commands.
- **Never say "Cisco" in game branding.** Devices are made by Cryptis Systems (the CR-2911 router and CS-2960-24TT switch).
- **Incantations:** commands are learned like RPG skills. Each new job's scenario lists what it teaches. Unlearned commands still work when typed, by design.
- **Dialogue lives in `script/dialogue.md`**, written like a play (`WALTER: ...`, `> narration`, `(notes)`), and Ant edits it directly. `story.ts` only decides when a scene plays and asks for it by name (`scene("photo")`, or `pick("gary-tips", n)` for idle chatter). Add new lines to the script, never inline in code. Under `npm run dev` a save swaps the lines in without reloading the game; `tests/script.test.ts` fails if a scene the story asks for is missing or a line can't be read. The parser is `src/game/script.ts`. Ant leaves **`((notes))` for Claude** anywhere in the script (the game strips them; the dev panel counts them). When asked to "check the script", work through them and delete or answer each one in place. Unknown `#tags` like `#idea ...` are notes too. **Story tags** (`#set`/`#clear`/`#give flag`, `#if [not] flag` ... `#else` ... `#end`, `#goto scene`) run from the script against the story's own flags. Prefer them over flag checks in `story.ts` for anything that only changes what's said.
- **`script/lexicon.md` is the cosmic-horror vocabulary** Ant collected: about 110 words, each tied to something in the game. Use it for the grimoire (Ant's favourite home for these: incantations, margin notes, cult books) and for dialogue. Keep to one word per scene, inside a plain sentence, and tie each word to something technical. Standouts that are real IOS: `Null0` (a void you route into), ping's `!!!!!` litany, `enable password` (profane) against `enable secret`.
- **Cables:** any Ethernet cable links any two Ethernet ports, since auto-MDIX is assumed. Ant dropped straight-through vs crossover on purpose. Console cables only fit console ports.
- **Never commit `art/inspiration/`** (another studio's art, and the repo is public) or `art/concepts/characters/dialouge box.jpg`. agy's grimoire concepts are committed under `art/concepts/grimoire/`; the copies in `art/concepts/items/` are duplicates, so leave them out. When agy's final grimoire cover lands, rerun `art/source/grimoire/cut-cover.py` to recut the close-ups.

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
| Job 2 in the game: after the store, work order #0002 goes up on the board and the van goes to Spin Cycle Eternal (grey box from `art/concepts/locations/spin-cycle-laundromat-layout.jpg`). Gus (bust from his concept), DHCP hints from Walter, Dryer 4's close-up that breaks up like a bad TV signal into an empty window (`cardGone` on a prop, first look only), the lost and found and the shift logbook. The room follows `art/concepts/locations/spin-cycle-laundromat-layout-v2.jpg` now (22x16): one big room with the dryer wall along the top, washer islands, the folding table, Gus in a corner booth with a service window, and a back office (rack, desk with PC1, logbook, printer) behind a locked back door. Gus gives you the keys the first time you talk to him; the door is a `door` prop that stays solid until the story sets `open:<room>:<id>` and emits `open`. Once the network tasks are done Walter asks for `show ip dhcp binding` (a task that checks R1's command history, since that one is about looking, not live state). A second later a ghost lease (192.168.20.0, MAC 0166.6666.6666.04, Oct 14 1974 03:14 AM) statics into the R1 terminal under the real two, flickers with the lights and statics back out (`ui.ghostLine`, `TerminalView.insertAbove`). No phantom device any more. Every laundromat prop has art on the `laundromat-props` sheet (48x64 cells, drawn by `art/source/props/make-laundromat-props.py` from agy's sprite concept; frame list in the script). Dryer 4 is the bottom of its stack, black glass with an OUT OF ORDER note; the lost & found carton is part of the folding table; a `door` prop can take a `sprite`. Gus has a 16x32 walk sheet (`gus-walk.png`, drawn by `art/source/characters/make-gus.py` from agy's walk concept) and walks his rounds: out of his booth's new bottom door, past the change machine, a four-second stare at Dryer 4, around the washers and back to his window. Any prop can walk a loop (`walk` in `rooms.ts`: stops, pauses, which way to face); walkers stop and turn to you while dialogue is open, and the E prompt follows them. Headless Chrome with `--virtual-time-budget` doesn't run Phaser's loop, so check movement in real time. The front door is Spin Cycle's own (frame 16: OPEN 24 HRS neon, a taped crack). `Story.job` is whichever job is current; the work order and network clock follow it. Dev panel: **Job 2** jumps straight there, **Finish job 2** does the network work and leaves the binding check to you | `src/game/story.ts`, `rooms.ts` |
| Every line of dialogue moved out of `story.ts` into `script/dialogue.md`, a Markdown script Ant can edit; saving it hot-swaps the lines into the running game | `script/dialogue.md`, `src/game/script.ts` |
| Script notes `((...))` for Claude, and story tags `#set` `#clear` `#give` `#if`/`#else`/`#end` `#goto`; Walter's walkie follow-ups after Gary and the logbook now use `#if walkie` in the script | `src/game/script.ts`, `script/dialogue.md` |
| The laundromat printer opens as a printer, not a monitor: the same NetOS screen, smaller, in a yellowed Cryptis PrintStation 4L with a paper tray, a test page in the output slot and READY/DATA/ERROR lights (`openLaptop(..., { printer: true })`, `#pc.printer` in `game.css`) | `src/game/pc-screen.ts` |
| Dialogue markup: `*word*` cold blue, `~word~` red; speaker name as a tab on the box | `src/game/markup.ts` |
| The Fa0/24 apparition shows Ant's painted being (`art/concepts/characters/incomprehensible-being-concept.jpg`) in four stages, one per job: the ghost in the wire (job 1), the signal swell (from the end of job 2), the entropy spread and the unmaking (for jobs 3 and 4). Cut to `public/assets/apparition/being-N.webp` by `art/source/apparition/cut-being.py`: flat greys go black and an oval fade replaces the outline, so it's a darkness in the static with only its light parts showing. Stages 1 and 3 are pushed darker than painted (`TONE` in the script; Ant found them too bright). Torn into slipped bands each time; the glimpses come closer each time, ending pressed against the glass and then one stray frame, and a faint afterimage lingers over the room. `ui.beingStage` picks the stage; dev panel **Being N/4** plays each | `src/game/apparition.ts` |
| The grimoire is a book you carry (G). Back at Bob's after job 2, Walter sends you to Bob's bottom drawer; the cover's eyes are dark, tear open through static for a moment and go dark again (`ui.glimpse`, close-ups cut from agy's `art/concepts/grimoire/grimoire-cover-concept.jpg` by `art/source/grimoire/cut-cover.py`; rerun it when agy's final cover lands). Four tabs, after agy's open-book concept: **Incantations** (each job's commands as worked rituals with margin notes, written in once you take that job; `RITUALS`), **Found Notes** (every note you've read is pinned in, including ones read before you had the book; `NOTES`, added by `Story.note`), **Topology** (a pen sketch of each site from its live network: pencil until a device has an address, a line per plugged-in cable, and anything not on the job's list, like the thing in the store's wall, runs off the page), and **Site Logs** (a stamped page per finished job and what was wrong there). Pages paginate themselves; ← → turn, 1–4 switch tabs. Closing it the first time shows the end-of-slice card. Dev panel **Grimoire** skips to the drawer. Cult books for the know-only topics could add a lore tab here | `src/game/grimoire-book.ts`, `story.ts` |

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

Phase 2 is the vertical slice. Ant picked 16 px art (drawn at 4x) and Phaser on 2026-10-18. The grey-box corner store is built (`src/game/`, branch `claude/corner-store-slice`): home base with the walkie-talkie (Walter), Gary's locked door, the job board and Bob's desk; the shop with Mrs. Finch, the register and back office PCs, the rack (console into R1 or S1) and a port panel where you can pull and replug cables. The work order ticks off from the live network. When it's all done, a phantom PC (MAC 6666.6666.6666, 192.168.1.66) plugs into S1 Fa0/24 through the wall behind the cooler and pings the register now and then, the lights flicker, and the job report's BOUNDARY INTEGRITY line fades. The town sign goes from 4,218 to 4,219 on the way home. `src/game/story.ts` holds every line and trigger. Sprites in so far: the contractor's walk and Mrs. Finch (stage 1, calm), both 16x32 sheets in `public/assets/sprites/characters/`. A prop with `sprite` set in `rooms.ts` draws that sheet's first frame instead of a grey box. The shop follows Ant's blueprint (`art/concepts/locations/mrs-finch-store-layout.jpg`): 21x14 tiles (the back wall is two tiles tall) with the hallway and back office on the left (the rack and PC1 are in the office now), fridges along the back wall with the wall jack beside them, three shelf aisles, and the counter on the right. The camera follows you in rooms bigger than the screen, and props marked `decor` block you without an E prompt. The shop's floor and walls come from `public/assets/sprites/tiles/store-tiles.png` (frame layout and weights in `rooms.ts`); Bob's office follows Ant's blueprint too (`art/concepts/locations/bobs-office-layout.jpg`): the same 21x14 shell as the store, with the corridor to Gary's padlocked door top left, Bob's own office below it (his desk, the walkie on its side table, the BELLWETHER files, the photo), and the main office with two tech-desk clusters, the incident board, a server rack (look-only for now; a home-lab candidate) and the coffee machine by the front door. It has its own linoleum floor (`office-tiles`, store walls, its own floor weights via `floor` on the room) and lights; the bulb by Gary's door flickers. Every office prop has art on the `office-props` sheet (frame list in `rooms.ts`), with files, boxes and storage borrowed from `store-decor`. Gary's door has a haunted frame (6) with tentacles through the seam, not used yet. Every store prop now has art: fridges, counter (with the CRT for PC0), rack, wall jack (roots once haunted), and the set dressing on one `store-decor` sheet of 32x80 cells (frames: 0/13/14 aisle shelves, 1-2 wall shelves, 3 desk with PC1, 4 chair, 5 files, 6-7 boxes, 8 storage, 9-10 baskets, 11 broom, 12 bins). Props with `hidden` (PC0, PC1) are drawn by another prop's sprite. The store is dark with lamp pools (`lights` on the room). Dialogue shows a portrait for speakers listed in `PORTRAITS` in `ui.ts`, picked by `mood` on a line (0 calm, 1 paranoid, 2 frantic). Ant chose illustrated busts that stand over the dialogue box; Mrs. Finch has one (mood 0, cut from `art/concepts/characters/mrs-finch-dialogue-concept.jpg` by `art/source/portraits/make-bust.py`). Moods without a bust fall back to her 64 px pixel portraits, so paranoid and frantic busts still need drawing. Every line today is mood 0, which fits her denial in job 1. Walter's bust is his radio (you only ever hear him), and the contractor, Simone, has a bust registered as `SIMONE` for when she gets lines. Sound is all generated live in `src/game/audio.ts` (Web Audio, no files): tube hum in both rooms, the fridges' rustle and whispers in the store (louder near the fridges and the wall jack, and after the haunt), a crackle whenever a flickering lamp stutters, a beating drone once haunted, a throb behind Gary's door, and walkie squelch and static on Walter's lines. It starts on the Click to play click; M mutes. Real recorded sounds (footsteps, chains, knocks) are still to come, planned for `audio/source` and `public/assets/audio` with a credits file. The walkie stands on a side table by the armchair in Bob's office (the table is part of its 16x32 sprite) and switches to an empty charger the moment you pick it up (story emits `walkie`). Picking it up kills the lights (`blackout`: a stutter, then black, with input held by `ui.hold`); in the dark Walter shouts at Gary and Gary says he was only saying hello, then the lights stutter back (`lights`) under a faint hiss (`audio.hiss`) and Walter starts his welcome as if nothing happened. Bob's nameplate is gone from the desk sprite; the desk close-up card still shows it. Mrs. Finch stands behind the counter but doesn't walk yet; her stage 2 and 3 versions aren't drawn. Still to do: the rest of Ant's sprites (spec in the shared `design/art-spec-corner-store.md`, PNGs land in the shared `art/` folder), the home lab, a sanity meter, sound, and saving progress.

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
