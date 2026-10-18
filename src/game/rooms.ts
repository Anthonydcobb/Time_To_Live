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
      { id: "walkie", label: "Walkie", x: 8, y: 2, w: 1, h: 1, verb: "Pick up", color: 0x4a5a4a },
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
      { id: "boxes", label: "Boxes", x: 4, y: 1, w: 1, h: 2, verb: "", color: 0x5e5240, decor: true },
      { id: "broom", label: "Broom", x: 6, y: 4, w: 1, h: 1, verb: "", color: 0x5a4a32, decor: true },
      // Back office
      { id: "rack", label: "Rack\nR1 S1", x: 1, y: 6, w: 2, h: 1, verb: "Work on", color: 0x3c4450 },
      { id: "storage", label: "Storage", x: 3, y: 6, w: 1, h: 1, verb: "", color: 0x50504a, decor: true },
      { id: "files", label: "Files", x: 1, y: 8, w: 1, h: 2, verb: "", color: 0x50504a, decor: true },
      { id: "files", label: "Files", x: 6, y: 7, w: 1, h: 2, verb: "", color: 0x50504a, decor: true },
      { id: "desk", label: "Desk", x: 6, y: 9, w: 1, h: 2, verb: "Look at", color: 0x55524a },
      { id: "office", label: "PC1", x: 6, y: 9, w: 1, h: 1, verb: "Use", color: 0x46504a },
      { id: "chair", label: "Chair", x: 5, y: 10, w: 1, h: 1, verb: "", color: 0x4a3a44, decor: true },
      { id: "storage", label: "Storage", x: 1, y: 11, w: 1, h: 1, verb: "", color: 0x50504a, decor: true },
      { id: "boxes", label: "Boxes", x: 2, y: 11, w: 1, h: 1, verb: "", color: 0x5e5240, decor: true },
      // Shop floor
      { id: "cooler", label: "Fridges", x: 9, y: 1, w: 8, h: 1, verb: "Look at", color: 0x4a5a66 },
      { id: "jack", label: "Jack", x: 7, y: 4, w: 1, h: 1, verb: "Look at", color: 0x3a3a36, onWall: true },
      { id: "baskets", label: "Baskets", x: 18, y: 1, w: 1, h: 1, verb: "", color: 0x5a3a3a, decor: true },
      { id: "baskets", label: "Baskets", x: 8, y: 4, w: 1, h: 1, verb: "", color: 0x5a3a3a, decor: true },
      { id: "shelf1", label: "Wall\nshelf", x: 8, y: 6, w: 1, h: 4, verb: "Look at", color: 0x5a5244 },
      { id: "shelf1", label: "Shelf", x: 10, y: 5, w: 1, h: 4, verb: "Look at", color: 0x5a5244 },
      { id: "shelf2", label: "Shelf", x: 12, y: 5, w: 1, h: 4, verb: "Look at", color: 0x5a5244 },
      { id: "shelf1", label: "Shelf", x: 14, y: 5, w: 1, h: 4, verb: "Look at", color: 0x5a5244 },
      { id: "register", label: "Register\nPC0", x: 18, y: 3, w: 1, h: 1, verb: "Use", color: 0x46504a },
      { id: "counter", label: "Counter", x: 18, y: 4, w: 1, h: 3, verb: "Lean on", color: 0x5a5448 },
      { id: "finch", label: "Mrs.\nFinch", x: 19, y: 4, w: 1, h: 1, verb: "Talk to", color: 0x6a5a7a, sprite: "mrs-finch" },
      { id: "shelf2", label: "Wall\nshelf", x: 19, y: 8, w: 1, h: 2, verb: "Look at", color: 0x5a5244 },
      { id: "bins", label: "Bins", x: 19, y: 10, w: 1, h: 2, verb: "", color: 0x3a3a36, decor: true },
      { id: "boxes", label: "Boxes", x: 17, y: 11, w: 1, h: 1, verb: "", color: 0x5e5240, decor: true },
      { id: "baskets", label: "Baskets", x: 8, y: 11, w: 2, h: 1, verb: "", color: 0x5a3a3a, decor: true },
      { id: "exit", label: "Door", x: 14, y: 12, w: 2, h: 1, verb: "Leave", color: 0x3a3428, onWall: true },
    ],
    spawn: { x: 14, y: 11 },
  },
};
