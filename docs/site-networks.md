# Site networks

Design note, 2026-10-23. What each client's network looks like from job 3 on, modelled on what real businesses of that kind actually run. Nothing past job 2 is built in the game yet; use this when building each job's scenario. The job ladder itself is in `HANDOFF.md`.

## Every site from job 3 on

Job 3 teaches VLANs, so every site after it is segmented, the way real businesses are. These habits are real best practice, and repeating them at every site is how they stick:

- A **management VLAN** (99 below) holds the switches' and routers' own addresses.
- Unused ports go into a **dead VLAN** (999) and are shut down.
- The trunk's **native VLAN** is moved off VLAN 1 to an unused one.
- **Guest Wi-Fi** is always kept away from everything else.

VLAN numbers are suggestions. Keeping the same number for the same job across sites (10 staff, 99 management) helps the player read a new site quickly.

## Subnetting and VLSM

Jobs 1 and 2 each use a single /24, so the player never has to carve up an address block. The simulator already accepts any mask length, rejects overlapping subnets and prints "variably subnetted" in `show ip route`, so this is design work, not engine work.

| Job | Step | Why it fits there |
|---|---|---|
| 3 · Dentist | **Equal-sized subnets.** One /24 split into a subnet per VLAN | Each VLAN needs its own subnet anyway, so the reason to subnet comes naturally. Equal sizes teach the maths before choosing sizes |
| 5 · Funeral home | **VLSM proper.** One block sized to fit: say a /26 for the chapel, a /27 for the crematorium office and a /30 for the WAN link | The first point-to-point link, and wasting a /24 on two addresses is exactly what VLSM fixes. Static routes for each subnet check the maths |
| 6 · Town hall | **Reinforcement.** Tighter address budgets, with OSPF advertising mixed mask lengths | VLSM routes spread through a routing protocol |
| 9 · Void-View Hotel | **The previous tech's overlapping, wrongly sized subnets** are part of what you fix | Fits "someone else's broken network" |

Flavour idea: the client hands over the block on a stained, handwritten slip ("the town only gave us 192.168.40.0/24, make it last"), and perhaps Static Springs really is running out of addresses for reasons nobody will explain.

## 3 · Dentist's office

| VLAN | What's on it | Why it's separate |
|---|---|---|
| 10 Front desk | Reception PCs, billing, the appointment system | Patient and payment data |
| 20 Clinical | Operatory PCs, X-ray sensors, the panoramic machine, the imaging server | Imaging is heavy traffic, and patient-privacy law wants it isolated |
| 30 Voice | Desk phones | Calls stay clear on their own VLAN |
| 40 Guest | Waiting-room Wi-Fi | Patients never touch clinical systems |
| 99 Management | Switch and router addresses | |

## 4 · Library

| VLAN | What's on it | Why it's separate |
|---|---|---|
| 10 Staff | Circulation desk, back office | Patron records |
| 20 Public PCs | The patron computer lab, locked down and wiped nightly | Anyone can sit at these |
| 30 Catalog and kiosks | Self-checkout, catalog terminals, the book-drop RFID reader | Single-purpose devices |
| 40 Patron Wi-Fi | | |
| 50 Printing | Pay-to-print release stations | Shared by staff and patrons through one controlled path |
| 99 Management | | |

## 5 · Funeral home and crematorium (two sites)

| VLAN | What's on it | Why it's separate |
|---|---|---|
| 10 Office | Arrangements, records, death certificates | Family and legal records |
| 20 Chapel AV | Livestream cameras, the slideshow PC, the sound system | A service livestream can't stutter |
| 30 Cameras | Security cameras at both sites | |
| 40 Crematorium controls | The retort's temperature controller and logs | Operational technology (industrial controls). It should never reach the internet |
| 50 Family Wi-Fi | | |
| 99 Management | | |

## 6 · Town hall and sheriff

| VLAN | What's on it | Why it's separate |
|---|---|---|
| 10 Town staff | Clerk, treasurer, permits | |
| 20 Public | The lobby kiosk, meeting-room Wi-Fi | |
| 30 Sheriff | Deputies' PCs | Real police data has strict separation rules. This is where ACLs earn their keep |
| 40 Dispatch | The 911 console, the radio gateway | Must never go down |
| 50 Evidence | Body-cam uploads, the evidence server | Chain of custody |
| 60 Cameras | Holding cells, parking lot | |
| 99 Management | | |

## 7 · Community radio station

| VLAN | What's on it | Why it's separate |
|---|---|---|
| 10 Office | | |
| 20 Studio audio | The mixing desk and mics, streaming audio over the network | Real stations isolate it because any jitter is audible on air |
| 30 Streaming | The encoder sending the station to the internet | Where NAT matters |
| 40 Transmitter link | The link out to the transmitter tower | |
| 50 Guest and DJ Wi-Fi | | |
| 99 Management | | |

## 8 · Hospital

| VLAN | What's on it | Why it's separate |
|---|---|---|
| 10 Clinical workstations | | |
| 20 Medical devices | Infusion pumps, monitors | Often old and unpatched, so they're fenced off. This is where port security comes in |
| 30 Imaging | X-ray and MRI images and their storage server | Heavy traffic |
| 40 Voice and nurse call | | |
| 50 Building systems | HVAC, elevators, door access | |
| 60 Guest | | |
| 70 Admin and billing | | |
| 99 Management | | |

## 9 · The Void-View Hotel

| VLAN | What's on it | Why it's separate |
|---|---|---|
| 10 Front desk and staff | | |
| 20 Payments | Card terminals | Card-industry rules (PCI) require isolation |
| 30 Guest rooms | Often one VLAN per floor in real hotels | |
| 40 In-room TV | | |
| 50 Cameras | | |
| 60 Building systems | Door locks, HVAC, the elevator | |
| 70 Conference rooms | | |
| 99 Management | | |

The haunt here is the previous tech's work: guest rooms and payments bleeding into each other, and subnets that overlap.

## A thread across the jobs: the VLAN that shouldn't exist

VLAN 1974 (the year of the laundromat's ghost lease) turns up in `show vlan` at one site, with no ports in it and nobody who created it. A few jobs later it has a port. By the hotel, it has hosts on it.
