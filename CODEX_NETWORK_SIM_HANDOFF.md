# Codex handoff: testing the Time To Live network simulator against Packet Tracer

Audit date: 2026-10-19. Code audited: branch `claude/corner-store-slice` at commit `c096a02` (the tip of the stacked PRs #1 to #7, none merged yet). Nothing in the repo was changed for this audit.

How to read this document. Every claim carries a tag:

- **[V] Verified**: read in the code or confirmed by running it during the audit.
- **[A] Assumption**: believed true but not checked. Check it before building on it.
- **[R] Recommendation**: a suggested design, not a fact.

File references are `path:line` against that commit.

---

## 1. Summary

1. **[V] The networking engine is already a pure, headless TypeScript library.** It lives in `src/sim/` with no DOM imports. It runs under Node through Vitest today: 112 tests pass in about 1 second. An external harness can drive it without touching the game UI.
2. **[V] Time is virtual and deterministic.** One `Clock` per `Network` (`src/sim/clock.ts`) holds an ordered event queue. Tests jump time with `clock.advance(ms)` or `clock.runUntil(deadline, done)`. The engine never calls `Math.random`, `Date.now` or `performance.now`.
3. **[V] The CLI is a single callable per device.** Use `device.console.input(line)`, `.help(line)` for `?`, `.complete(line)` for Tab, and `.ctrlZ()`. Each returns plain string lines. Long-running commands such as ping return a `Job` that streams text as simulated time advances.
4. **[V] Story features barely touch the engine.**
   - The rune grimoire is the only story hook inside `src/sim`. It only changes how `?` help and Tab render, and it is off when `console.grimoire` is `null`.
   - The haunting adds a real PC to the network through the public API.
   - The supernatural setup-wizard reactions are not built yet.
5. **[V] Real STP does not exist yet**, and that matters most for the first research topic.
   - The switch runs fixed 15 s listening and 15 s learning timers per VLAN per port.
   - There are no BPDUs, root election, port roles, costs, blocking or topology changes, and no `show spanning-tree`.
   - A physical loop in the simulator gives a broadcast storm with every port forwarding. I confirmed this with a three-switch triangle: 196 frames arrived on one port in 50 ms of simulated time.
   - So STP research will mostly produce "missing" discrepancies until STP is built. That is fine, because the research is meant to come before the fix.
6. **[V] There is no topology import or export format.** Topologies are TypeScript functions that call `new Router()`, `net.connect()` and so on. There is no separate Sandbox mode yet either.
   - The bench page (`index.html`) is the closest thing to a sandbox, but it turns the grimoire on too (`src/web/main.ts:36`).
   - The headless engine with `grimoire = null` is the true unrestricted engine.
7. **[A] Packet Tracer is the hard half.** It has no official CLI automation API that I could confirm. The realistic routes are PT 8 Script Modules (JavaScript inside PT, such as the community PTBuilder and packet-tracer-mcp projects) or GUI automation.
   - Sending commands and building topologies through Script Modules is shown by those projects.
   - Reading back exact CLI output is **not** confirmed. Prove that in a spike before building anything else.
8. **[R] Project context the harness should respect.**
   - Ant already treats Packet Tracer as a weak fidelity source and captures real IOS from CML (IOL, IOS XE 17).
   - The game targets IOS 15 text on a 2911 and a 2960. Packet Tracer uses those same models, which is its real advantage.
   - Make the harness backend-agnostic (Packet Tracer, CML, and later others), and tag every observation with its source.

---

## 2. Architecture

### 2.1 Stack [V]

| Piece | Version (package.json) | Used for |
|---|---|---|
| TypeScript | ^5.9.3, strict, ES2022, `moduleResolution: Bundler` | everything |
| Vite | ^8.3.4 | dev server and build. Two pages: `index.html` (the bench) and `game.html` (the game) |
| Vitest | ^5.0.5 | unit tests, which run on Node 22 |
| @xterm/xterm, @xterm/addon-fit | ^6.0.0, ^0.11.0 | terminal widget (`src/web/terminal.ts`) |
| Phaser | ^3.90.0 | game rooms (`src/game/`) |

Commands: `npm test`, `npm run build` (runs `tsc --noEmit` and then `vite build`), `npm run dev`. There is no Electron yet.

Repo rules (`AGENTS.md`):
- `src/sim` stays free of DOM code.
- Every simulator change gets a test.
- Output matches real Cisco IOS.
- The word "Cisco" is never used in game branding.
- `HANDOFF.md` is updated when work finishes.

### 2.2 Layout [V]

```
src/sim/            THE ENGINE. No DOM. Pure TS.
  clock.ts          virtual time + event queue
  network.ts        Network, Device (abstract), Port, cabling, link/protocol timing, frame transmit
  frames.ts         Frame, ARP, IPv4/ICMP, DHCP, CDP payload types; 802.1Q retag()
  addr.ts           IPv4/MAC helpers, nextMac() allocator
  ipstack.ts        shared L3 stack: ARP, routing table (C/L/S), ICMP, ping probes
  dhcp.ts           IOS DHCP server (with ping check + conflicts) and Windows-style client (APIPA)
  vlans.ts          VLAN list parse/format, default VLANs, SVI/subinterface name helpers
  tools.ts          IOS ping/traceroute and Windows ping/tracert as streaming Jobs
  job.ts            Job: streaming output, finish, abort
  grimoire.ts       STORY HOOK: learned "incantations" + toRunes() cipher
  devices/
    ios-device.ts   IosDevice base: config, console, CDP, save/erase/reload, log timestamps
    router.ts       Router "CR-2911": Gi0/0-2, subinterfaces, static routes, DHCP server
    switch.ts       Switch "CS-2960-24TT": Fa0/1-24, Gi0/1-2, VLAN db, DTP, STP timers, MAC table, SVIs
    pc.ts           Pc: one NIC (Fa0), RS-232 console port, static/DHCP addressing
  ios/
    parser.ts       generic IOS-style token parser: prefixes, args, ?, Tab, caret errors
    commands.ts     the command table per mode (`commandsFor(mode, kind)`)
    console.ts      IosConsole: modes, prompts, pending questions/passwords, pipes, boot, setup dialog
    show.ts         every show command's output text
    config.ts       IosConfig data model (what running-config prints)
    passwords.ts    type 5 / type 7
  pc/shell.ts       PcShell: ipconfig, ping, tracert, arp -a
  scenarios/        job topologies (corner-store, laundromat, dentist) + JOBS list
src/web/            the bench page (topology diagram, tabs, xterm terminals, work order)
src/game/           the game: Phaser rooms, dialogue/laptop UI, story.ts (script + haunting)
tests/              Vitest: cli, network, depth, dhcp, vlans, topology, grimoire, captures
```

### 2.3 Layer separation [V]

```
src/game (story, Phaser, UI) ──┐
                               ├──> src/web/terminal.ts (xterm Session wrapper) ──> src/sim
src/web  (bench UI)  ──────────┘                                                   ^
tests/ (Vitest, Node) ─────────────────────────────────────────────────────────────┘
```

- Dependencies only point into `src/sim`. Nothing in `src/sim` imports from `src/web` or `src/game`.
- The one exception is the story concept that lives inside the engine: `src/sim/ios/parser.ts:3` imports `toRunes` from `src/sim/grimoire.ts`, and `IosConsole` holds an optional `grimoire`. See §6.
- The game and the bench advance the clock from `requestAnimationFrame` with a 1 s cap per frame (`src/game/main.ts:32`, `src/web/main.ts:62`). Tests advance it by hand.

---

## 3. The networking engine

### 3.1 Device state [V]

- **`Network`** (`src/sim/network.ts:150`) owns `clock` and `devices[]`. The main methods:
  - `add(device)` at :154
  - `device(id)` at :161
  - `connect(a, b, cable = "ethernet")` at :171
  - `disconnect(port)` at :184
  - `transmit(from, frame)` at :260
- **`Port`** (`network.ts:13`) holds:
  - the cabling: `peer` and `cable`
  - link state: `linkUp`, `protocolUp` and `negotiating`
  - counters for `show interfaces`: `stats`
  - identity: `name`, `shortName`, `mac` and `kind` (`ethernet` or `console`)
  - `adminDown`, which is read from the owning device's config
- **`IosDevice`** (`devices/ios-device.ts:36`) holds:
  - the configuration: `config: IosConfig` (the running config) and `startup: IosConfig | null`
  - housekeeping: `dirty`, the config timestamps and `cdpNeighbors`
  - `console: IosConsole`
  - `stack: IpStack`
- **`IosConfig`** (`ios/config.ts:66`) is plain JSON-able data: hostname, secrets, banner, interfaces (including `switchport` and subinterface `encapsulation`), lines, static routes, default gateway and DHCP pools. **[V]** `cloneConfig()` exists at `config.ts:108`, which makes it the natural snapshot point.
- **`Switch`** adds:
  - the VLAN database: `vlans`, which lives outside the config like `vlan.dat`
  - the MAC table: `macTable`, with 300 s aging
  - per-port per-VLAN STP start times: `stpSince` (private)
  - SVI autostate
- **`Router`** adds subinterfaces and `dhcp: DhcpServer`.
- **`Pc`** has these fields: `nic` (Fa0), `rs232`, `stack`, `shell` and `dhcpClient`. Its methods are `configure(ip, mask, gw)` and `useDhcp()`.
- **MAC addresses** come from a module-level counter, `nextMac()` (`addr.ts:66`). So MACs depend on construction order and on everything built earlier in the same process. `resetMacAllocator()` exists (`addr.ts:71`) but nothing calls it. **[R]** The harness should call it before each experiment so MACs are reproducible.

### 3.2 Commands: parsing and running [V]

1. `IosConsole.input(line)` (`ios/console.ts:161`) handles the line.
   - If a question, password, banner or "press RETURN" is pending, the line answers that instead.
   - Otherwise it goes to `run()`, which splits off `| include|exclude|begin|section|count` on show commands.
2. `commandsForLine()` (:315) picks the command list for the current mode, or uses the exec list for `do ...`.
3. `parse()` (`ios/parser.ts:178`) walks the tokens:
   - keywords match by unique, case-insensitive prefix
   - typed `Arg`s supply `match`, `completions` and `caretAt`
   - the result is `ok`, `invalid` (with a caret column), `incomplete`, `ambiguous` or `empty`
4. In a sub-mode, an unknown command is retried as a global config command, like real IOS (:369).
5. On `ok`, the console marks the config dirty and runs the command's `run(ctx, args)`. Handlers write to `ctx.out`, and may set `ctx.job` for streaming output.
6. Errors are formatted in `reportError()` (:392):
   - the caret line plus `% Invalid input detected at '^' marker.`
   - `% Incomplete command.`
   - `% Ambiguous command:  "x"`
   - an unknown single word in exec mode becomes the IOS "Translating ...domain server" lookup. That lookup is a 5 s Job unless `no ip domain-lookup` is set.

The command table is `src/sim/ios/commands.ts`. It is split into `showCommands` :189, `execCommands` :224, `exitEnd` :261, `configCommands` :308, `interfaceCommands` :426, `lineCommands` :492, `dhcpCommands` :579 and `switchCommands` :736, and `commandsFor(mode, kind)` is at :890.

### 3.3 How devices exchange information [V]

- Frames are real objects: `{src, dst, vlan?, payload}`, where the payload is ARP, IPv4 (carrying ICMP or DHCP) or CDP.
- `Network.transmit` schedules delivery to the peer after `HOP_DELAY_MS = 0.25` ms. It only does this when both ends have line protocol up, and it updates the counters.
- **Switch** (`devices/switch.ts:374`):
  - CDP is consumed and never forwarded.
  - Ingress VLAN rules: an access port drops tagged frames, and an untagged frame on a trunk goes to the native VLAN.
  - Spanning-tree state gates the port: a port in listening drops frames, and a port in learning learns MACs but doesn't forward.
  - Known unicast is forwarded and everything else is flooded. Egress tags every VLAN except the native one.
- **Router** (`router.ts:170`): a tagged frame goes to the matching `encapsulation dot1Q` subinterface. Untagged goes to the native subinterface, or to the physical port.
- **DTP** is evaluated, not exchanged. `Switch.operationalMode()` (`switch.ts:176`) reads the peer switch's config directly to decide trunk or access. No DTP frames exist. The same goes for STP: no BPDUs exist. The background "BPDU" and keepalive ticks only move the counters (`network.ts:277`).
- **CDP** is real frames every 60 s, with a 180 s holdtime. A native VLAN mismatch logs `%CDP-4-NATIVE_VLAN_MISMATCH`.

### 3.4 Time, timers and state changes [V]

These constants were measured in Ant's CML captures where noted:

| Event | Constant | Where |
|---|---|---|
| Ethernet autonegotiation before the link comes up | 2000 ms | `network.ts:143` |
| Line protocol after the link | 1000 ms (CML) | `network.ts:145` |
| Line protocol bounce when a port changes between access and trunk | 3000 ms (CML) | `network.ts:148` |
| STP listening, then learning, per VLAN per port | 15 s + 15 s | `switch.ts:22-23` |
| MAC aging | 300 s | `switch.ts:16` |
| CDP interval and holdtime | 60 s / 180 s | `ios-device.ts:33-34` |
| Keepalive tick, BPDU-counter tick | 10 s / 2 s | `network.ts:85,87` |
| DNS lookup on a typo | 5 s | `console.ts:40` |
| DHCP server ping check; client backoff | 2 × 500 ms; 4/8/16/32 s | `dhcp.ts:22-23,247` |

- Unsolicited console messages (`%LINK`, `%LINEPROTO`, `%SYS`, `%CDP`) are pushed through `device.onOutput(listener)`. They are stamped with the virtual clock, `*Mar  1 00:00:12.345: ` (`ios-device.ts:203`).
- Because the queue is ordered by `(at, insertion order)`, the same inputs give the same event order every run. **[V]** The engine is deterministic apart from the MAC counter (§3.1).

### 3.5 CCNA protocol coverage

**[V] From the code, current branch:**

| Area | State |
|---|---|
| Cabling, link and line protocol, interface counters | Implemented. Auto-MDIX; cable types dropped on purpose |
| ARP, IPv4, ICMP echo, unreachable, TTL exceeded | Implemented |
| Routing: connected, local, static (next hop or exit interface) | Implemented. No default-route special cases beyond what static gives; no administrative distance logic beyond C/L/S |
| ping and traceroute (IOS and Windows style) | Implemented as streaming Jobs, abortable |
| CDP (frames, `show cdp neighbors [detail]`, native VLAN mismatch log) | Implemented |
| DHCP server on the router (pools, exclusions, bindings, conflicts, ping check); DHCP client with APIPA | Implemented |
| VLANs (database, names, extended-VLAN refusal in VTP server mode, `delete flash:vlan.dat`) | Implemented |
| 802.1Q trunks, native VLAN, allowed lists, DTP modes plus `nonegotiate` | Implemented. DTP is computed, not exchanged |
| Router-on-a-stick subinterfaces, SVIs with autostate, `ip default-gateway` | Implemented |
| Spanning tree | **Partial**: timers only. No BPDUs, root election, roles, cost, priority, blocking, TCNs, PortFast or BPDU Guard, and no `show spanning-tree` |
| `ip helper-address` (DHCP relay) | Missing |
| VTP modes, voice VLAN, `interface range`, `show interfaces status` | Missing |
| EtherChannel (LACP/PAgP), Layer 3 switching, `ip routing` on a switch | Missing |
| OSPF, EIGRP, RIP | Missing |
| ACLs, NAT/PAT | Missing |
| Port security, DHCP snooping, DAI | Missing |
| SSH/telnet over vty (`line vty` config is stored but there are no sessions), AAA, local users | Missing (config only) |
| HSRP, NTP, syslog servers, SNMP | Missing |
| IPv6 | Missing |
| LLDP, wireless, automation (REST/JSON) | Missing |

---

## 4. The CLI

### 4.1 Modes [V]

`user`, `enable`, `config`, `config-if`, `config-subif`, `config-line`, `dhcp-config` and `config-vlan` (`console.ts:12`). Prompts are `Host>`, `Host#` and `Host(config-if)#`, as in IOS.

The pending states are press RETURN, password (three tries, then `% Bad secrets` or `% Bad passwords`), a yes/no or confirm question, and multi-line banner entry.

### 4.2 Supported commands [V]

This is the full list, dumped from `commandsFor()` during the audit. The router and the switch share most commands.

- **Exec (user/enable):**
  - show commands:
    - `show version`, `show clock`, `show running-config`, `show startup-config` (the last two are enable only)
    - `show ip interface brief`, `show interfaces [IF]`
    - `show arp`, `show ip arp`
    - `show cdp`, `show cdp neighbors [detail]`
    - router: `show ip route`, `show ip dhcp binding|pool|conflict`
    - switch: `show mac address-table`, `show vlan [brief]`, `show interfaces trunk`, `show interfaces [IF] switchport`
  - session and testing: `enable`, `disable`, `exit`, `logout`, `help`, `ping A.B.C.D`, `traceroute A.B.C.D`
  - configuration and saving: `configure terminal`, `copy running-config startup-config`, `write [memory]`, `erase startup-config`, `reload`
  - clearing tables: `clear arp-cache`, `clear ip dhcp binding *|A.B.C.D`, `clear ip dhcp conflict *` (router), `clear mac address-table dynamic` (switch)
  - `delete WORD` (switch, for `flash:vlan.dat`)
- **Global config:**
  - device basics: `hostname`, `enable secret|password`, `service password-encryption`, `banner motd`
  - services: `cdp run`, `ip domain-lookup` (both spellings), `shell processing full`
  - interfaces and lines: `[no] interface IF` (creates subinterfaces and SVIs), `line console 0`, `line vty N [M]`
  - router: `ip route` (next hop or exit interface), `ip dhcp pool`, `ip dhcp excluded-address`
  - switch: `ip default-gateway`, `[no] vlan LIST`
- **Interface:**
  - all interfaces: `ip address`, `shutdown`, `description`, `cdp enable`
  - switch ports: `switchport mode access|trunk|dynamic auto|dynamic desirable`, `switchport access vlan`, `switchport trunk native vlan`, `switchport trunk allowed vlan [add|remove|except|all|none] LIST`, `switchport nonegotiate`
  - router subinterfaces: `encapsulation dot1Q N [native]`
- **Line:** `password`, `login`, `logging synchronous`, `exec-timeout`.
- **DHCP pool:** `network`, `default-router` (up to 8 addresses), `dns-server` (up to 8), `domain-name`, `lease D [H [M]]|infinite`.
- **VLAN:** `name`.
- Most commands have a `no` form. `end`, `exit`, Ctrl+Z, `do <exec command>` and sub-mode fallback all work.
- **PC shell** (`pc/shell.ts:22`): `ipconfig [/all|/renew|/release|/dhcp]`, `ipconfig IP MASK [GW]`, `ping`, `tracert`, `arp -a`, `help`.

### 4.3 `?`, abbreviations and Tab [V]

- **Abbreviations:** a keyword matches by unique prefix. Two candidates give `% Ambiguous command`.
- **`?`** goes through `IosConsole.help(line)` (`console.ts:170`), which calls `parser.help()` (:194). It returns:
  - after a space, the IOS two-column list (keyword and help text, with `<cr>` where valid)
  - for a half-typed word (`sh?`), the inline completions
  - the matching error when the line is already invalid
  - a mode heading (`Exec commands:`, `Configure commands:` and so on) on a bare `?`

  The caller re-displays the line unchanged, as IOS does.
- **Tab** goes through `IosConsole.complete(line)` (:186), which calls `parser.complete()` (:232). It completes a unique prefix and returns the same line when nothing is unique.
- Some quirks were verified against captures, for example how `int g9/9` places the caret (`Arg.caretAt`).

### 4.4 Output format [V]

- Output is arrays of plain strings, one per line, with no ANSI codes and no CRLF. The xterm layer adds CRLF.
- Show output is built in `ios/show.ts` with fixed-width padding to match IOS columns.
- A streaming Job writes text with `\n` and may write partial lines, such as a row of `!` during ping.
- **[V] Branding differs from Cisco on purpose:**
  - `Cryptis` replaces `Cisco`, and `CR-2911` / `CS-2960-24TT` replace `CISCO2911/K9` / `WS-C2960-24TT-L`.
  - The boot text has jokes ("please do not call after dark", "13 Hollow Lane, Static Springs").
  - The harness must normalize these before comparing (§7.4).

---

## 5. Topologies

- **[V] Defined in code.** Each scenario is a function that builds a `Network`, adds devices and connects ports. It returns a `Scenario` (`scenarios/types.ts:23`) holding:
  - `net`
  - a diagram `layout` keyed by device id
  - `tasks` with live-state `done()` checks
  - `incantations`, which feed the story grimoire
  - `workOrder`
  - the starting device

  The job list is `JOBS` in `scenarios/index.ts:7`. Example: `cornerStore({ cabled })` in `scenarios/corner-store.ts`.
- **[V] There is no JSON import or export** for topologies or configs. Everything is constructed in code.
- **[V] Building a topology in code already works** and is how every test works. For example:

  ```ts
  const net = new Network();
  const r1 = net.add(new Router("R1", "R1"));
  const s1 = net.add(new Switch("S1", "S1"));
  net.connect(r1.port("Gi0/0"), s1.port("Gi0/1"));
  ```

- **[V] Port lookup accepts the full name, the short name, and Packet Tracer's `Gig0/1` spelling** (`network.ts:115`).
- **[V] Device capacity is fixed in the classes.** A router has 3 GigabitEthernet ports and a switch has 24 FastEthernet plus 2 GigabitEthernet ports. There are no module slots and no other models. A Packet Tracer topology that uses other models, or a 2911 with HWIC cards, can't be mirrored without new classes.
- **[R]** Add a small JSON loader in a new file (`src/sim/topology-json.ts`, §8.1). It should be added code only, with no changes to existing behavior.

---

## 6. Story mechanics and the engine

| Mechanic | Where | Touches the engine? |
|---|---|---|
| Rune rendering of unlearned commands | `sim/grimoire.ts` (`Grimoire`, `toRunes` at :105). The parser's `help()` and `complete()` take an optional `reveal` filter (`parser.ts:194,232`), and `IosConsole.reveal()` (`console.ts:298`) builds it from `console.grimoire` | **[V] Display only.** Hidden words render as runes in `?` and are skipped by Tab. Typing an unlearned command **still runs it** and teaches it (`learnFrom`, :306). With `console.grimoire = null` (the default), help and Tab are plain IOS |
| Command locking | Not built. Unlearned commands still run, by Ant's design | n/a |
| Forbidden commands that trigger horror | Not built | n/a |
| Setup-wizard reactions | Not built. The design was drafted 2026-10-18 in the design doc. Today `askSetupDialog()` (`console.ts:134`) answers yes with the real IOS text, then backs out as if Ctrl+C was pressed | **[R]** When built, put the reactions in the game layer, behind a hook the console calls, so the default engine keeps the plain IOS text |
| The haunting (phantom PC) | `game/story.ts:33,41,267`. Adds a real `Pc` with MAC 6666.6666.6666 and IP 192.168.1.66 to the job network, cables it to S1 Fa0/24, and has it ping | **[V] Yes, on purpose, through the public API.** Hauntings are real network events by design ("hauntings are security attacks"). It only happens in the game's own `Network` instance |
| Dialogue, flags, flicker, cards | `game/story.ts`, `game/ui.ts`, `game/room-scene.ts` | **[V] No.** These only read engine state (`task.done()`) |

Conclusions:
- **[V]** The harness gets the unrestricted engine by building its own `Network` and leaving `grimoire` null. No game code runs.
- **[R]** Keep that rule written into the engine. Story hooks stay optional, default to off, and change only presentation (help and Tab text) or act through the public device API, never through hidden state. Add a test asserting that `grimoire = null` output is identical to the output with every command learned.

---

## 7. Testing and integration

### 7.1 What exists [V]

- Vitest has 8 test files and 112 tests, all passing on 2026-10-19:
  - `cli`
  - `network`
  - `depth`
  - `dhcp`
  - `vlans`
  - `topology`
  - `grimoire`
  - `captures`
- `tests/helpers.ts` has the reusable drivers:
  - `type(device, ...lines)` feeds lines to the console and runs out any Job
  - `run(pc, line)` does the same for the PC shell
  - `finish(device, job)` advances the clock until a Job is done
  - `captureLogs(device)` collects the `%` messages with timestamps stripped
- `tests/captures.test.ts` holds 23 assertions taken from Ant's CML captures. The raw sessions are in the shared folder `code/captures/`. The capture checklist is `code/cml-capture-checklist.md`, with a Google Sheet copy.

### 7.2 Running without the browser [V]

Yes. During the audit, a throwaway Vitest file outside the repo imported `src/sim` by absolute path, built topologies and ran commands under Node. Nothing in `src/sim` needs a DOM.

**[A]** Plain `node` would need a TypeScript runner such as tsx or `--experimental-strip-types`. The import style (`verbatimModuleSyntax`, extensionless imports) may need the bundler resolution Vite provides, so running through Vitest or vite-node is the safe path.

### 7.3 An external process sending commands [V for the engine, R for the transport]

- **[V]** There is no server, CLI binary or IPC today. Everything is in-process calls.
- **[R]** Add a thin Node entry point that reads JSON-lines from stdin and writes JSON-lines to stdout. Codex, a Python orchestrator or a dashboard can then drive it as a subprocess. Optionally put a local HTTP or WebSocket server on top for the dashboard. See §8.2.

### 7.4 Deterministic time and stepping [V]

- `clock.advance(ms)`, `clock.runUntil(deadline, predicate)` and `clock.pending` are available.
- Simulated time is independent of wall time. 30 s of STP waiting costs microseconds.
- **[R]** A real Packet Tracer or CML run happens in wall-clock time, while the simulator runs in virtual time. Compare timings by **event order and the intervals between events**, measured from a shared marker such as "command X entered". Don't compare absolute timestamps.

### 7.5 Recommended engine interface [R]

This would be one new file that only wraps existing calls:

```ts
// src/sim/harness.ts (proposed)
export interface SimSession {
  reset(seed?: { macBase?: number }): void;            // resetMacAllocator + new Network
  loadTopology(t: TopologyJson): void;                 // devices + links + optional startup configs
  exec(device: string, line: string, opts?: { runJobs?: boolean; maxMs?: number }): ExecResult;
  help(device: string, partialLine: string): { lines: string[]; line: string };
  complete(device: string, partialLine: string): string;
  advance(ms: number): LogEvent[];                     // returns %LOG lines emitted meanwhile
  waitFor(pred: StatePredicate, maxMs: number): { ok: boolean; atMs: number };
  snapshot(): EngineSnapshot;                          // configs, port states, STP states, MAC/ARP tables
  link(a: string, b: string): void; unlink(port: string): void;
}
```

The pieces map onto existing code:

| Need | Existing code |
|---|---|
| `exec` | `console.input` for IOS devices, `pc.shell.execute` for PCs, plus `finish()` for Jobs |
| `help` | `console.help` |
| `complete` | `console.complete` |
| `advance` | `clock.advance` with an `onOutput` collector |
| `snapshot` | public fields: `config`, `ports[].linkUp` and `protocolUp`, `stpState(port, vlan)`, `liveMacEntries()`, `stack.arp` |

---

## 8. Proposed integration architecture [R]

```
                ┌───────────────────── Orchestrator (Node/TS or Python) ─────────────────────┐
                │ experiment queue · retries · circuit breaker · topic gating               │
                │                                                                            │
  experiments/  │   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐                   │
  *.json  ─────►│   │ SimAdapter   │   │ PtAdapter    │   │ CmlAdapter   │  (same interface) │
                │   │ (in-proc or  │   │ (PT Script   │   │ (CML REST +  │                   │
                │   │  JSONL child)│   │  Module/GUI) │   │  console)    │                   │
                │   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘                   │
                │          └──── observations (normalized) ──────┘                           │
                │                         │                                                  │
                │                  SQLite (FTS5) store ──► comparator ──► discrepancies      │
                └─────────────────────────┬──────────────────────────────────────────────────┘
                                          ▼
                              Dashboard (local web page, read-only on the DB)
```

### 8.1 Adapters share one interface [R]

Each backend implements:
- `createTopology`
- `exec`
- `help`
- `complete`
- `wait`
- `captureState`
- `teardown`

**SimAdapter** wraps §7.5.

**PtAdapter.** First choice is PT 8 Script Modules, using the approach of the community projects listed under Sources. A module inside Packet Tracer polls a local HTTP endpoint and runs JavaScript that adds devices, links them and sends CLI commands.
- **[A]** Reading back the exact CLI text through that API is unconfirmed. This is the gating spike.
- Fallback is GUI automation of the device CLI tab with pywinauto or UIA on Windows: type the commands, select all, copy, and read the clipboard.
- PT also has a Java IPC API (ExApps over PTMP, TCP 39000 by default). It is documented but old.

**CmlAdapter.** Ant's existing source. CML 2.8 has a REST API for labs, nodes and links, and console access through its terminal server or pyATS.
- **[A]** The REST and console details need checking against Ant's CML 2.8.1 install.
- Only IOL and IOL-L2 run there, never IOSv.

### 8.2 Sim transport [R]

`node tools/sim-server.mjs` (via vite-node) speaks JSON-lines. Each request is one of these ops:
- `{op:"reset"}`
- `{op:"load", topology}`
- `{op:"exec", device, line}`
- `{op:"help"}`
- `{op:"complete"}`
- `{op:"advance", ms}`
- `{op:"snapshot"}`

Each response is `{ok, result | error}`.

### 8.3 Normalization before comparing [R]

Apply this mapping before diffing:
- `Cryptis` → `Cisco`
- model strings → their PT equivalents
- boot banner and version text → excluded from line diffs
- timestamps → masked
- MAC addresses → canonicalized per device and port role
- uptime and counter values → masked unless the experiment targets them
- trailing whitespace → trimmed (the CML capture tests already do this)

Keep the raw text too. Normalization belongs at comparison time, never at capture time.

### 8.4 Comparison levels [R]

Compare at three levels:
1. Exact text after normalization.
2. A structured parse: show-command parsers extract fields such as port role, state and root ID.
3. Behavior: events and their order, convergence intervals within a tolerance, and reachability.

Each discrepancy is classified as `missing-feature`, `text-mismatch`, `behavior-mismatch`, `timing-mismatch`, `pt-quirk` or `needs-real-gear`.

### 8.5 Pause and stop rules [R]

- Retry a backend error 3 times with backoff.
- Open a circuit breaker per backend after N consecutive failures. That pauses the queue and flags the dashboard.
- Any experiment that times out twice is quarantined.
- A topic is "researched" only when every planned experiment has an observation from at least one real-IOS source, or is marked blocked. No fix work is proposed before that (Ant's requirement 10).

---

## 9. Suggested JSON schemas [R]

These are kept small on purpose. Store them as JSON Schema files in the harness repo folder.

### 9.1 Topology

```json
{
  "id": "stp-triangle-01",
  "description": "Three 2960s in a triangle, default priorities",
  "devices": [
    { "name": "S1", "type": "switch", "model": "2960-24TT", "startupConfig": ["hostname S1"] },
    { "name": "S2", "type": "switch", "model": "2960-24TT" },
    { "name": "S3", "type": "switch", "model": "2960-24TT" },
    { "name": "PC1", "type": "pc", "ip": "10.0.0.1/24", "gateway": null }
  ],
  "links": [
    { "a": "S1 Gi0/1", "b": "S2 Gi0/1" },
    { "a": "S2 Gi0/2", "b": "S3 Gi0/1" },
    { "a": "S3 Gi0/2", "b": "S1 Gi0/2" },
    { "a": "PC1 Fa0", "b": "S1 Fa0/1" }
  ],
  "backendHints": { "pt": { "switchModel": "2960-24TT" }, "cml": { "switchImage": "iol-l2" } }
}
```

### 9.2 Experiment (command sequence)

```json
{
  "id": "stp-root-election-default",
  "topic": "stp",
  "topology": "stp-triangle-01",
  "steps": [
    { "wait": { "until": "all-links-up", "maxMs": 60000 } },
    { "wait": { "ms": 50000 } },
    { "exec": { "device": "S1", "lines": ["enable", "show spanning-tree vlan 1"] }, "capture": "S1-stp" },
    { "help": { "device": "S2", "line": "spanning-tree ?" }, "capture": "S2-help" },
    { "complete": { "device": "S2", "line": "spanning-tree vl" } },
    { "linkDown": "S1 Gi0/1" },
    { "logsFor": { "ms": 60000 }, "capture": "reconvergence-logs" }
  ],
  "expect": { "kind": "observe-only" }
}
```

### 9.3 Observation (one per capture per backend)

```json
{
  "experimentId": "stp-root-election-default",
  "runId": "2026-10-20T14:03:11Z-pt-0007",
  "backend": "pt",
  "backendVersion": "Packet Tracer 8.2.2",
  "deviceImage": "C2960 IOS 15.0(2)SE4",
  "captureKey": "S1-stp",
  "device": "S1",
  "input": "show spanning-tree vlan 1",
  "rawOutput": "VLAN0001\n  Spanning tree enabled protocol ieee\n...",
  "normalizedOutput": "...",
  "parsed": { "rootId": { "priority": 32769, "mac": "<S2.base>" }, "ports": [{ "name": "Gi0/1", "role": "Root", "state": "FWD", "cost": 4 }] },
  "events": [{ "tMs": 0, "text": "%LINK-3-UPDOWN: ..." }],
  "elapsedMs": 1240,
  "status": "ok",
  "error": null
}
```

### 9.4 Comparison result

```json
{
  "experimentId": "stp-root-election-default",
  "captureKey": "S1-stp",
  "reference": { "backend": "cml", "runId": "..." },
  "candidate": { "backend": "sim", "runId": "..." },
  "verdict": "missing-feature",
  "textDiff": "--- cml\n+++ sim\n-VLAN0001\n+% Invalid input detected at '^' marker.",
  "fieldDiffs": [{ "path": "ports[0].role", "reference": "Root", "candidate": null }],
  "timingDiff": null,
  "notes": "show spanning-tree not implemented",
  "proposedFix": null
}
```

**Storage [R].** Use SQLite, with tables `experiments`, `runs`, `observations` and `comparisons`, and an FTS5 index on raw and normalized output. That gives one file to search and back up, and the dashboard reads it.

---

## 10. Risks and limits

1. **[V] There is no STP engine.** Every STP experiment will show "missing" until it is built. Loops storm forever and fill the event queue. The harness's sim runs need an event or time cap so a looped topology can't hang them.
2. **[A] Packet Tracer automation.** Reading the CLI output back is unproven. PT's own timing is simulated too: it has a Realtime and Simulation mode and a fast-forward button, and its STP and OSPF timers may not match real gear. **[A]** PT's IOS output is a reimplementation and differs from real IOS in places, which is why Ant treats it as a weak source.
3. **[V] The model mismatch is mostly fine.** PT has the same 2911 and 2960-24TT, so command sets line up. CML gives IOS XE 17 text (for example `%LINK-5-UPDOWN` instead of `%LINK-3-UPDOWN`), and the code already notes such differences in comments and tests.
4. **[V] MACs are order-dependent and STP root election depends on MACs.** To match a reference backend's root bridge, the topology loader must let an experiment pin base MACs, or set priorities explicitly. Pinning needs a small engine change, which belongs to the build phase.
5. **[V] Fixed hardware.** There is one router model and one switch model with fixed ports, so topologies that need other models are out of scope for now.
6. **[V] The engine's flavor text** (boot banner, brand names) differs on purpose. The normalization in §8.3 is required.
7. **[V] There is no Sandbox mode** as described in the brief. The bench page still turns on the grimoire. The harness doesn't need a Sandbox UI, but the game will.
8. **[A] Concurrency.** One `Network` per experiment is cheap. Packet Tracer probably handles one GUI instance at a time, so PT experiments run in series.

---

## 11. Phased plan [R]

| Phase | Goal | Exit check |
|---|---|---|
| 0. Spikes | (a) In PT 8 on Ant's Windows PC, build 2 switches through a Script Module and send `show spanning-tree`. **Prove the exact output text can be read back.** If it can't, try GUI copy-out. (b) Run one sim experiment headless through a JSON-lines child process | Both return raw text into a JSON file |
| 1. Harness skeleton | A new top-level folder (for example `harness/`) holding the schemas from §9, the SQLite store, the orchestrator, `SimAdapter` (added files only, no edits to `src/sim` behavior), and a manual "run one experiment" command | One experiment stored with a sim observation |
| 2. Real adapters | `PtAdapter` and `CmlAdapter`, retries and circuit breaker, and the normalizer | The same experiment stored from 2+ backends |
| 3. Comparator and dashboard | Text, field and timing diffs; a dashboard showing the queue, progress, failures, the discrepancy list and the raw side-by-side output | Ant can browse STP results |
| 4. STP research | About 30 to 50 experiments: root election (default, priority, MAC tie-break), port roles and costs, link failure and reconvergence, TCN logs, PortFast, BPDU Guard err-disable, root guard, mismatched modes, `show spanning-tree` variants, `?` and Tab under `spanning-tree` | Every experiment observed from a real-IOS source, or marked blocked, and a research report written |
| 5. Fix proposals | Only now: a spec for STP in the sim, drawn from the observations, implemented with the observations as Vitest fixtures | Comparator shows STP discrepancies closing |

---

## 12. Instructions for Codex

1. Read `AGENTS.md`, then `HANDOFF.md`, then this file. Work on a new branch made from the tip of the PR stack (currently `claude/corner-store-slice`), not from `main`, or ask Ant which base to use.
2. **Do not edit files under `src/sim`, `src/game` or `src/web` in phases 0 to 4.** Put new code in `harness/` (and `tools/` if needed). The only exceptions are new **added** files in `src/sim` (for example `harness.ts`, `topology-json.ts`) that wrap existing public calls. Ask Ant before even that.
3. Drive the engine with:
   - `new Network()`, `net.add(new Router(id, hostname) | new Switch(...) | new Pc(...))`, `net.connect(a.port("Gi0/1"), b.port("Gi0/1"))`
   - `device.console.input(line)`, `.help(line)` and `.complete(line)`
   - `pc.shell.execute(line)`
   - `job.done`, `job.output` and `net.clock.runUntil()`; copy `finish()` from `tests/helpers.ts`
   - `device.onOutput(fn)` for log messages
   - `resetMacAllocator()` before each experiment

   Remember that IOS devices boot to a "press RETURN" state: send `""` first, and answer `no` to the setup dialog if the device was built without a startup config.
4. Leave `console.grimoire` null. Never import from `src/game`.
5. Cap every sim run, for example `clock.runUntil(now + maxMs, ...)` plus a check on the event count, because looped topologies storm.
6. Store raw output untouched. Normalize only at comparison time.
7. Tag every observation with backend, version and image. When PT and CML disagree, record both and mark `needs-real-gear`. Ant's CML captures win for behavior, and Cisco IOS 15 docs win for IOS 15 text that IOL can't show.
8. Respect Ant's fidelity rules: never introduce "Cisco" into game-facing text, and never suggest IOSv (it doesn't run on Ant's laptop).
9. Run `npm test` and `npm run build` before any push. Both must stay green. Add Vitest tests for any new `src/sim` file.
10. Stop and report when a backend keeps failing, instead of working around it silently.

---

## Sources

- The repository at commit `c096a02`, its tests, and audit-time runs under Vitest.
- Packet Tracer IPC help: [IPC (Inter-Process Communication)](https://tutorials.ptnetacad.net/help/default/ipc.htm), [Extensions API 8.1.0](https://tutorials.ptnetacad.net/help/default/IpcAPI/_c_cep_8pki.html).
- Community Script Module bridge: [packet-tracer-mcp](https://github.com/caixax/packet-tracer-mcp), a fork of PTBuilder. It is beta, and reading CLI output is not documented.
- Project memory: Ant's CML setup and capture workflow, `code/cml-capture-checklist.md`, `code/captures/`.
