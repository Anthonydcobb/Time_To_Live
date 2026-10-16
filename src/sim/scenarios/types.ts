import type { Device, Network } from "../network";

/** One line of a work order. `done` reads the live network, so it ticks itself off. */
export interface Task {
  text: string;
  done?: () => boolean;
}

export interface WorkOrder {
  number: string;
  client: string;
  /** Where it is and who's in charge, one line. */
  place: string;
  /** What's already there when you arrive. */
  notes: string;
  /** A tip shown under the help section, such as how to set a PC's address. */
  hint: string;
}

/** Everything the bench needs to run a job. */
export interface Scenario {
  net: Network;
  /** Where each device sits on the logical diagram, in an 800 x 360 drawing, by device id. */
  layout: Record<string, { x: number; y: number }>;
  tasks: Task[];
  /** What Walter teaches on this job, as "book: words". */
  incantations: string[];
  workOrder: WorkOrder;
  /** The device whose terminal opens first. */
  start: Device;
}
