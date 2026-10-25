# Antigravity (agy) Session Handoff — Audio, 3D & Pixel Pipeline

Last updated: 2026-10-23

## 1. Division of Labor (with Claude Code)
- **Do NOT edit `src/game/`** — Claude wires code/assets into the game.
- **Audio Direction & Lexicon:** Read [`docs/audio-direction.md`](./audio-direction.md) and [`script/lexicon.md`](../script/lexicon.md).
  - Tone: **Cosmic horror** (vast, indifferent, half-heard, `< 3s` stingers, ordinary tech noise slipping), **not** comedic/Dungeon Crawler Carl.
  - Put source/working audio in `art/music/`. Drafts can sit in `public/assets/audio/`, but files the game actually plays live in `public/assets/sound/<where it plays>/` (`music/`, `ui/`, `office/`...); its README lists each one. Claude moves a sound there when it's wired in.
  - Room music loops, so a looping track needs no fade-in or fade-out, or it dips every time it repeats.
- **3D & Pixel Pipeline:**
  - High-res 3D renders shine for close-up inspection cards, dialogue portraits, 4-direction character walk cycles (`16×32`), and animated machines.
  - Don't commit `.blend1` backup files or anything in `art/inspiration/`.
  - Only show the **Hyper3D Credit Reminder** when Hyper3D is actually used (`34.5 credits` remaining: `29.5` Subscription + `5.0` Regular).

## 2. Tools Installed & Ready
- **ACE-Step 1.5 (Local AI Music Generator):**
  - Installed at `C:\Users\antho\Documents\ACE-Step-1.5` (`.venv` with Python 3.11 + PyTorch 2.7.1 CUDA 12.8 + `flash_attention_2` for the 8 GB NVIDIA RTX PRO 2000 Blackwell GPU).
  - Configured via `C:\Users\antho\Documents\ACE-Step-1.5\.env` (`acestep-v15-turbo`).
  - Launch UI: `start_gradio_ui.bat` or `.venv\Scripts\acestep.exe` (`http://127.0.0.1:7860`).
- **Hyper3D CLI (`@hyper3d/cli`):** `C:\Users\antho\AppData\Roaming\npm\hyper3d.ps1` (authenticated via OAuth).
- **Blender 5.1:** `C:\Program Files\Blender Foundation\Blender 5.1\blender.exe`
- **Aseprite:** `C:\Program Files\Aseprite\Aseprite.exe`

## 3. Audio Assets Created & Organized (`art/music/`)
- **Approved Music Themes:**
  - **Bob's Office (`art/music/Bobs Theme/`):** Approved `bobs-office-lofi-take6-unsettling-static.mp3` (`78 BPM`, `F minor`, chill & eerie lo-fi beat + faint scratchy vinyl/radio static + subtle tape pitch warble; updated with `extra-soft-drums` HPSS drum reduction `~5.6 dB` + `3.5s` intro fade-in + `6.5s` outro fade-out, synced to `public/assets/sound/music/bobs-office-theme-loop.mp3`; original preserved in `Bobs - (other)/bobs-office-lofi-take6-unsettling-static-original.mp3`).
  - **Haunt / Blackout Theme (`art/music/Haunt Theme/`):** `haunt-blackout-take1-heavy-static.mp3` & `take2-heavy-static.mp3` (`72 BPM`, `C# minor`, corrupted remix of Take 6 with heavy static & sub-bass pulse).
  - **Title / Start-Screen Theme (`art/music/Title Theme/`):** `title-theme-take1.mp3` & `title-theme-take2.mp3` (`68 BPM`, `D minor`, lonely small-town carrier wave + vast sub-bass).
- **Custom Edited SFX (`art/music/created-sfx/` & `public/assets/audio/`):**
  - `dialogue-typing-soft-muted-2s.mp3` (`public/assets/audio/dialogue-typing.mp3`) — Approved `2.00s` seamless dampened keyboard loop for dialogue/investigation text crawl.
  - `gary-door-bang.mp3` & `gary-door-bang-slower.mp3` — Double metal bang + smooth echo fade-out cut from `sfx-metal-door-hit-into-echo-wall-41s.mp3`.
  - `metal-wall-of-sound-full.mp3` (`25.1s`) & `metal-wall-of-sound-10s-loop.mp3` (`10.0s`) — Extracted from the end wall-of-sound of `sfx-metal-door-hit-into-echo-wall-41s.mp3`.
- **Downloaded Raw Foley Library (`art/music/ui-sfx/downloaded/`):**
  - Organized and renamed into 5 category subfolders:
    - `metal-doors\` (6 files)
    - `keyboards\` (5 files)
    - `radio-and-statics\` (6 files)
    - `room-ambience\` (1 file: `ambience-laundry-room-washers-33s.mp3`)
    - `cosmic-horror-and-music\` (5 files)

## 4. 3D Models & Sprites Created (`art/models/`)
- **Walter's Walkie-Talkie (`art/models/walter-walkie/`):**
  - `walter-walkie.blend`, `walter-walkie-polished.glb`, `walter-walkie-render.png` (used by Claude for Walter's portrait & close-up card).
  - `walkie-16x32-v2.png` (and `art/source/props/walkie-v2.aseprite`) — Built to Claude's exact `16×32` 2-frame side-table spec and 16-color palette.
- **3D Relief Floor Tiles (`art/models/tiles-3d-relief/`):**
  - `relief-floor-tiles.blend`, `relief-floor-tiles-16x16.png`, `relief-floor-tiles-16x16-x8.png`.
- **Main Screen 1980s Movie Poster Concept Sketches (`art/concepts/title-screen/`):**
  - `poster-sketch-1-carpenter-beam.jpg` (John Carpenter / *The Thing* rack beam & B&B van at 3:14 AM)
  - `poster-sketch-2-struzan-montage.jpg` (Drew Struzan ensemble pyramid montage with dark menu space on right)
  - `poster-sketch-3-crt-abyss.jpg` (*Videodrome* / *Poltergeist* `Fa0/24` fissure & CRT eye-monitors)
  - `poster-sketch-4-static-springs-vortex.jpg` (*Creepshow* / Stephen King Main Street trunk-cable tentacles & routing-loop moon vortex)
