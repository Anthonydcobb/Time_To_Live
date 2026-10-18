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
}

export interface RoomDef {
  id: RoomId;
  title: string;
  /** `#` wall, `.` floor. */
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
    map: [
      "###############",
      "#.......#.....#",
      "#.......#.....#",
      "#.......#.....#",
      "#.............#",
      "#.............#",
      "#.............#",
      "#.............#",
      "#.............#",
      "###############",
    ],
    props: [
      { id: "cooler", label: "Back cooler", x: 1, y: 1, w: 1, h: 3, verb: "Look at", color: 0x4a5a66 },
      { id: "shelf1", label: "Shelf", x: 3, y: 2, w: 1, h: 2, verb: "Look at", color: 0x5a5244 },
      { id: "shelf2", label: "Shelf", x: 5, y: 2, w: 1, h: 2, verb: "Look at", color: 0x5a5244 },
      { id: "counter", label: "Counter", x: 2, y: 6, w: 3, h: 1, verb: "Lean on", color: 0x5a5448 },
      { id: "register", label: "Register\nPC0", x: 5, y: 6, w: 1, h: 1, verb: "Use", color: 0x46504a },
      { id: "finch", label: "Mrs.\nFinch", x: 3, y: 5, w: 1, h: 1, verb: "Talk to", color: 0x6a5a7a, sprite: "mrs-finch" },
      { id: "jack", label: "Jack", x: 0, y: 7, w: 1, h: 1, verb: "Look at", color: 0x3a3a36, onWall: true },
      { id: "desk", label: "Desk", x: 10, y: 1, w: 2, h: 1, verb: "Look at", color: 0x55524a },
      { id: "office", label: "PC1", x: 11, y: 1, w: 1, h: 1, verb: "Use", color: 0x46504a },
      { id: "rack", label: "Rack\nR1 S1", x: 13, y: 1, w: 1, h: 2, verb: "Work on", color: 0x3c4450 },
      { id: "exit", label: "Door", x: 7, y: 9, w: 1, h: 1, verb: "Leave", color: 0x3a3428, onWall: true },
    ],
    spawn: { x: 7, y: 7 },
  },
};
