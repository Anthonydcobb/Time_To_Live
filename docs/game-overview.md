# Time To Live: what the game is and how it should feel

Written by Claude for Ant (Anthony Cobb), 2026-10-24, so any collaborator (Gemini, Hermes, agy) starts from the same picture. The other files in `docs/` go deeper: `prop-brief.md` for props, `site-networks.md` for each site's network, `audio-direction.md` for sound. Every line written so far is in `script/dialogue.md`, and where the build stands is in `HANDOFF.md`.

## In one line

A 2D top-down pixel horror game where you're the new network technician in a foggy seaside town, and the networks you build are how something very old gets in.

## The game

You've just started at **Bob's Bandwidth & Bloodletting**, the only network contractor in **Static Springs**, a small coastal town on black cliffs above a cold sea. Each job is a local business that needs its network built or fixed. You drive out, carry the gear in, run the cables at the rack, and configure the routers and switches at a real command line. The commands behave like real networking equipment.

The jobs follow the CCNA (the standard entry-level networking certification), so playing the game teaches real skills: addressing, DHCP, VLANs, routing, security and so on, one job at a time. Network faults and attacks are the hauntings. A rogue device on a switch port, a lease from a machine that doesn't exist, spanning-tree traffic coming through a wall jack: each is a real networking concept and also a ghost story.

## How a job plays

1. A work order goes up on the job board at Bob's office.
2. You travel to the site (pick it on the town map) and meet the client.
3. You walk the building, inspect things, and find the rack.
4. You cable the gear and configure it at the console. Walter, your senior tech, gives hints over the walkie-talkie if you're stuck.
5. The work order ticks off from the live network as each task is really done.
6. When it's all working, something answers that shouldn't. The haunt is brief, and then nothing changes. You go home, and the town's population sign has gone up by one.

The coffee machine at Bob's is the save point.

## The feel

**Cosmic horror, not comedy.** The names are jokey (Bob's Bandwidth & Bloodletting, the Void-View Hotel), but the world isn't in on the joke. Think Welcome to Night Vale: a calm, almost friendly voice describing something terrible. The humour is on the page; the dread is in everything else.

- **Indifference and scale.** Whatever lives under Static Springs isn't hunting you. It's vast and old and barely notices you, which is worse. It lives in the network.
- **The mundane slipping.** Ordinary small-town businesses and ordinary tech, fluorescent hum, fridge compressors, CRTs, beige PCs, coiled cable, where something is slightly wrong. A date that's impossible. A device that's on the network but nowhere in the building.
- **Half-seen, never shown.** The best scare so far: once the corner store's network works, a phantom device plugs into port Fa0/24 through the wall behind the cooler, the screen fills with static, and a huge figure is glimpsed for under a second in four flickers, with one frame of text: "IT IS ALREADY CONNECTED." Then it's gone, and the room looks exactly the same. Horror here works like that: brief, almost subliminal, leaving you unsure what you saw.
- **No gore, no jump-scare orchestra.** Wrongness instead: a jar of teeth on a corner store shelf, a dryer window showing a dead TV channel, a DHCP lease dated October 14, 1974, 03:14 AM.
- **Time feels stuck.** The tech is late 80s to 90s: CRTs, walkie-talkies, desk phones, beige boxes, mixed with network gear that's only just modern enough. The employee-of-the-month photo at Bob's is from October 1987, "and the photo is still warm."
- **Coastal fog.** The town map is a foggy seaside town at night: cliffs, a lighthouse sweeping the water, a dock, a graveyard by the beach, a tunnel that's the closed road out of town.

**References:** Silent Hill (Akira Yamaoka's music especially), Welcome to Night Vale, analog-horror tapes (Local 58, The Mandela Catalogue), number stations and shortwave radio, Welcome to Elderfield for the art.

## The look

16 px top-down pixel art, drawn at 4x, dark and desaturated with neon signs and screen glow cutting through. Inspecting a story object shows a painted close-up card. Dialogue appears in a rusted console with the speaker's portrait, and roots and cables creep over it as hauntings build. A faint CRT effect (scanlines, roll, flicker) sits over everything.

## The sound

Lo-fi drums with a Night Vale feel: a laid-back, dusty beat with hum, static, glitches and warped tape on top, calm and almost pleasant while something underneath is wrong. Walter talks through walkie static; Gary is a metal door banging. Ambience is mains hum, fridges, rack fans, and every so often a sound that's a little too low or comes from a little too far away.

## The cast

- **You:** the new technician. Silent.
- **Walter:** senior technician, only ever heard over the walkie. Gruff, tired, oddly fond of you. "Bob's not in. Bob's never in. Bob is a concept, like weekends."
- **Gary:** behind a locked door in Bob's office. Cheerful, full of genuinely good networking tips, and he'd love it if you opened the door. Walter says Gary knows what he did. Walter doesn't know what he did.
- **Bob:** never in. Possibly not real.
- **Mrs. Finch:** runs the corner store, Quik-Stop Forever (job 1).
- **Gus:** night attendant at Spin Cycle Eternal, the 24-hour laundromat (job 2). He's been on shift since 1974 and stares at Dryer 4 on his rounds.
- **Future clients:** Simone, Arthur, Dev, Elena, Marcus and Maren have concept art, but their roles aren't decided yet.

## The jobs

| # | Place | What it teaches | Status |
|---|---|---|---|
| 1 | Quik-Stop Forever, corner store | The basics: cabling, addressing, passwords | Playable |
| 2 | Spin Cycle Eternal, 24-hour laundromat | DHCP, a networked printer | Playable |
| 3 | Dentist's office | VLANs, trunks, splitting a network into subnets | Planned |
| 4 | Library | Layer 3 switching, spanning tree, EtherChannel. Home of the cult books | Planned |
| 5 | Funeral home and crematorium | Two sites over a WAN link, static routes, VLSM, SSH remote access | Planned |
| 6 | Town hall and sheriff | OSPF routing, access lists | Planned |
| 7 | Community radio station and lighthouse | NAT, wireless | Planned |
| 8 | Hospital | Port security, redundancy, logging and time sync | Planned |
| 9 | The Void-View Hotel | Everything, IPv6, and fixing the last technician's broken network | Planned (finale) |

**Cult books:** the topics you only need to understand, not configure, are taught through books written as cult and horror texts, such as *The Seven Floors*, the OSI model as a seven-layer descent where each floor up, the message forgets more of what carried it.

**The grimoire:** a book you carry after job 2. It fills in with each job's commands written as rituals, the notes you've found, sketches of each site's network, and logs of what was wrong there.

## Threads running through the game

- **Bellwether**, the next town over, vanished years ago but still answers pings.
- **1974 and 03:14 AM** keep turning up in logs, leases and clocks.
- **VLAN 1974** appears at one site with nobody having created it, gains a port a few jobs later, and has devices on it by the hotel.
- **The population sign** starts at 4,218 and goes up by one after every haunted job. Nobody says who the new residents are.

## Rules for anything you make

- Keep it restrained: one wrong detail beats a lot of spooky ones.
- No gore, no screaming, no comedy stings.
- The network gear brand is **Cryptis Systems**. Never use real brand names, and never call the game's equipment Cisco.
- Don't invent big story facts (who the clients are, what the thing under the town is). Suggest them to Ant as ideas instead.
