import type { IosDevice } from "../sim/devices/ios-device";
import type { Pc } from "../sim/devices/pc";
import type { Job } from "../sim/job";
import type { Device, Network, Port } from "../sim/network";

/**
 * A job's network, saved as everything that was done to it. The simulator is deterministic, so
 * replaying the same commands, cables and Ctrl+C presses at the same simulated times into a
 * freshly built network rebuilds it exactly: configs, leases, MAC tables, command history and
 * all. No DOM and no Phaser here, so it can be tested on its own.
 */

/** One thing done to the network, at simulated time `t`. */
export type NetEvent =
  | { t: number; op: "in"; dev: string; line: string }
  | { t: number; op: "ctrlZ" | "boot" | "abort"; dev: string }
  | { t: number; op: "run"; dev: string; line: string }
  | { t: number; op: "cfg"; dev: string; ip: number | null; mask: number | null; gw: number | null }
  | { t: number; op: "conn"; a: string; b: string; cable: "ethernet" | "console" }
  | { t: number; op: "disc"; a: string };

/** An event before it's stamped with the time. */
type Untimed = NetEvent extends infer E ? (E extends NetEvent ? Omit<E, "t"> : never) : never;

export interface SavedNet {
  /** Simulated time when it was saved. */
  now: number;
  log: NetEvent[];
}

/**
 * The longest stretch of quiet time replayed between two events. Everything that settles on its
 * own (link negotiation, spanning tree, pings) is done well inside it, so a long idle spell
 * replays in two minutes of simulated time instead of hours.
 */
export const MAX_GAP_MS = 120_000;

const isIos = (d: Device): d is IosDevice => "console" in d;
const isPc = (d: Device): d is Pc => "shell" in d;
const portId = (p: Port) => `${p.device.id}/${p.name}`;

/** Watches one network and logs what's done to it. Create it before anything is done. */
export class NetRecorder {
  readonly log: NetEvent[] = [];
  /** The last command still running on each device, for Ctrl+C. */
  private readonly running = new Map<string, Job>();

  constructor(private readonly net: Network) {
    for (const d of net.devices) this.watch(d);
    const connect = net.connect.bind(net);
    const disconnect = net.disconnect.bind(net);
    net.connect = (a, b, cable = "ethernet") => {
      connect(a, b, cable);
      this.push({ op: "conn", a: portId(a), b: portId(b), cable });
    };
    net.disconnect = (p) => {
      // Pulling a cable from an empty port does nothing, so there's nothing to replay.
      const had = !!p.peer;
      disconnect(p);
      if (had) this.push({ op: "disc", a: portId(p) });
    };
  }

  private push(e: Untimed): void {
    this.log.push({ ...e, t: this.net.clock.now } as NetEvent);
  }

  /** A command that may keep running in simulated time: remember it so Ctrl+C can be replayed. */
  private track<R extends { job?: Job }>(dev: string, result: R): R {
    const job = result.job;
    if (job) {
      this.running.set(dev, job);
      const abort = job.abort.bind(job);
      job.abort = () => {
        abort();
        this.push({ op: "abort", dev });
      };
    }
    return result;
  }

  private watch(d: Device): void {
    const dev = d.id;
    if (isIos(d)) {
      const c = d.console;
      const input = c.input.bind(c);
      const ctrlZ = c.ctrlZ.bind(c);
      const boot = c.boot.bind(c);
      c.input = (line) => {
        this.push({ op: "in", dev, line });
        return this.track(dev, input(line));
      };
      c.ctrlZ = () => {
        this.push({ op: "ctrlZ", dev });
        return ctrlZ();
      };
      c.boot = () => {
        this.push({ op: "boot", dev });
        return boot();
      };
    }
    if (isPc(d)) {
      const sh = d.shell;
      const execute = sh.execute.bind(sh);
      const configure = d.configure.bind(d);
      sh.execute = (line) => {
        this.push({ op: "run", dev, line });
        return this.track(dev, execute(line));
      };
      d.configure = (ip, mask, gw = null) => {
        this.push({ op: "cfg", dev, ip, mask, gw });
        configure(ip, mask, gw);
      };
    }
  }

  save(): SavedNet {
    return { now: this.net.clock.now, log: this.log.map((e) => ({ ...e })) };
  }

  /**
   * Replays a saved network into this one, which must be freshly built the same way. The events
   * go back through the watched methods, so this log ends up holding them again.
   */
  replay(saved: SavedNet): void {
    const clock = this.net.clock;
    const device = (id: string) => {
      const d = this.net.devices.find((x) => x.id === id);
      if (!d) throw new Error(`No device ${id} to replay into`);
      return d;
    };
    const port = (id: string) => {
      const cut = id.indexOf("/");
      return device(id.slice(0, cut)).port(id.slice(cut + 1));
    };
    let last = 0;
    const wait = (t: number) => {
      clock.advance(Math.min(MAX_GAP_MS, Math.max(0, t - last)));
      last = t;
    };
    for (const e of saved.log) {
      wait(e.t);
      switch (e.op) {
        case "in":
          (device(e.dev) as IosDevice).console.input(e.line);
          break;
        case "ctrlZ":
          (device(e.dev) as IosDevice).console.ctrlZ();
          break;
        case "boot":
          (device(e.dev) as IosDevice).console.boot();
          break;
        case "run":
          (device(e.dev) as Pc).shell.execute(e.line);
          break;
        case "cfg":
          (device(e.dev) as Pc).configure(e.ip, e.mask, e.gw);
          break;
        case "abort":
          this.running.get(e.dev)?.abort();
          break;
        case "conn":
          this.net.connect(port(e.a), port(e.b), e.cable);
          break;
        case "disc":
          this.net.disconnect(port(e.a));
          break;
      }
    }
    wait(saved.now);
  }
}
