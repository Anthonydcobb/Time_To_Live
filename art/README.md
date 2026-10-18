# Art

Working files live here. Game-ready sprite sheets live in `public/assets/sprites/`,
which Vite serves at `/assets/sprites/...`.

```
art/
├── concepts/    reference and inspiration images, never loaded by the game
├── source/      Aseprite source files (.aseprite)
└── previews/    enlarged PNGs for reviewing sprites, not loaded by the game

public/assets/sprites/   exported PNG sprite sheets the game loads
```

Each folder is split by category (`characters/`, later `props/`, `tiles/`, ...).

## Naming

Lowercase, words separated by dashes. A sprite keeps the same name everywhere:

| What | Path |
| --- | --- |
| Concept | `art/concepts/characters/player-walk-concept.jpg` |
| Source | `art/source/characters/player-walk.aseprite` |
| Preview | `art/previews/characters/player-walk-x8.png` |
| Game sheet | `public/assets/sprites/characters/player-walk.png` |

## Sprite sheet format

- Tiles: 16x16 px
- Characters: 16x32 px per frame
- Frames run left to right
- Rows, top to bottom: down, up, left, right
- Transparent background

## Source file layers

- `reference`: the concept scaled to the sheet, locked and faint, for tracing. Hide it before exporting.
- `player` (or the sprite's name): the actual pixels. Only this layer goes into the game sheet.
