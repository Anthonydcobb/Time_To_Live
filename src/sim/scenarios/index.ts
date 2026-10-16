import { cornerStore } from "./corner-store";
import { laundromat } from "./laundromat";
import type { Scenario } from "./types";

/** The jobs in order. The bench lets you pick one. */
export const JOBS: { id: string; name: string; build: () => Scenario }[] = [
  { id: "1", name: "Job 1: Quik-Stop Forever", build: cornerStore },
  { id: "2", name: "Job 2: Spin Cycle Eternal", build: laundromat },
];
