/** Grey-box rooms. Each map character is one 16 px tile, drawn at 4x. */
export const TILE = 64;

export type RoomId = "office" | "shop";

/** Something in a room you can bump into or press E on. Positions are in tiles. */
export interface Prop {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** What the E prompt says, like "Read" or "Talk to". */
  verb: string;
  color: number;
  /** Hung on a wall, so it doesn't need its own collision. */
  onWall?: boolean;
  /** A loaded spritesheet key to stand here instead of the grey box. */
  sprite?: string;
  /** Which frame of `sprite` to show (default 0). */
  frame?: number;
  /** Drawn by another prop's sprite: no box, label or collision of its own, but still usable. */
  hidden?: boolean;
  /** Set dressing: you bump into it, but there's nothing to press E on. */
  decor?: boolean;
}

export interface RoomDef {
  id: RoomId;
  title: string;
  /** `#` wall, `.` floor, space for outside the building. */
  map: string[];
  props: Prop[];
  /** Where you appear, in tiles. */
  spawn: { x: number; y: number };
  /** A loaded 16 px tileset for the floor and walls. Without one the room is flat grey boxes. */
  tiles?: string;
  /** If set, the room is dark except for these. Without lights the room is evenly lit. */
  lights?: { ambient: number; lamps: Lamp[] };
}

/** A pool of light. Position and radius are in tiles. */
export interface Lamp {
  x: number;
  y: number;
  r: number;
  color: number;
  /** Stretch sideways, for long fluorescent tubes. */
  wide?: number;
  /** Buzzes and cuts out now and then. */
  flicker?: boolean;
}

const FLUORESCENT = 0xb8e0b0;
const BULB = 0xe8c888;

/**
 * Frames in a room tileset. Row 0 is floor; row 1 is the wall top, one-tile wall faces and
 * the top halves of two-tile walls; row 2 is the bottom halves. Each list is frame and weight;
 * a tile's spot in the room picks one, so the same room always looks the same.
 */
export const FLOOR_FRAMES: [number, number][] = [[0, 30], [1, 28], [6, 18], [7, 10], [2, 4], [3, 4], [4, 4], [5, 2]];
export const WALL_FACE_FRAMES: [number, number][] = [[9, 55], [10, 18], [11, 13], [12, 14]];
export const WALL_UPPER_FRAMES: [number, number][] = [[13, 80], [14, 20]];
export const WALL_LOWER_FRAMES: [number, number][] = [[16, 60], [17, 18], [18, 12], [19, 10]];
export const WALL_TOP_FRAME = 8;

export function pickFrame(tx: number, ty: number, frames: [number, number][]): number {
  const h = (((tx * 73856093) ^ (ty * 19349663)) >>> 0) % 100;
  let acc = 0;
  for (const [frame, weight] of frames) {
    acc += weight;
    if (h < acc) return frame;
  }
  return frames[0][0];
}

export const ROOMS: Record<RoomId, RoomDef> = {
  office: {
    id: "office",
    title: "Bob's Bandwidth & Bloodletting",
    map: [
      "###############",
      "#.............#",
      "#.............#",
      "#.............#",
      "#.............#",
      "#.............#",
      "#.............#",
      "#.............#",
      "#.............#",
      "###############",
    ],
    props: [
      { id: "photo", label: "Photo", x: 3, y: 0, w: 1, h: 1, verb: "Look at", color: 0x6b6450, onWall: true },
      { id: "board", label: "Job board", x: 6, y: 0, w: 2, h: 1, verb: "Read", color: 0x7a6a48, onWall: true },
      { id: "gary", label: "Locked door", x: 10, y: 0, w: 1, h: 1, verb: "Knock on", color: 0x5a2a2a, onWall: true },
      { id: "desk", label: "Bob's desk", x: 2, y: 2, w: 3, h: 1, verb: "Look at", color: 0x55524a },
      { id: "walkie", label: "Walkie", x: 8, y: 2, w: 1, h: 1, verb: "Pick up", color: 0x4a5a4a, sprite: "walkie" },
      { id: "coffee", label: "Coffee", x: 13, y: 5, w: 1, h: 1, verb: "Use", color: 0x4a4440 },
      { id: "cabinet", label: "Files", x: 1, y: 6, w: 1, h: 2, verb: "Open", color: 0x50504a },
      { id: "exit", label: "Front door", x: 7, y: 9, w: 1, h: 1, verb: "Go out", color: 0x3a3428, onWall: true },
    ],
    spawn: { x: 7, y: 7 },
  },
  shop: {
    id: "shop",
    title: "Quik-Stop Forever",
    // From art/concepts/locations/mrs-finch-store-layout.jpg: hallway top left,
    // back office below it, the shop floor on the right.
    map: [
      "   ##################",
      "   ##################",
      "   #...#............#",
      "   #................#",
      "   #...#............#",
      "   #...#............#",
      "#####.##............#",
      "#......#............#",
      "#......#............#",
      "#......#............#",
      "#......#............#",
      "#......#............#",
      "#......#............#",
      "#####################",
    ],
    props: [
      // Hallway
      { id: "boxes", label: "Boxes", x: 4, y: 2, w: 1, h: 2, verb: "", color: 0x5e5240, decor: true, sprite: "store-decor", frame: 7 },
      { id: "broom", label: "Broom", x: 6, y: 5, w: 1, h: 1, verb: "", color: 0x5a4a32, decor: true, sprite: "store-decor", frame: 11 },
      // Back office
      { id: "rack", label: "Rack\nR1 S1", x: 1, y: 7, w: 2, h: 1, verb: "Work on", color: 0x3c4450, sprite: "store-rack" },
      { id: "storage", label: "Storage", x: 3, y: 7, w: 1, h: 1, verb: "", color: 0x50504a, decor: true, sprite: "store-decor", frame: 8 },
      { id: "files", label: "Files", x: 1, y: 9, w: 1, h: 2, verb: "", color: 0x50504a, decor: true, sprite: "store-decor", frame: 5 },
      { id: "files", label: "Files", x: 6, y: 8, w: 1, h: 2, verb: "", color: 0x50504a, decor: true, sprite: "store-decor", frame: 5 },
      { id: "desk", label: "Desk", x: 6, y: 10, w: 1, h: 2, verb: "Look at", color: 0x55524a, sprite: "store-decor", frame: 3 },
      { id: "office", label: "PC1", x: 6, y: 10, w: 1, h: 1, verb: "Use", color: 0x46504a, hidden: true },
      { id: "chair", label: "Chair", x: 5, y: 11, w: 1, h: 1, verb: "", color: 0x4a3a44, decor: true, sprite: "store-decor", frame: 4 },
      { id: "storage", label: "Storage", x: 1, y: 12, w: 1, h: 1, verb: "", color: 0x50504a, decor: true, sprite: "store-decor", frame: 8 },
      { id: "boxes", label: "Boxes", x: 2, y: 12, w: 1, h: 1, verb: "", color: 0x5e5240, decor: true, sprite: "store-decor", frame: 6 },
      // Shop floor
      // Four two-door units with different stock (frames 0-3 of the sheet).
      { id: "cooler", label: "Fridges", x: 9, y: 2, w: 2, h: 1, verb: "Look at", color: 0x4a5a66, sprite: "store-fridges", frame: 0 },
      { id: "cooler", label: "Fridges", x: 11, y: 2, w: 2, h: 1, verb: "Look at", color: 0x4a5a66, sprite: "store-fridges", frame: 1 },
      { id: "cooler", label: "Fridges", x: 13, y: 2, w: 2, h: 1, verb: "Look at", color: 0x4a5a66, sprite: "store-fridges", frame: 2 },
      { id: "cooler", label: "Fridges", x: 15, y: 2, w: 2, h: 1, verb: "Look at", color: 0x4a5a66, sprite: "store-fridges", frame: 3 },
      // Frame 1 is the jack with roots growing out of it, shown once the haunt starts.
      { id: "jack", label: "Jack", x: 7, y: 5, w: 1, h: 1, verb: "Look at", color: 0x3a3a36, onWall: true, sprite: "store-jack" },
      { id: "baskets", label: "Baskets", x: 18, y: 2, w: 1, h: 1, verb: "", color: 0x5a3a3a, decor: true, sprite: "store-decor", frame: 9 },
      { id: "baskets", label: "Baskets", x: 8, y: 5, w: 1, h: 1, verb: "", color: 0x5a3a3a, decor: true, sprite: "store-decor", frame: 9 },
      { id: "shelf1", label: "Wall\nshelf", x: 8, y: 7, w: 1, h: 4, verb: "Look at", color: 0x5a5244, sprite: "store-decor", frame: 1 },
      { id: "shelf1", label: "Shelf", x: 10, y: 6, w: 1, h: 4, verb: "Look at", color: 0x5a5244, sprite: "store-decor", frame: 0 },
      { id: "shelf2", label: "Shelf", x: 12, y: 6, w: 1, h: 4, verb: "Look at", color: 0x5a5244, sprite: "store-decor", frame: 13 },
      { id: "shelf1", label: "Shelf", x: 14, y: 6, w: 1, h: 4, verb: "Look at", color: 0x5a5244, sprite: "store-decor", frame: 14 },
      // The counter sprite carries the CRT (PC0), keyboard and cash register; the register
      // is listed after it so the CRT end of the counter offers "Use Register PC0".
      { id: "counter", label: "Counter", x: 18, y: 4, w: 1, h: 4, verb: "Lean on", color: 0x5a5448, sprite: "store-counter" },
      { id: "register", label: "Register\nPC0", x: 18, y: 4, w: 1, h: 1, verb: "Use", color: 0x46504a, hidden: true },
      { id: "finch", label: "Mrs.\nFinch", x: 19, y: 5, w: 1, h: 1, verb: "Talk to", color: 0x6a5a7a, sprite: "mrs-finch" },
      { id: "shelf2", label: "Wall\nshelf", x: 19, y: 9, w: 1, h: 2, verb: "Look at", color: 0x5a5244, sprite: "store-decor", frame: 2 },
      { id: "bins", label: "Bins", x: 19, y: 11, w: 1, h: 2, verb: "", color: 0x3a3a36, decor: true, sprite: "store-decor", frame: 12 },
      { id: "boxes", label: "Boxes", x: 17, y: 12, w: 1, h: 1, verb: "", color: 0x5e5240, decor: true, sprite: "store-decor", frame: 6 },
      { id: "baskets", label: "Baskets", x: 8, y: 12, w: 2, h: 1, verb: "", color: 0x5a3a3a, decor: true, sprite: "store-decor", frame: 10 },
      { id: "exit", label: "Door", x: 14, y: 13, w: 2, h: 1, verb: "Leave", color: 0x3a3428, onWall: true },
    ],
    spawn: { x: 14, y: 12 },
    tiles: "store-tiles",
    // Green fluorescent tubes from the concept, a bare bulb in the hallway. The corner by the
    // wall jack is left in the dark on purpose.
    lights: {
      ambient: 0x4a524a,
      lamps: [
        { x: 11, y: 3.6, r: 3.2, color: FLUORESCENT, wide: 1.5 },
        { x: 15, y: 3.6, r: 3.2, color: FLUORESCENT, wide: 1.5 },
        { x: 12.5, y: 8, r: 3.6, color: FLUORESCENT, wide: 1.4 },
        { x: 18.5, y: 5.5, r: 3, color: FLUORESCENT, wide: 1.2 },
        { x: 13, y: 11.6, r: 3, color: FLUORESCENT, wide: 1.4, flicker: true },
        { x: 5.5, y: 3.2, r: 2.2, color: BULB },
        { x: 3.5, y: 9.5, r: 3.4, color: FLUORESCENT, wide: 1.3 },
      ],
    },
  },
};
