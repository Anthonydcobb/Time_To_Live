import type { RoomId } from "./rooms";
import type { SavedNet } from "./save-log";

/**
 * The saved game: one slot in the browser's local storage, written when you drink the coffee in
 * Bob's office. It holds the story's flags and each job's network as a replay log (save-log.ts).
 */
export interface SaveData {
  version: 1;
  /** When it was saved, in ms since 1970. */
  savedAt: number;
  room: RoomId;
  flags: string[];
  /** Walter's one-time reactions already given. */
  told: string[];
  /** Notes you've read, pinned into the grimoire. */
  notes: string[];
  /** How far through each character's idle chatter you are. */
  lines: { gary: number; finch: number; gus: number; marrow?: number };
  bindingFrom: number;
  /** Where S1's history stood when Walter asked for show vlan brief. Missing in saves from before job 3. */
  vlansFrom?: number;
  store: SavedNet;
  /** Job 2, once taken: its network, and where the MAC allocator stood when it was built. */
  wash: { macs: number; net: SavedNet } | null;
  /** Job 3, the same way. Missing in saves from before job 3. */
  den?: { macs: number; net: SavedNet } | null;
}

const KEY = "time-to-live:save";

/** The saved game, or null if there isn't one or it can't be read. */
export function readSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const save = JSON.parse(raw) as SaveData;
    return save.version === 1 ? save : null;
  } catch {
    return null;
  }
}

/** Writes the save. Returns false if the browser wouldn't store it. */
export function writeSave(save: SaveData): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

/** One line for the title screen: which job you were on and when you saved. */
export function describeSave(save: SaveData): string {
  const has = (f: string) => save.flags.includes(f);
  const job = has("done3") ? "Dentist done" : save.den ? "Work order #0003" : has("done2") ? "Laundromat done" : save.wash ? "Work order #0002" : has("done") ? "Corner store done" : has("job") ? "Work order #0001" : "First day";
  const when = new Date(save.savedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${job} · ${when}`;
}
