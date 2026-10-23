# Time To Live: audio direction

For agy (and anyone making sound or music). Written by Claude for Ant, 2026-10-23.

## What the game is

A 2D top-down pixel horror game set in **Static Springs**, a small town in the spirit of Welcome
to Night Vale. You're a network contractor for Bob's Bandwidth & Bloodletting. Each job is a
strange local business that needs a network: a corner store (Mrs. Finch), a 24-hour laundromat
(Spin Cycle Eternal, where Gus has been on shift since 1974), a dentist, a library, and on up to
the Void-View Hotel. You carry the gear in, run the cables and configure the routers and
switches at a real IOS-style command line. The jobs follow the CCNA curriculum, and network
attacks are the hauntings.

Under the town is something vast and old that lives in the network. Bellwether, the next town
over, vanished years ago but **still answers pings**. Dryer 4 at the laundromat shows an empty
window like a dead TV channel. A DHCP lease appears for a machine dated Oct 14 1974, 03:14 AM,
then statics away.

## The tone Ant wants: cosmic horror, not Dungeon Crawler Carl

The names are jokey (Bob's Bandwidth & Bloodletting), but **the sound should not be in on the
joke**. No wink, no zany game-show energy, no comedic stings, no "boss fight" sound. The humour
stays on the page; the audio is where the dread comes from.

What the horror is:

- **Indifference and scale.** Whatever is under Static Springs isn't hunting you. It's enormous
  and doesn't notice you, and that's worse. Think something massive passing far below a
  sleeping town.
- **The mundane slipping.** Fluorescent hum, fridge compressors, a dryer drum, a dial tone,
  modem handshakes, fan noise in a network rack. Ordinary tech sounds that are *slightly
  wrong*: a hum that's a semitone off, a modem that answers in a voice, a ping reply from too
  far away.
- **Half-heard, never shown.** Ant's favourite scare so far is the Fa0/24 apparition: full-screen
  static, a huge figure glimpsed for under a second in four flickers, one frame of text ("IT IS
  ALREADY CONNECTED"), a torn static burst and a sub-bass that falls away. Then nothing changes.
  Sound should work the same way: brief, almost subliminal, and then gone, leaving you unsure
  you heard it.
- **Not gore.** No screams, no wet sounds, no jump-scare orchestra hits.

Reference points: **Silent Hill (Akira Yamaoka) first**, Welcome to Night Vale's calm voice over wrongness,
Inside / Limbo ambience, analog-horror tapes (Local 58, Mandela Catalogue), number stations,
shortwave, Lustmord / dark ambient drones, Boards of Canada's warped-tape feel.

## Ant's picks (2026-10-23)

- **Silent Hill is a main reference.** Akira Yamaoka's mix of trip-hop beats, industrial
  clanging and radio static is close to the target.
- **Music: lo-fi drums under a Night Vale feel.** A laid-back, dusty lo-fi beat, with hum,
  static, glitches and warped tape on top. Calm and almost pleasant, while something underneath
  is wrong. Same as Night Vale: an easy voice describing something terrible.
- **Walter's walkie:** a burst of walkie-talkie static (squelch open, hiss, click) when Walter
  talks on the radio.
- **Gary:** metal door banging when you start talking to Gary, from behind his door in Bob's
  office. It can tie into the low throb `audio.ts` already plays there.

## Sonic palette

- **Electricity:** 60 Hz mains hum and its harmonics, ballast buzz, CRT whine, relays clicking.
- **Signal:** static, shortwave tuning, dial-up handshakes, fax tones, number-station voices,
  morse, DTMF, Ethernet link-light clicks. Ping (`!!!!!`) treated like a litany.
- **Tape and degradation:** wow and flutter, warped pitch, dropouts, bit-crush, songs heard
  through a wall or from another room.
- **The deep thing:** sub-bass under everything, very slow, felt more than heard. Pitch drops.
  Choir or voice pads stretched until they aren't human.
- **Keep it lo-fi and dry-ish**, like it's coming from small speakers in the room, not a cinema.

## What exists already

- `src/game/audio.ts` makes procedural room ambience in Web Audio: tube hum everywhere, the
  store's fridges with whispers coming from their direction, a low throb behind Gary's door in
  Bob's office that grows as you walk up, and the apparition's static burst and falling
  sub-bass. Sounds get louder as you walk toward their source.
- Rooms can loop a music track (`MUSIC` map in `audio.ts`, files in `public/assets/sound/`,
  played at level 0.35). Rooms right now: `office` (Bob's), `shop` (Mrs. Finch's corner store),
  `laundromat` (Spin Cycle Eternal).
- Music so far, in `art/music/`: Bob's theme (take 6, "lofi unsettling static", now playing in
  the office) and four takes of a haunt/blackout theme. Listen to them first; they're the
  direction Ant has approved, and new pieces should sit beside them.

## Useful things to make

Ask Ant which to start with. Rough list:

1. **Room loops** for the corner store and the laundromat (Bob's office has one). Long,
   seamless, quiet enough to sit under dialogue. The laundromat could be built from a dryer
   drum rhythm that's slowly out of time with itself.
2. **Stingers** for the hauntings: under 3 seconds, static-based, ending in silence.
3. **The Bellwether ping:** what a reply from a town that doesn't exist sounds like.
4. **UI sounds** that stay in-world: cable click into a port, link light coming up, terminal
   keypresses, the work-order ticket unfolding, a grimoire page turning when you learn an
   incantation.
5. **A title / start-screen piece.**

## Practical notes

- Loops: mp3 or ogg, seamless loop point, normalised but not loud (the game mixes them down).
  Put sources in `art/music/` and game-ready copies in `public/assets/sound/<where it plays>/` (see its README) with short
  kebab-case names.
- Don't commit anything from `art/inspiration/`; the repo is public.
- Never say "Cisco" in anything player-facing; in-game the gear is made by Cryptis Systems.
- `script/lexicon.md` has Ant's cosmic-horror vocabulary tied to game things; it's good for
  track names and mood.
