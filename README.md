# Time To Live

A 2D horror game where you build real networks for the strange businesses of Static Springs. You configure the devices yourself with a Cisco IOS-style command line, and the jobs follow the CCNA 200-301.

This repo currently holds the **network simulator core** and a browser **bench terminal** for job 1, the corner store. There are no game graphics yet.

## Run it

```sh
npm install
npm run dev      # bench terminal at http://localhost:5173
npm test         # simulator tests
npm run build    # typecheck and production build
```

## What works

**The CLI**
- User EXEC, privileged EXEC, global config, interface and line modes, with real prompts.
- Unique-prefix abbreviations (`conf t`, `sh ip int br`, `int g0/0`, `int gig 0/0`).
- `?` help, both `sh?` and `show ?`, plus Tab completion and history.
- Real IOS errors: `% Invalid input detected at '^' marker.` with the caret under the first bad character, `% Incomplete command.`, `% Ambiguous command:`.
- Typo a command in EXEC mode and IOS tries to look it up as a hostname, slowly, until you set `no ip domain-lookup`.
- `do` from config mode, and global commands work from inside sub-modes.

**Configuration**
- `hostname`, `enable secret`, `enable password`, `service password-encryption` (type 7), `banner motd` (single and multi-line).
- `line con 0` and `line vty`: `password`, `login`, `logging synchronous`, `exec-timeout`.
- `interface`: `ip address` (with bad-mask and overlap checks), `shutdown`, `description`.
- `ip route` (next hop or exit interface), `ip default-gateway` on switches, `interface vlan 1`.
- `copy running-config startup-config`, `write memory`, `erase startup-config`, `reload` (asks to save if the config changed).
- Console login and enable passwords, including lockouts after three wrong tries.

- CDP: `cdp run`, `cdp enable` and their `no` forms.

**Show commands:** `running-config`, `startup-config`, `ip interface brief`, `interfaces`, `ip route`, `arp`, `mac address-table`, `vlan brief`, `cdp`, `cdp neighbors [detail]`, `version`, `clock`.

**Commands that take real time:** `ping` and `traceroute` on IOS, `ping` and `tracert` on PCs, and the DNS lookup on a typo all run on the simulation clock, so a timeout really is two seconds of standing in the dark. `Ctrl+Shift+6` aborts on IOS and `Ctrl+C` on a PC.

**The network simulation**
- Frames actually move over cables with ARP, MAC learning and flooding, IP routing (connected, local and static), and ICMP echo, unreachable and TTL exceeded.
- Interfaces log `%LINK` and `%LINEPROTO` messages, and line protocol comes up a second after the link.
- Switch ports wait through 30 seconds of spanning-tree listening and learning (the amber lights) before forwarding.
- The first ping from a router drops while it ARPs (`.!!!!`), just like real IOS.
- PCs have a desktop prompt with `ipconfig`, `ping`, `tracert` and `arp -a`. Windows pings are a second apart.
- Cables have types. Straight-through joins unlike devices (PC or router to switch) and crossover joins like ones (switch to switch, router to router, PC to router). A wrong cable leaves the link down, since Cryptis gear predates auto-MDIX. Console cables go from a PC's RS-232 port to a device's console port.
- Devices exchange CDP every 60 seconds with a 180 second holdtime, and switches don't forward it.

## Layout

```
src/sim/            The simulator. No DOM, fully testable.
  network.ts        Devices, ports, cables, link state
  clock.ts          Virtual time (the game pumps it from real time)
  job.ts            Commands that keep printing as time passes
  tools.ts          ping and traceroute, IOS and Windows flavors
  ipstack.ts        ARP, routing, ICMP for routers, PCs and switch SVIs
  devices/          Router (CR-2911), Switch (CS-2960), PC
  ios/              Parser, console modes, commands, show output, passwords
  pc/               The PC command prompt
  scenarios/        Prebuilt jobs (job 1: the corner store)
src/web/            The bench terminal (xterm.js)
tests/              Vitest tests
```

## Not yet

- Real spanning tree (BPDUs and loop blocking), VLANs and trunks: job 3 and 4.
- `interface range`, SSH, DHCP, LLDP.
- A terminal program on the PC that uses the console cable.

Cryptis Systems is fictional. This project is not affiliated with Cisco Systems.
