# Time To Live: brief for prop creation

For Hermes, to build a prop list for the locations not made yet. Written by Claude for Ant, 2026-10-23. The networks each site runs are in `docs/site-networks.md`; the job ladder is in `HANDOFF.md`.

## The game

A 2D top-down pixel horror game set in **Static Springs**, a small seaside town in the spirit of Welcome to Night Vale. You're the new network contractor for **Bob's Bandwidth & Bloodletting**. Each job is a strange local business that needs a network. You carry the gear in, run the cables, and configure routers and switches at a real command line. The jobs follow the CCNA curriculum, and network faults and attacks are the hauntings.

Something vast and old lives under the town, in the network. Bellwether, the next town over, vanished years ago but still answers pings. The town's population sign ticks up after every haunted job, and nobody says why.

## The vibe

- **Cosmic horror, not comedy.** The names are jokey, but the world isn't in on the joke. The horror is indifference and scale: something enormous that doesn't notice you.
- **The mundane slipping.** Ordinary small-town businesses and ordinary tech (fluorescent tubes, beige PCs, CRTs, network racks, coiled cable) where something is slightly wrong.
- **Half-seen, never shown.** The best scare so far is a huge figure glimpsed for under a second through static, and then nothing changes. Props should hold that kind of detail: a note that's slightly off, a date that's impossible, something that's only wrong on the second look.
- **No gore.** Wrongness instead: teeth in a jar at a corner store, a dryer window showing a dead TV channel, a lease dated 1974.
- **Time feels stuck.** The tech is late 80s to 90s (CRTs, beige boxes, rotary and desk phones, walkie-talkies) mixed with network gear that's just modern enough. The employee-of-the-month photo is from October 1987, "and still warm".
- **References:** Silent Hill, Welcome to Night Vale, analog-horror tapes (Local 58), Welcome to Elderfield for the art.

## Art format

- 16 px pixel art, drawn at 4x. Tiles are 16x16; characters are 16x32 per frame.
- Props go on one sheet per location (for example `laundromat-props.png` with 48x64 cells). Big props can span several tiles; decor props block you without being interactive.
- Interactive props usually get a **close-up card** too, a painted picture shown when you inspect them (see `public/assets/cards/`: jar of teeth, dryer window, Gus's logbook, the lost and found, Gary's door, the coffee station).
- Some props have a **haunted variant**, the same prop after the haunt (the store's cooler and wall jack, the dryer window going empty).

## Every site needs the network props

Each job has its own network, so each location needs:

- a **rack or network closet** (router, switches, patch panel, cable mess)
- **PCs and end devices** at their desks
- **wall jacks** you can plug into
- whatever **special devices** the site's network runs, from `docs/site-networks.md`: phones, printers, cameras, X-ray sensors, card terminals, kiosks, and so on

## Cast

| Character | Who they are | Where |
|---|---|---|
| **You** | The new contractor. Silent | Everywhere |
| **Walter** | Senior technician, only ever heard over a walkie-talkie. Gruff, tired, "Bob's never in. Bob is a concept, like weekends." Employee of the month, October 1987 | Bob's office, by radio |
| **Gary** | Behind a locked door in Bob's office. Cheerful, helpful with tips, and wants you to open the door. Walter says "Gary knows what he did" | Bob's office |
| **Bob** | Never in. Maybe not real | Bob's office (his desk, his drawer) |
| **Mrs. Finch** | Owns the corner store. Has calm, frantic and paranoid looks | Job 1 |
| **Gus** | Night attendant at the laundromat, on shift since 1974. Walks his rounds and stares at Dryer 4 | Job 2 |
| **Simone** | Has a portrait in the game already and is lined up for a later job (the SSH notes name her) | Later job, role not set |
| **Arthur, Dev, Elena, Marcus, Maren** | Concept art exists in calm, frantic and paranoid looks, but roles aren't assigned in the repo yet. They're the clients and townsfolk for the jobs to come | Jobs 3 to 9 |

Townsfolk concepts are in `art/concepts/characters/townsfolk-concept-v1.jpg`.

## Locations already built (for reference, don't redo)

- **Bob's office (home base):** the job board, Bob's desk (sticky note, the bottom drawer where the grimoire turns up), the coffee machine (the save point), the employee-of-the-month photo, a filing cabinet, Gary's locked door, the walkie-talkie.
- **Job 1, Quik-Stop Forever (corner store):** fridges along the back wall (the cooler gets a haunted look), three shelf aisles (with a jar of teeth), the counter and register, a back office with the rack and a PC, and a wall jack behind the cooler that something plugs into.
- **Job 2, Spin Cycle Eternal (24-hour laundromat):** a wall of dryers (Dryer 4 has black glass and an OUT OF ORDER note), washer islands, a folding table with the lost and found carton, Gus's booth with its service window, a change machine, and a locked back office with the rack, a PC, a printer and Gus's shift logbook.

## Locations still to make

For each, list props for the room itself, the network gear, interactive props with close-up cards, haunted variants, and found notes or lore objects. The VLAN tables in `docs/site-networks.md` say which devices each site needs.

### 3 · Dentist's office
Front desk with billing and appointments, a waiting room with guest Wi-Fi, operatories with chairs and X-ray sensors, a panoramic X-ray machine, an imaging server, and desk phones. Teeth carry over from the corner store's jar. The clinic is clean on the surface.

### 4 · Library
Circulation desk, a public computer lab, catalog terminals, self-checkout kiosks, a book drop, pay-to-print stations, and a layer 3 switch in the closet. This is the home of the **cult books**: shelves of books written as cult and horror texts that teach the CCNA topics you only need to understand, such as *The Seven Floors* (the OSI model as a seven-layer descent). Cultists send spanning-tree traffic through the wall jacks.

### 5 · Funeral home and crematorium (two sites, joined by a WAN link)
The office for arrangements and records, a chapel with livestream cameras, a slideshow PC and a sound system, security cameras, and the crematorium's retort controller (industrial controls that must never reach the internet). A hymnal could be a stray cult book. It needs gear at both sites, since you can't be at both at once.

### 6 · Town hall and sheriff
Clerks' and permits desks, a public lobby kiosk, a meeting room, the sheriff's office with deputies' PCs, a 911 dispatch console with a radio gateway, an evidence room with body-cam docks and a server, and cameras in the holding cells. Population records could tie into the town sign.

### 7 · Community radio station
An office, a studio with a mixing desk, mics and an ON AIR light, a streaming encoder, the link to the transmitter tower, and Wi-Fi for DJs and guests. Night Vale's radio voice lives here: number stations, shortwave, tapes that shouldn't exist, and Bellwether.

### 8 · Hospital
Clinical workstations, medical devices (old infusion pumps and monitors), an imaging room, nurse call and phones, building systems (HVAC, elevator, door access), guest Wi-Fi, and admin and billing.

### 9 · The Void-View Hotel (the finale)
A front desk, card terminals, guest rooms on several floors, in-room TVs, cameras, door locks and the elevator, conference rooms, and the previous technician's broken setup, abandoned partway through. Everything comes together here.

## Threads props can carry across jobs

- **VLAN 1974:** a VLAN nobody created appears at one site, gains a port a few jobs later, and has hosts by the hotel. Props can hint at it: labels, notes, a jack marked 1974.
- **1974 and 03:14 AM:** the laundromat's ghost lease. Clocks, receipts and logs that read that time.
- **Bellwether:** the vanished town that still answers pings. Maps, letters, a radio frequency.
- **The population sign:** 4,218 at the start, up one after each haunted job.
- **Cryptis Systems:** the brand on all the network gear. Never use real brand names on props.
