# Time To Live: the script

Every line of dialogue in the game comes from this file. Save it while `npm run dev` is running
and the game picks up the change straight away, without restarting or losing your place. Trigger
the scene again to hear the new line.

Cheat sheet (the full rules are below it):

| You write | What it does |
|---|---|
| `## scene-name` | Starts a scene. Don't rename these; the game asks for them by name. |
| `# Chapter` | A chapter heading, just for finding your way. Ends the scene above it. |
| `WALTER: text` | A spoken line. |
| `GUS (paranoid): text` | A line with a portrait mood: calm, paranoid or frantic. |
| `> text` | Narration, with no speaker. |
| `(a note)` | A note for us. The game skips it. |
| `(LIGHTS FLICKER)` | A stage cue, in capitals. Also `(FLICKER)`, `(LIGHTS OUT)`, `(LIGHTS ON)`. |
| `*word*` / `~word~` | Cold blue / red text. |
| `((note for Claude))` | A request or question for Claude. Hidden in game. Say "check the script". |
| `#idea anything` | Any tag the game doesn't know is a note too. |
| `#set flag` / `#clear flag` | Turns a flag on / off. |
| `#give item` | Gives you something (works like `#set` for now). |
| `#if flag` … `#else` … `#end` | Lines that only play if the flag is on. `#if not flag` for off. |
| `#goto scene-name` | Jumps to another scene instead of finishing this one. |

How it reads:

- `## scene-name` starts a scene. The game asks for scenes by these names, so rewrite the lines
  as much as you like but leave the names alone. `npm test` says if one goes missing.
- `WALTER: text` is a spoken line. WALTER and GARY get their "(walkie)" and "(through the door)"
  tags on screen automatically. Other speakers: MRS. FINCH, GUS, SIMONE.
- `MRS. FINCH (paranoid): text` picks a mood for the portrait: calm, paranoid or frantic.
- `> text` is narration, with no speaker.
- Names work in any case: `Walter:` and `WALTER:` are the same.
- A line in brackets, like `(The lights go out.)`, is a note for us. The game skips it.
- Stage cues in CAPITALS make things happen: `(LIGHTS FLICKER)`, `(LIGHTS OUT)`, `(LIGHTS ON)`.
  Put one in the middle of a line and it fires right when the text types out to that point; put
  one on its own line and it fires as the next line starts. Other capitals in brackets are just
  words.
- `*word*` shows in cold blue, `~word~` in red.
- Some scenes are idle chatter: the game plays one line each time you talk, in order, looping.
  Those say so in a note.

Notes for Claude:

- `((double brackets))` are notes for Claude: requests, questions, ideas. Put them anywhere, even
  in the middle of a line or across several lines. The game never shows them. Claude goes
  through them when you say "check the script", then deletes them or answers in place, like
  `((done: rewrote it))`. The dev panel (`?dev`) shows how many are waiting.
- A `#tag` the game doesn't know, like `#idea Gary knocks back`, is a note too.

Story tags change the game as the conversation reaches them. Each one goes on its own line:

- `#set name` turns a flag on, `#clear name` turns it off. A flag is just a word the game
  remembers, like `met-gary`. The dev panel lists every flag that's on right now.
- `#give name` gives you something. There's no inventory screen yet, so for now it works like
  `#set`: Gus's keys are the flag `keys`.
- `#if name` ... `#end` plays the lines in between only if the flag is on. `#if not name` is the
  opposite. Add `#else` for lines that play otherwise. They can go inside each other.
- `#goto scene-name` jumps to another scene and plays it instead of the rest of this one.
- A tag runs once the line before it has been read, or as the first line starts if it's at the
  top. Story flags the game already uses: `walkie` (you have the radio), `gary`, `gary2`,
  `job`, `done`, `haunt`, `home`, `job2`, `gus`, `keys`, `done2`, `grimoire`.

```
## gary-door
GARY: Oh! You're back.
#if walkie
WALTER: Ugh, Gary.
#else
GARY: No radio? Walter must be sulking.
#end
#set met-gary
```

`npm test` reports a typo: an `#if` with no `#end`, a `#goto` to a scene that doesn't exist, a
`((` with no `))`.

Writing that isn't in a scene (like this) is ignored.

# Bob's office

## office-arrive
(The first time you walk in.)
> The office is empty. Somewhere nearby, a walkie-talkie crackles.

## walkie-blackout
(You pick up the walkie. The lights stutter and go out. These lines play in the dark.)
WALTER: ~GARY!~ GET AWAY FROM THE NEW KID!
GARY: I was only saying hello.

## walkie-intro
(The lights come back, with a faint hiss under them.)
WALTER: Is this thing on? Course it's on. Everything's on. That's the trouble with everything.
WALTER: Name's Walter. Senior technician.
WALTER: Bob's not in. Bob's never in. Bob is a concept, like weekends.
WALTER: Ticket's on the job board. Go to the store, make the little lights go green. Green is good. Off is... we don't talk about off.
WALTER: And whatever you hear behind that locked door, you do NOT open it. Not that you could. Ha! Ha. Over.
> You clip the walkie to your belt. Press Q to call Walter.

## walkie-again
(Looking at the charger once you have the walkie.)
> The charger is empty. The walkie is on your belt.

## board-wo1
(The job board, the first time.)
> WORK ORDER #0001. Quik-Stop Forever, corner of Elm. Owner: Mrs. Finch.
> The router and switch are in the rack. The cables from both PCs are run to it, but nothing is plugged in or configured.
> Someone has added in pen: Do not restock the back cooler...they will not appreciate it.

## board-empty
> The board is empty except for a pin with a bit of paper still under it.

## board-wo2
(The job board, back home after the store.)
> WORK ORDER #0002. Spin Cycle Eternal, the 24-hour laundromat on Route 9. Night manager: Gus.
> Everything is cabled. The PCs are set to get an address automatically, but nothing on the router is set up to give them one.
> Someone has added in pen: Dryer 4 is not a customer.

## gary-meet
(Knocking on the locked door the first time.)
> You knock. Something on the other side stands up from a very comfortable chair.
GARY: Oh! Hi! You must be the new technician. I'm Gary.
GARY: I'd shake your hand, but the door's locked. It's always locked. That's okay! I've got a nice chair in here.
GARY: You're going to do great.
#if walkie
#goto gary-meet-walter
#end

## gary-meet2
(Knocking on the locked door the first second time.)
> You knock. Something on the other side stands up from a very comfortable chair.
GARY: If you need any tips,  just ask, Then maybe if your feeling good you can ~OPEN THE DOOR!!!!!!~(LIGHTS FLICKER)...ah im just kidding its great in here.


## gary-meet-walter
(gary-meet jumps here if you have the walkie.)
WALTER: Was that GARY? Don't talk to Gary. Gary knows what he did.
WALTER: ...I don't know what he did. But he KNOWS.
Walter: Ugh, Gary.

## gary-tips
(Idle chatter: one line per knock, looping.)
GARY: Remember, no shutdown turns an interface on. Two negatives! I think that's sort of charming.
GARY: If the first ping drops a packet, that's usually just ARP finding its way. Try it again before you worry.
GARY: Is Walter being mean about me again? That's all right. He's had a long year. A long lot of years.
GARY: Save your work with copy running-config startup-config. Things that aren't saved don't really stay.
GARY: show ip interface brief is my favorite. Everything you need on one screen, and nobody yells.

## photo
> EMPLOYEE OF THE MONTH, OCTOBER 1987: Walter. He looks exactly like he sounds. The photo is still warm.

## desk-sticky
(Bob's desk, before the grimoire.)
> A sticky note on Bob's monitor: "At the Cryptis quarterly. Sell the upgrade. Everybody needs the upgrade. -B"

## coffee
> The coffee machine is warm and full. It isn't plugged in. (can we do a save game here at the coffee pot)

## cabinet
> Invoices, all paid in full, all from addresses in Static Springs. The bottom drawer is labeled *BELLWETHER* and is empty.

## exit-no-walkie
> You should grab the walkie-talkie off the charger first.

## exit-no-ticket
WALTER: Whoa whoa whoa. Get the ticket kid.

## home-job1
(Walking back into the office after the store.)
WALTER: Job one, DONE! Confetti! Imagine confetti.  But dont imagine to hard, Confetti is illegal. 
WALTER: ...You didn't see anything weird out there, did you? No? Good. Good.
GARY: You did really well today. I'm proud of you.
WALTER: DON'T LISTEN TO HIM. Over.
WALTER: Oh, and kid? Fresh ticket on the job board. The laundromat out on Route 9. Gus has been calling since... well. Since. Over.

## home-job2
(Walking back into the office after the laundromat.)
WALTER: Two for two! You're a natural, kid. A natural what, I haven't decided.
WALTER: Bob's going to be thrilled. Bob is going to be... something. Over.
GARY: Did Dryer 4 get an address? I hope it did. Everybody should have somewhere to be.
WALTER: Kid. Before you clock out. Two jobs means you've earned the book.
WALTER: Bob's desk, bottom drawer. Every tech gets a *grimoire* sooner or later. The incantations are all in it, and whatever you pick up out there goes in it too.
WALTER: Don't let it read you first. Over.

## grimoire-drawer
(Bob's desk once Walter has told you about the book.)
> Bob's desk. The bottom drawer, the one Walter meant, slides open a little before you touch it.

## grimoire-find
(The cover's eyes tear open through static for a moment, then these lines.)
> A heavy book, bound in something that isn't leather. A diagram is pressed into the cover: lines, and little shut eyes where the lines meet.
> For a second, ~every one of them is open~. Looking at you.
> Then they're shut, and they were always shut. It's a book. It's warm, like someone was just holding it.

## grimoire-find-walter
(Only if you have the walkie.)
WALTER: Got it? Good. Don't read it in bed. Over.

## grimoire-got
> You've got the grimoire. Press G to open it.

# Job 1: Quik-Stop Forever

## shop-arrive
WALTER: Quik-Stop Forever! Finest gas station without any gas in the county.
WALTER: Rack's in the back office. Nothing's plugged in yet, so cable it up first: router to switch, PCs to switch. Then console in and make it SING.
WALTER: Then the two PCs. Register up front, other one in back. Over!

## finch-meet
MRS. FINCH: Oh good, you're from Bob's! Come in, come in. Mind the puddle. It isn't water, but it's very polite.
MRS. FINCH: The register and the back office computer can't see each other. Or the router. Or me, frankly.
MRS. FINCH: All the boxes with the blinking lights are in the back office. The thing that hums is the cooler. Please don't restock the cooler.

## finch-idle
(Idle chatter: one line each time you talk to her, looping.)
MRS. FINCH: Take your time, dear. Time doesn't mind it here.
MRS. FINCH: Would you like a soda? They're from the front cooler. The front one's fine.
MRS. FINCH: My late husband used to say a store's only as good as its network. He said it after he was late, too.

## finch-haunted
(After the thing plugs into Fa0/24.)
MRS. FINCH: Oh, don't mind that, dear. The cooler likes to be included. Now, that'll be all, and thank you!

## shop-desk
> A desk calendar, still on October 1987. Every day is crossed off, including the ones that haven't happened.

## shop-rack
(Shown above the rack's choices.)
> The rack hums. A light-blue console cable hangs off the side, waiting for your laptop.

## cooler
> BACK COOLER. A handwritten sign: DO NOT RESTOCK. Inside is milk dated October 1987. It's very cold.

## cooler-haunted
> The cooler hums a little louder than before.
> An Ethernet cable runs out the back of it and into the wall. You didn't put it there. ~Nobody did.~

## shelves
> Canned soup, motor oil, and a jar of something labeled ~TEETH (ASSORTED)~. Reasonably priced.

## jack
> A wall jack. According to the work order, nothing in the shop uses it.

## jack-haunted
(Shown above the choices: pull it out, or leave it.)
> A blue cable is seated in the jack. Nobody ran it. ~The plastic is warm.~

## jack-pull
(After the apparition.)
> The cable is *still in the jack*. Your hand is ~cold to the elbow~.

## shop-exit-early
WALTER: Leaving already? The ticket's not done, kid. Mrs. Finch is counting on you. So is... no one else. Over.

## done-cable
(Walter, as each part of the job gets done.)
WALTER: All plugged in! Hear that? That's the sound of lights thinking. Give the switch half a minute to trust everybody. Over.

## done-r1-name
WALTER: R1. Nice to meet it. It already knew your name. Over.

## done-r1-save
WALTER: Saved! Now R1 remembers you even after a reboot. Everything here remembers. Over.

## done-s1-console
WALTER: Locked up tight. Remember those passwords, kid. Writing them on the rack is how Gary started. Over.

## done-router
WALTER: Ooh, a green light! I felt that one in my fillings. Now the PCs. Over.

## done-pcs
WALTER: Addresses on both PCs. Look at you, giving things names. Names are boundaries, kid. Boundaries are important. Over.

## done-ping-router
WALTER: The router answers! Of course it answers. It's polite. Too polite, some would say. Over.

## haunt-job1
(The job is done. The lights flicker and something plugs into Fa0/24.)
> The lights flicker. In the back office, a link light clicks on.
WALTER: Hm? Fa0/24? Nothing's plugged into twenty-four. You can check the panel if you want. Or don't. I'd don't.
WALTER: Anyway! Ticket's DONE! Go tell Mrs. Finch and head home. Over.

# Job 2: Spin Cycle Eternal

## wash-arrive
WALTER: Spin Cycle Eternal! Open twenty-four hours a day, every day, fifty-one years running. Gus has never closed it. Gus has never LEFT it.
WALTER: Good news: it's all cabled. Bad news: the PCs want an address *handed* to them, automatic-like. That's DHCP. The router does the handing.
WALTER: Rack's in Gus's back office, through the back door. Gus has the keys; he's in his booth. And kid? Don't stare into the dryers. They stare back, and it's awkward for everybody. Over.

## gus-meet
GUS: You're from Bob's. Good. Good. I called it in on... what's today?
GUS: Doesn't matter. The computers keep asking for an address and nobody answers them. I know how they feel.
GUS: The kiosk out front, the PC in my office, and the printer. The printer likes its own spot, point five. The others take whatever they're given.
GUS: Equipment's in the back office. Here.
> Gus slides a ring of keys through the window. One is labeled BACK, in typewriter letters.
GUS: Don't mind the dryers. They run on their own. They always have.

## gus-idle
(Idle chatter: one line each time you talk to him, looping.)
GUS: Fifty-one years and I've never seen the end of a shift. Funny how that is.
GUS: Coffee's in the back if you want it. It's still hot. It's always still hot.
GUS: Dryer 4 asks me for an address every night. I tell it I haven't got one to give.
GUS: Gave up on the radio in '74. It only ever plays the spin cycle.

## gus-haunted
GUS: Everybody's got an address now. Even the ones that oughtn't. Thank you, kid. Shift's not over, though. It never is.

## wash-rack
(Shown above the rack's choices.)
> Gus's rack. Everything's cabled already, neat as a pin. The labels are typewritten, from 1974.

## backdoor-locked
> BACK OFFICE. EMPLOYEES ONLY. Locked, and it's a heavy old door. Gus will have the key.

## backdoor-open
> The key turns like it's been waiting for you. Behind the door, the hum of a rack and the smell of warm dust.

## wash-desk
> Gus's desk. A coffee mug that says WORLD'S OKAYEST MANAGER, still steaming. The coffee is from 1974 too.

## logbook
> GUS'S SHIFT LOG. The first page: 10/14/1974, Gus on shift. All machines spinning.
> Every page after it says the same thing, in the same handwriting, with the same pen.
> The newest entry is in capitals: DRYER 4 WON'T STOP ASKING FOR AN ADDRESS. ~0.0.0.0~
#if walkie
#goto logbook-walter
#end

## logbook-walter
(The logbook jumps here if you have the walkie.)
WALTER: Zero-dot-zero-dot-zero-dot-zero. That's what a machine calls itself before anybody's given it a name. Weird thing for a dryer to say. Over.

## archive
> Boxes of old logbooks, labeled by year. 1974. 1974. 1974. 1974. 1974.

## dryer4-first
(The close-up breaks up like a bad TV signal into an empty window.)
> DRYER 4. A sign taped to it says OUT OF ORDER, in handwriting from 1974. It's running anyway.
> There was ~something against the glass~. Now there's only fog, and somebody's clothes going round.

## dryer4-again
> Dryer 4 is still turning. Fog on the glass, clothes going round. *Nothing else.* You're nearly sure.

## dryers
> Industrial dryers, every one of them running, every one of them empty. The coin slots were taped over a long time ago.

## washers
> Top-loaders, back to back. One is full of grey water that isn't moving, even though the drum is.

## lostfound
> LOST & FOUND. Socks, cracked glasses, two watches stopped at 3:14, a phone handset. And Polaroids of this room, ~taken from inside the dryers~.

## change
> CHANGE MACHINE. A light says OUT OF CHANGE. It gives you a quarter anyway. The quarter is warm, and dated 1974.

## soap
> Detergent, at 1974 prices. Every box rattles like it's full of something smaller than soap.

## toilet
> The restroom. A sign on the door: CUSTOMERS ONLY. The guest book inside has one name in it, over and over. Gus.

## wash-exit-early
WALTER: Not yet, kid. Gus has been waiting fifty-one years for somebody to finish a job. Don't make it fifty-two. Over.

## wash-done-router
(Walter, as each part of the job gets done.)
WALTER: Gi0/0 is up. The router's awake. That's the easy part. Over.

## wash-done-pool
WALTER: The pool's open! Now anything that asks gets an answer. ANYTHING. ...Ha. Over.

## wash-done-leases
WALTER: Leases! Both PCs got addresses. show ip dhcp binding on the router lists who's got what. Over.

## wash-ask-binding
(Once the network work is done.)
WALTER: Pings come back, printer's got its spot. Nice work, kid.
WALTER: One more thing before you go. On the router: show ip dhcp binding. Make sure it's just our two PCs on the list. Over.

## haunt-job2
(A ghost lease statics into the binding table and out again.)
> Every dryer in the place stops at once. In the quiet, one of them starts up again. You don't have to look to know which.
WALTER: Kid? Was there a third line on that list just now? Point zero. You can't lease point zero. That's the *network*.
WALTER: ...No. Two PCs, two leases. That's what the paperwork says, so that's what happened. Ticket's DONE. Tell Gus and come on home. Over.

# Walter's hints (press Q)

(The game picks the first hint that fits where you are.)

## hint-home
WALTER: Fresh ticket on the job board, kid. Over.

## hint-board
WALTER: The JOB BOARD, kid. The big cork thing on the wall. Over.

## hint-front-door
WALTER: Front door, kid. The store won't network itself. It's tried. Over.

## hint-done
WALTER: You're done! Go home. Don't look at the cooler on the way out. Over.

## hint-cable
WALTER: Cables first! Back of the rack. Router Gi zero slash zero to the switch, and both PC cables into the switch. Amber light means it's thinking about it. Over.

## hint-r1-name
WALTER: Router first, and finish it before you touch anything else. configure terminal, hostname R1. Unnamed things attract attention. Over.

## hint-r1-secret
WALTER: Now lock the door. enable secret, then something only you know. Not 'password'. Gary used 'password'. Over.

## hint-r1-console
WALTER: And the console port. line console 0, password, then login. Otherwise anybody with a blue cable walks right in. Anybody. Over.

## hint-router
WALTER: Router next. In the rack, configure terminal, interface gi0/0, ip address, no shutdown. Incantations, kid! Over.

## hint-r1-save
WALTER: Now save it. copy running-config startup-config. Running config is what it's thinking; startup is what it remembers. Make it remember. Over.

## hint-s1-name
WALTER: Router's done. Switch tab on your laptop, kid. Same three: hostname S1, enable secret, console password. Over.

## hint-s1-secret
WALTER: Enable secret on the switch too. Different from the router's, if you're smart. Over.

## hint-s1-console
WALTER: Switch console: line console 0, password, login. Then the PCs. Over.

## hint-s1-save
WALTER: Save the switch too, same incantation. Then the PCs. Over.

## hint-register
WALTER: The register's at the counter. On a PC it's ipconfig, address, mask, gateway. Over.

## hint-office
WALTER: Now the back office PC. Same deal, point one-one. Over.

## hint-ping-router
WALTER: Ping the router from BOTH PCs. If the first one drops, that's ARP. Not ghosts. Usually. Over.

## hint-ping-pc
WALTER: Last thing: ping one PC from the other. Over.

## hint2-grimoire
WALTER: Read the book, kid. G. It's better company than Gary. Don't tell him I said that. Over.

## hint2-ask-grimoire
WALTER: Bob's desk, kid. Bottom drawer. The book's expecting you. Over.

## hint2-done
WALTER: You're done! Come on home. And don't take any socks from the lost and found. Over.

## hint2-travel
WALTER: Route 9, kid. The van's out front. Over.

## hint2-keys
WALTER: Gear's behind the back door and Gus has the keys. He's in the booth by the kiosk. Go say hi. Over.

## hint2-backdoor
WALTER: You've got Gus's keys. Back door, top left. Over.

## hint2-router
WALTER: Router first. interface gi0/0, ip address 192.168.20.1 255.255.255.0, no shutdown. Same as last time, new numbers. Over.

## hint2-excluded
WALTER: Now fence off the low addresses so DHCP doesn't hand out the printer's spot. ip dhcp excluded-address 192.168.20.1 192.168.20.20, in global config. Over.

## hint2-pool
WALTER: Now the pool. ip dhcp pool, any name you like, then network 192.168.20.0 255.255.255.0 and default-router 192.168.20.1. That's the router promising to answer. Over.

## hint2-printer
WALTER: The printer doesn't take handouts. On the printer: ipconfig 192.168.20.5 255.255.255.0 192.168.20.1. A fixed address, like a house. Over.

## hint2-renew
WALTER: The PCs asked once, nobody answered, and they sulked. On each one: ipconfig /renew. Over.

## hint2-ping
WALTER: Ping the printer, 192.168.20.5, from both PCs. Over.

## hint2-binding
WALTER: Last thing: on the router, show ip dhcp binding. Make sure it's just our two PCs on the list. Over.
