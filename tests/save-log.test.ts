import { describe, expect, it } from "vitest";
import { macAllocatorState, parseIpv4 as ip, setMacAllocator } from "../src/sim/addr";
import { cornerStore } from "../src/sim/scenarios/corner-store";
import { laundromat } from "../src/sim/scenarios/laundromat";
import { MAX_GAP_MS, NetRecorder } from "../src/game/save-log";

type Store = ReturnType<typeof cornerStore>;

/** Types lines into a console the way a player does, answering the setup dialog with "no". */
function type(d: Store["r1"], lines: string[]): void {
  for (const line of lines) d.console.input(line);
}

function playJob1(job: Store): void {
  const { net, r1, s1, register, office } = job;
  net.connect(r1.port("Gi0/0"), s1.port("Gi0/1"));
  net.connect(register.nic, s1.port("Fa0/1"));
  // A cable plugged into the wrong port and moved, like a player fumbling at the rack.
  net.connect(office.nic, s1.port("Fa0/9"));
  net.clock.advance(4_000);
  net.disconnect(office.nic);
  net.connect(office.nic, s1.port("Fa0/2"));
  net.clock.advance(2_000);
  r1.console.boot();
  net.clock.advance(500);
  type(r1, ["", "no", "", "enable", "configure terminal", "hostname R1", "enable secret hunter2",
    "interface gigabitEthernet0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown"]);
  r1.console.ctrlZ();
  net.clock.advance(40_000);
  register.configure(ip("192.168.1.10"), ip("255.255.255.0"), ip("192.168.1.1"));
  register.shell.execute("ping 192.168.1.1");
  net.clock.advance(3_000);
  // A ping stopped halfway with Ctrl+C.
  const long = register.shell.execute("ping -t 192.168.1.1");
  net.clock.advance(2_500);
  long.job?.abort();
  // A long idle spell, then one more command.
  net.clock.advance(3_600_000);
  type(r1, ["show ip interface brief"]);
  net.clock.advance(1_000);
}

describe("saving a network as a replay log", () => {
  it("rebuilds job 1's network exactly", () => {
    const played = cornerStore({ cabled: false });
    const rec = new NetRecorder(played.net);
    playJob1(played);
    const saved = JSON.parse(JSON.stringify(rec.save()));

    const loaded = cornerStore({ cabled: false });
    new NetRecorder(loaded.net).replay(saved);

    const show = (j: Store, cmd: string) => j.r1.console.input(cmd).lines.join("\n");
    expect(show(loaded, "do show running-config")).toBe(show(played, "do show running-config"));
    expect(loaded.r1.config.hostname).toBe("R1");
    expect(loaded.r1.console.history).toEqual(played.r1.console.history);
    expect(loaded.r1.console.prompt()).toBe(played.r1.console.prompt());
    expect(loaded.office.nic.peer?.name).toBe(played.office.nic.peer?.name);
    expect(loaded.register.nic.peer?.protocolUp).toBe(true);
    expect(loaded.register.shell.execute("ipconfig").lines).toEqual(played.register.shell.execute("ipconfig").lines);
    // The hour of idling replays as at most two minutes.
    expect(loaded.net.clock.now).toBeLessThan(played.net.clock.now);
    expect(loaded.net.clock.now).toBeGreaterThan(MAX_GAP_MS);
  });

  it("rebuilds job 2's DHCP leases", () => {
    // MACs come from one counter, so a rebuilt network starts the counter where the first one did.
    const macs = macAllocatorState();
    const build = () => {
      setMacAllocator(macs);
      const job = laundromat();
      return { job, rec: new NetRecorder(job.net) };
    };
    const a = build();
    type(a.job.r1, ["", "no", "", "enable", "configure terminal", "interface gigabitEthernet0/0",
      "ip address 192.168.20.1 255.255.255.0", "no shutdown", "exit", "ip dhcp excluded-address 192.168.20.1 192.168.20.20",
      "ip dhcp pool LAUNDRY", "network 192.168.20.0 255.255.255.0", "default-router 192.168.20.1", "end"]);
    a.job.net.clock.advance(35_000);
    a.job.kiosk.shell.execute("ipconfig /renew");
    a.job.net.clock.advance(10_000);
    const saved = JSON.parse(JSON.stringify(a.rec.save()));

    const b = build();
    b.rec.replay(saved);
    const bindings = (r: typeof a.job.r1) => r.console.input("show ip dhcp binding").lines.join("\n");
    expect(bindings(b.job.r1)).toContain("192.168.20.21");
    expect(bindings(b.job.r1)).toBe(bindings(a.job.r1));
    // The replayed log can itself be saved and replayed again.
    expect(b.rec.save().log.length).toBeGreaterThanOrEqual(saved.log.length);
  });

  it("logs nothing for pulling a cable out of an empty port", () => {
    const job = cornerStore({ cabled: false });
    const rec = new NetRecorder(job.net);
    job.net.disconnect(job.s1.port("Fa0/3"));
    expect(rec.log).toEqual([]);
  });
});
