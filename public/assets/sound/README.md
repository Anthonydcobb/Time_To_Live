# Sound files the game plays

Only files the game actually uses live here. The folder says where a sound plays and the name says
what it is. Paths are set at the top of `src/game/audio.ts`, so update them there if you move or
rename a file. Drafts and sources stay in `art/music/` (and agy's unused drafts are still in
`public/assets/audio/`) until they're wired in.

| File | What it is | Where it plays | Volume setting | Source |
|---|---|---|---|---|
| `music/bobs-office-theme-loop.mp3` | Bob's theme, take 6 | Loops in Bob's office | `MUSIC_LEVEL` | `art/music/Bobs Theme/bobs-office-lofi-take6-unsettling-static.mp3` |
| `ui/dialogue-typing-loop.mp3` | Soft key clicks | Under every dialogue line while it types out | `TYPING_LEVEL` | `art/music/ui-sfx/dialogue-typing-soft-muted.mp3` (agy) |
| `office/gary-door-bang.mp3` | A metal door bang, first second with a fade | Each time you talk to Gary through his door | `GARY_BANG_LEVEL` | `art/music/ui-sfx/downloaded/tanweraman-door-bang-echo-505135.mp3` (Pixabay; check the license before release) |

Built live in code, with no file: the light hum in every room, the store's fridges and whispers,
the throb behind Gary's door, Walter's walkie squelch and static, and the apparition's static
burst.
