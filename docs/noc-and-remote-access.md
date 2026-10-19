# The NOC and remote access

Design note, 2026-10-19. Ant's idea, written up so Claude, Codex and anyone else work from the same plan. Nothing here is built yet.

## The idea in one line

Early on, every problem means driving out to the site. Learning SSH unlocks a NOC terminal at your desk in Bob's office, where you can fix configuration problems remotely. But physical problems, like a pulled cable, still mean you have to go there.

## Progression

### 1. Truck rolls only (start of the game)

- You have no remote access. Every ticket means traveling to the client, plugging the field laptop into the rack's console port, and working there.
- These jobs teach the basics: cabling, interfaces, IP addressing, and how to tell a link light from a working link.
- This is how job 1 (the corner store) already plays.

### 2. Earning SSH (job 5, the funeral home and crematorium)

Ant moved SSH up from job 8 so the NOC matters for more of the game. Job 5 is the first job with two sites over a WAN link, and you can't be at both at once, so that's where remote access becomes something you need. The job teaches setting up SSH for real, on the client's gear, from the console:

```
hostname R1
ip domain-name bb-network.local
crypto key generate rsa
username simone secret ...
ip ssh version 2
line vty 0 4
 login local
 transport input ssh
```

- When a site has working SSH and a route back to B&B, it appears on your NOC terminal.
- The CCNA lesson is the reward: if you skip a step, the site never shows up.
- If you later lock yourself out (a wrong ACL, `transport input none`, a deleted user), you're back to a truck roll.
- From job 6 on, the NOC is part of every job. The earlier sites (store, laundromat, dentist) were built without SSH, so going back to add it is optional side work: one more truck roll now, and remote fixes for that site from then on.

### 3. The NOC desk

- One of the tech desks in Bob's main office becomes yours. It runs Cryptis NetOS like the other PCs, with an extra NOC view:
  - a list of the sites you've connected
  - each site's link status and last contact
  - incoming tickets
  - SSH into any device that has it
- The field laptop's topology tab already draws a live map of one site. The NOC could show one map per site.

## Remote fixes versus on-site fixes

Every fault in the game is one of two kinds. The NOC can **diagnose** both, but only **fix** the first.

| Fixable remotely over SSH | On-site only |
|---|---|
| Wrong access VLAN on a port | Cable unplugged or in the wrong port |
| Bad IP address, mask or gateway on a router or switch | Bad patch cable |
| Missing or wrong static route | Device powered off |
| Interface administratively shut down | PC misconfigured (PCs don't take SSH) |
| Port err-disabled (shut / no shut) | Locked yourself out of SSH |
| Trunk or native VLAN mismatch | Anything on a device with no SSH set up yet |

Telling the two apart is real troubleshooting skill, so the NOC should **show the evidence, not the answer**:

- `show interfaces` says down/down and the CDP neighbor is gone, so it's physical. Go there.
- up/up but no ping, so it's probably configuration. Fix it from here.

## The horror side

The NOC is a window into the whole town's network, so it's the natural place for things that shouldn't be there:

- A site in the list you never set up.
- Bellwether answering pings from the NOC.
- An SSH session that connects to an address that doesn't exist.
- `show users` on a client's router at night, showing someone else logged in on vty 2.
- A ticket that says "cable unplugged". You drive out, and the cable is plugged in. It just isn't plugged into anything you installed.
- The NOC itself has a NOC entry: your own desk, listed as a site, with an uptime longer than B&B has existed.

## Engine work this needs

These are simulator changes, so per `AGENTS.md` each one needs tests. Plan them after Codex's Packet Tracer research on the topic.

1. **SSH and telnet sessions over vty.** Verified gap: `line vty` settings are stored, but there are no sessions (see `CODEX_NETWORK_SIM_HANDOFF.md`, section 3.5). Needs:
   - `crypto key generate rsa`, `ip ssh version`, local users and `login local`
   - an `ssh -l user host` client on the PC and on IOS
   - a vty session that runs a normal console against the remote device
   - `show users` and `show ssh`
2. **A path from B&B to each site.** Today each job is its own isolated network. Remote access needs routing between B&B's office and the client (static routes first; NAT, a site-to-site VPN or a management network later, as later CCNA topics).
3. **Faults as data.** A way to define "this site breaks like this" (shut a port, pull a cable, change a VLAN) so tickets can be generated and checked.

## Where Codex's Packet Tracer work fits

- Every fault experiment Codex runs in Packet Tracer becomes an entry in the **fault catalog**: what was broken, the exact symptoms (CLI output, which pings fail, what CDP shows), and whether it's remote-fixable or on-site only.
- The access-port shutdown experiment (`Switch0 Fa0/2 shutdown`) is the first entry: remote-fixable, and the symptoms are a failed ping from PC0 and the port showing administratively down.
- Those captures double as the reference for what the game's own simulator should print for the same fault.

## Open questions for Ant

- Does B&B have its own network you build first (the office's server rack), with sites connecting back to it? That would turn the office rack into the hub of the whole game.
- Is the NOC on your desk, or is it the server rack's console in the main office?
- Do tickets arrive on a schedule, or does the story hand them to you?
