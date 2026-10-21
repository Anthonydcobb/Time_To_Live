/** Grey-box rooms. Each map character is one 16 px tile, drawn at 4x. */
export const TILE = 64;

export type RoomId = "office" | "shop" | "laundromat";

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
  /** An illustrated close-up shown above the dialogue while you inspect it. */
  card?: string;
  /** The same picture with whatever was in it gone. The card breaks up like a bad TV signal into this. */
  cardGone?: string;
  /** Set dressing: you bump into it, but there's nothing to press E on. */
  decor?: boolean;
  /** A door in a wall gap: solid until the story opens it (flag `open:<room>:<id>`, event "open"). */
  door?: boolean;
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
  /** Floor frames and weights for this room's tileset, if not the store's FLOOR_FRAMES. */
  floor?: [number, number][];
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
    // From art/concepts/locations/bobs-office-layout.jpg: the corridor to Gary's door top
    // left, Bob's own office below it, the main office with the tech desks on the right.
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
      "#...................#",
      "#####################",
    ],
    // Art: "office-props" frames 0 tech desks, 1 Bob's desk, 2 boss chair, 3 task chair, 4 coffee,
    // 5 Gary's door (6 haunted), 7 incident board, 8 server rack, 9 front door, 10 photo,
    // 11 small file cabinet. Files, boxes and storage borrow the store's "store-decor" sheet.
    props: [
      // The corridor: Gary's padlocked door at the end of it.
      { id: "gary", label: "Locked door", x: 4, y: 1, w: 2, h: 1, verb: "Knock on", color: 0x5a2a2a, onWall: true, sprite: "office-props", frame: 5, card: "assets/cards/gary-door.webp" },
      // Bob's office
      { id: "photo", label: "Photo", x: 2, y: 6, w: 1, h: 1, verb: "Look at", color: 0x6b6450, onWall: true, sprite: "office-props", frame: 10 },
      { id: "cabinet", label: "Files", x: 1, y: 7, w: 1, h: 1, verb: "Open", color: 0x50504a, sprite: "office-props", frame: 11 },
      { id: "files", label: "Files", x: 2, y: 7, w: 1, h: 1, verb: "", color: 0x50504a, decor: true, sprite: "office-props", frame: 11 },
      { id: "storage", label: "Storage", x: 3, y: 7, w: 1, h: 1, verb: "", color: 0x50504a, decor: true, sprite: "store-decor", frame: 8 },
      { id: "chair", label: "Chair", x: 2, y: 8, w: 1, h: 1, verb: "", color: 0x3a3a36, decor: true, sprite: "office-props", frame: 2 },
      { id: "desk", label: "Bob's desk", x: 1, y: 9, w: 3, h: 1, verb: "Look at", color: 0x55524a, sprite: "office-props", frame: 1, card: "assets/cards/bobs-desk.webp" },
      // Listed after the desk so the walkie wins the spot it sits on.
      { id: "walkie", label: "Walkie", x: 2, y: 9, w: 1, h: 1, verb: "Pick up", color: 0x4a5a4a, sprite: "walkie" },
      { id: "armchair", label: "Armchair", x: 1, y: 12, w: 1, h: 1, verb: "", color: 0x4a3a44, decor: true, sprite: "office-props", frame: 2 },
      // Main office
      { id: "files", label: "Files", x: 8, y: 5, w: 1, h: 1, verb: "", color: 0x50504a, decor: true, sprite: "office-props", frame: 11 },
      { id: "files", label: "Files", x: 8, y: 7, w: 1, h: 2, verb: "", color: 0x50504a, decor: true, sprite: "store-decor", frame: 5 },
      { id: "files", label: "Files", x: 8, y: 9, w: 1, h: 2, verb: "", color: 0x50504a, decor: true, sprite: "store-decor", frame: 5 },
      { id: "boxes", label: "Boxes", x: 9, y: 2, w: 1, h: 1, verb: "", color: 0x5e5240, decor: true, sprite: "store-decor", frame: 6 },
      { id: "boxes", label: "Boxes", x: 10, y: 2, w: 1, h: 1, verb: "", color: 0x5e5240, decor: true, sprite: "store-decor", frame: 6 },
      { id: "board", label: "Job board", x: 11, y: 1, w: 5, h: 1, verb: "Read", color: 0x7a6a48, onWall: true, sprite: "office-props", frame: 7 },
      { id: "files", label: "Files", x: 16, y: 2, w: 1, h: 1, verb: "", color: 0x50504a, decor: true, sprite: "office-props", frame: 11 },
      { id: "files", label: "Files", x: 17, y: 2, w: 1, h: 1, verb: "", color: 0x50504a, decor: true, sprite: "office-props", frame: 11 },
      { id: "server", label: "Server\nrack", x: 19, y: 2, w: 1, h: 2, verb: "", color: 0x3c4450, decor: true, sprite: "office-props", frame: 8 },
      { id: "techdesks", label: "Tech\ndesks", x: 10, y: 6, w: 2, h: 2, verb: "", color: 0x55524a, decor: true, sprite: "office-props", frame: 0 },
      { id: "techdesks", label: "Tech\ndesks", x: 10, y: 8, w: 2, h: 2, verb: "", color: 0x55524a, decor: true, sprite: "office-props", frame: 0 },
      { id: "chair", label: "Chair", x: 9, y: 6, w: 1, h: 1, verb: "", color: 0x4a3a44, decor: true, sprite: "office-props", frame: 3 },
      { id: "chair", label: "Chair", x: 9, y: 8, w: 1, h: 1, verb: "", color: 0x4a3a44, decor: true, sprite: "office-props", frame: 3 },
      { id: "chair", label: "Chair", x: 12, y: 7, w: 1, h: 1, verb: "", color: 0x4a3a44, decor: true, sprite: "office-props", frame: 3 },
      { id: "chair", label: "Chair", x: 12, y: 9, w: 1, h: 1, verb: "", color: 0x4a3a44, decor: true, sprite: "office-props", frame: 3 },
      // The right-hand pod is one desk short, which opens the floor up toward the coffee.
      { id: "techdesks", label: "Tech\ndesks", x: 15, y: 6, w: 2, h: 2, verb: "", color: 0x55524a, decor: true, sprite: "office-props", frame: 0 },
      { id: "chair", label: "Chair", x: 14, y: 6, w: 1, h: 1, verb: "", color: 0x4a3a44, decor: true, sprite: "office-props", frame: 3 },
      { id: "chair", label: "Chair", x: 17, y: 7, w: 1, h: 1, verb: "", color: 0x4a3a44, decor: true, sprite: "office-props", frame: 3 },
      { id: "files", label: "Files", x: 19, y: 5, w: 1, h: 2, verb: "", color: 0x50504a, decor: true, sprite: "store-decor", frame: 5 },
      { id: "files", label: "Files", x: 19, y: 7, w: 1, h: 1, verb: "", color: 0x50504a, decor: true, sprite: "office-props", frame: 11 },
      { id: "files", label: "Files", x: 19, y: 9, w: 1, h: 2, verb: "", color: 0x50504a, decor: true, sprite: "store-decor", frame: 5 },
      { id: "storage", label: "Storage", x: 10, y: 12, w: 1, h: 1, verb: "", color: 0x50504a, decor: true, sprite: "store-decor", frame: 8 },
      { id: "storage", label: "Storage", x: 11, y: 12, w: 1, h: 1, verb: "", color: 0x50504a, decor: true, sprite: "store-decor", frame: 8 },
      { id: "coffee", label: "Coffee", x: 15, y: 12, w: 1, h: 1, verb: "Use", color: 0x4a4440, sprite: "office-props", frame: 4, card: "assets/cards/coffee-station.webp" },
      { id: "boxes", label: "Boxes", x: 18, y: 11, w: 1, h: 1, verb: "", color: 0x5e5240, decor: true, sprite: "store-decor", frame: 6 },
      { id: "boxes", label: "Boxes", x: 19, y: 11, w: 1, h: 1, verb: "", color: 0x5e5240, decor: true, sprite: "store-decor", frame: 6 },
      { id: "boxes", label: "Crates", x: 17, y: 12, w: 1, h: 1, verb: "", color: 0x5e5240, decor: true, sprite: "store-decor", frame: 6 },
      { id: "boxes", label: "Crates", x: 18, y: 12, w: 1, h: 1, verb: "", color: 0x5e5240, decor: true, sprite: "store-decor", frame: 6 },
      { id: "boxes", label: "Crates", x: 19, y: 12, w: 1, h: 1, verb: "", color: 0x5e5240, decor: true, sprite: "store-decor", frame: 6 },
      { id: "exit", label: "Front door", x: 12, y: 13, w: 2, h: 1, verb: "Go out", color: 0x3a3428, onWall: true, sprite: "office-props", frame: 9 },
    ],
    spawn: { x: 12, y: 11 },
    // Scuffed linoleum instead of the store's tile; the walls are the same.
    tiles: "office-tiles",
    floor: [[0, 40], [1, 36], [2, 8], [3, 4], [4, 4], [5, 2], [6, 4], [7, 2]],
    lights: {
      ambient: 0x464e48,
      lamps: [
        { x: 13.5, y: 3.4, r: 3.2, color: FLUORESCENT, wide: 1.6 },
        { x: 11, y: 8, r: 3.2, color: FLUORESCENT, wide: 1.3 },
        { x: 16, y: 8, r: 3.2, color: FLUORESCENT, wide: 1.3 },
        { x: 13, y: 11.8, r: 2.6, color: FLUORESCENT, wide: 1.3 },
        { x: 3.5, y: 9.5, r: 3.2, color: FLUORESCENT, wide: 1.2 },
        // The bulb outside Gary's door doesn't hold steady.
        { x: 5, y: 3.2, r: 2, color: BULB, flicker: true },
      ],
    },
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
      { id: "shelf1", label: "Wall\nshelf", x: 8, y: 7, w: 1, h: 4, verb: "Look at", color: 0x5a5244, sprite: "store-decor", frame: 1, card: "assets/cards/jar-of-teeth.webp" },
      { id: "shelf1", label: "Shelf", x: 10, y: 6, w: 1, h: 4, verb: "Look at", color: 0x5a5244, sprite: "store-decor", frame: 0, card: "assets/cards/jar-of-teeth.webp" },
      { id: "shelf2", label: "Shelf", x: 12, y: 6, w: 1, h: 4, verb: "Look at", color: 0x5a5244, sprite: "store-decor", frame: 13, card: "assets/cards/jar-of-teeth.webp" },
      { id: "shelf1", label: "Shelf", x: 14, y: 6, w: 1, h: 4, verb: "Look at", color: 0x5a5244, sprite: "store-decor", frame: 14, card: "assets/cards/jar-of-teeth.webp" },
      // The counter sprite carries the CRT (PC0), keyboard and cash register; the register
      // is listed after it so the CRT end of the counter offers "Use Register PC0".
      { id: "counter", label: "Counter", x: 18, y: 4, w: 1, h: 4, verb: "Lean on", color: 0x5a5448, sprite: "store-counter" },
      { id: "register", label: "Register\nPC0", x: 18, y: 4, w: 1, h: 1, verb: "Use", color: 0x46504a, hidden: true },
      { id: "finch", label: "Mrs.\nFinch", x: 19, y: 5, w: 1, h: 1, verb: "Talk to", color: 0x6a5a7a, sprite: "mrs-finch" },
      { id: "shelf2", label: "Wall\nshelf", x: 19, y: 9, w: 1, h: 2, verb: "Look at", color: 0x5a5244, sprite: "store-decor", frame: 2, card: "assets/cards/jar-of-teeth.webp" },
      { id: "bins", label: "Bins", x: 19, y: 11, w: 1, h: 2, verb: "", color: 0x3a3a36, decor: true, sprite: "store-decor", frame: 12 },
      { id: "boxes", label: "Boxes", x: 17, y: 12, w: 1, h: 1, verb: "", color: 0x5e5240, decor: true, sprite: "store-decor", frame: 6 },
      { id: "baskets", label: "Baskets", x: 8, y: 12, w: 2, h: 1, verb: "", color: 0x5a3a3a, decor: true, sprite: "store-decor", frame: 10 },
      { id: "exit", label: "Door", x: 14, y: 13, w: 2, h: 1, verb: "Leave", color: 0x3a3428, onWall: true, sprite: "store-decor", frame: 15 },
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
  laundromat: {
    id: "laundromat",
    title: "Spin Cycle Eternal",
    // One big open floor. Gus's back office is the top-left corner behind a back door (locked
    // until Gus hands over his keys), and his booth is walled into the bottom-right corner
    // with a service window onto the floor. Grey boxes for now; agy is drawing concepts.
    map: [
      "######################",
      "######################",
      "#........#...........#",
      "#........#...........#",
      "#........#...........#",
      "#........#...........#",
      "####.#####...........#",
      "#....................#",
      "#....................#",
      "#....................#",
      "#...............######",
      "#...............#....#",
      "#....................#",
      "#...............#....#",
      "#...............#....#",
      "######################",
    ],
    props: [
      // Gus's back office
      { id: "rack", label: "Rack\nR1 S1", x: 1, y: 2, w: 2, h: 1, verb: "Work on", color: 0x3c4450, sprite: "store-rack" },
      { id: "files", label: "Files", x: 3, y: 2, w: 1, h: 1, verb: "", color: 0x50504a, decor: true, sprite: "office-props", frame: 11 },
      { id: "logbook", label: "Logbook", x: 5, y: 2, w: 1, h: 1, verb: "Read", color: 0x6a5238, sprite: "laundromat-props", frame: 14, card: "assets/cards/gus-logbook.webp" },
      { id: "desk", label: "Desk", x: 7, y: 3, w: 1, h: 2, verb: "Look at", color: 0x55524a, sprite: "store-decor", frame: 3 },
      { id: "office", label: "PC1", x: 7, y: 3, w: 1, h: 1, verb: "Use", color: 0x46504a, hidden: true },
      { id: "chair", label: "Chair", x: 6, y: 4, w: 1, h: 1, verb: "", color: 0x4a3a44, decor: true, sprite: "store-decor", frame: 4 },
      { id: "printer", label: "Printer\nPRN", x: 1, y: 4, w: 1, h: 1, verb: "Use", color: 0x5e5e58, sprite: "laundromat-props", frame: 13 },
      { id: "archive", label: "Log\narchive", x: 1, y: 5, w: 1, h: 1, verb: "Look at", color: 0x5e5240, sprite: "store-decor", frame: 6 },
      { id: "boxes", label: "Boxes", x: 8, y: 5, w: 1, h: 1, verb: "", color: 0x5e5240, decor: true, sprite: "store-decor", frame: 6 },
      { id: "backdoor", label: "Back\ndoor", x: 4, y: 6, w: 1, h: 1, verb: "Open", color: 0x4a3a2a, door: true, sprite: "laundromat-props", frame: 15 },
      // The wall of dryers. Dryer 4 is the one to look at.
      { id: "dryers", label: "Dryers", x: 10, y: 2, w: 2, h: 1, verb: "Look at", color: 0x6e7270, sprite: "laundromat-props", frame: 0 },
      { id: "dryers", label: "Dryer\n3", x: 12, y: 2, w: 1, h: 1, verb: "Look at", color: 0x6e7270, sprite: "laundromat-props", frame: 1 },
      { id: "dryer4", label: "Dryer\n4", x: 13, y: 2, w: 1, h: 1, verb: "Look in", color: 0x5e6a62, sprite: "laundromat-props", frame: 2, card: "assets/cards/dryer-window.webp", cardGone: "assets/cards/dryer-window-empty.webp" },
      { id: "dryers", label: "Dryers", x: 14, y: 2, w: 2, h: 1, verb: "Look at", color: 0x6e7270, sprite: "laundromat-props", frame: 0 },
      { id: "dryers", label: "Dryers", x: 16, y: 2, w: 2, h: 1, verb: "Look at", color: 0x6e7270, sprite: "laundromat-props", frame: 0 },
      { id: "dryers", label: "Dryers", x: 18, y: 2, w: 2, h: 1, verb: "Look at", color: 0x6e7270, sprite: "laundromat-props", frame: 0 },
      { id: "dryers", label: "Dryer", x: 20, y: 2, w: 1, h: 1, verb: "Look at", color: 0x6e7270, sprite: "laundromat-props", frame: 1 },
      // Washer islands, carts between them.
      { id: "washers", label: "Washers", x: 12, y: 5, w: 2, h: 3, verb: "Look at", color: 0x7a7a70, sprite: "laundromat-props", frame: 3 },
      { id: "cart", label: "Cart", x: 14, y: 6, w: 1, h: 1, verb: "", color: 0x5a5a62, decor: true, sprite: "store-decor", frame: 10 },
      { id: "washers", label: "Washers", x: 16, y: 5, w: 2, h: 3, verb: "Look at", color: 0x7a7a70, sprite: "laundromat-props", frame: 3 },
      { id: "washers", label: "Washers", x: 6, y: 9, w: 3, h: 2, verb: "Look at", color: 0x7a7a70, sprite: "laundromat-props", frame: 4 },
      { id: "cart", label: "Cart", x: 10, y: 10, w: 1, h: 1, verb: "", color: 0x5a5a62, decor: true, sprite: "store-decor", frame: 10 },
      { id: "mop", label: "Mop", x: 3, y: 7, w: 1, h: 1, verb: "", color: 0x5a4a32, decor: true, sprite: "store-decor", frame: 11 },
      // Left wall: the folding table, with the lost and found on it (listed after so the box wins its spot).
      { id: "table", label: "Folding\ntable", x: 1, y: 8, w: 1, h: 3, verb: "", color: 0x6a5a44, decor: true, sprite: "laundromat-props", frame: 5 },
      { id: "lostfound", label: "Lost &\nfound", x: 1, y: 8, w: 1, h: 1, verb: "Look in", color: 0x7a6440, hidden: true, card: "assets/cards/lost-and-found.webp" },
      // Right wall machines.
      { id: "soap", label: "Soap", x: 20, y: 6, w: 1, h: 1, verb: "Look at", color: 0x6a5a6a, sprite: "laundromat-props", frame: 6 },
      { id: "change", label: "Change", x: 20, y: 8, w: 1, h: 1, verb: "Use", color: 0x5a5e5a, sprite: "laundromat-props", frame: 7 },
      // Gus's booth: the kiosk outside it, the service window, Gus behind it.
      { id: "kiosk", label: "Kiosk\nPC0", x: 15, y: 11, w: 1, h: 1, verb: "Use", color: 0x46504a, sprite: "laundromat-props", frame: 8 },
      { id: "counter", label: "Service\nwindow", x: 16, y: 12, w: 1, h: 1, verb: "Lean on", color: 0x5a5448, sprite: "laundromat-props", frame: 9 },
      { id: "gus", label: "Gus", x: 17, y: 12, w: 1, h: 1, verb: "Talk to", color: 0x6a6450, sprite: "gus" },
      { id: "booth", label: "Radio", x: 19, y: 11, w: 1, h: 1, verb: "", color: 0x4a4440, decor: true, sprite: "laundromat-props", frame: 10 },
      { id: "booth", label: "Stool", x: 18, y: 13, w: 1, h: 1, verb: "", color: 0x4a3a44, decor: true, sprite: "laundromat-props", frame: 11 },
      // By the entrance.
      { id: "baskets", label: "Baskets", x: 1, y: 14, w: 1, h: 1, verb: "", color: 0x5a3a3a, decor: true, sprite: "store-decor", frame: 9 },
      { id: "bench", label: "Bench", x: 9, y: 14, w: 3, h: 1, verb: "", color: 0x5a4a3a, decor: true, sprite: "laundromat-props", frame: 12 },
      { id: "exit", label: "Door", x: 6, y: 15, w: 2, h: 1, verb: "Leave", color: 0x3a3428, onWall: true, sprite: "laundromat-props", frame: 16 },
    ],
    spawn: { x: 6, y: 14 },
    tiles: "office-tiles",
    floor: [[0, 40], [1, 36], [2, 8], [3, 4], [4, 4], [5, 2], [6, 4], [7, 2]],
    // Tubes over the dryers (the one over Dryer 4 stutters) and the floor, a bulb over the
    // back door, and Gus's booth lit warmer than everything else.
    lights: {
      ambient: 0x4e564c,
      lamps: [
        { x: 11, y: 3.6, r: 3, color: FLUORESCENT, wide: 1.5 },
        { x: 14, y: 3.6, r: 2.6, color: FLUORESCENT, wide: 1.3, flicker: true },
        { x: 18, y: 3.6, r: 3, color: FLUORESCENT, wide: 1.5 },
        { x: 15, y: 7, r: 3.4, color: FLUORESCENT, wide: 1.5 },
        { x: 6, y: 10, r: 3.4, color: FLUORESCENT, wide: 1.5 },
        { x: 9, y: 13.6, r: 3, color: FLUORESCENT, wide: 1.4 },
        { x: 18.5, y: 12.5, r: 2.4, color: BULB },
        { x: 4.5, y: 7, r: 1.8, color: BULB },
        { x: 4.5, y: 3.5, r: 3.2, color: FLUORESCENT, wide: 1.4 },
      ],
    },
  },
};
