// Ping and traceroute as jobs that run in simulated time, in IOS and Windows flavors.
import { formatIpv4, formatIpv6, type Ipv4, type Ipv6 } from "./addr";
import type { Clock } from "./clock";
import type { IpStack, Ipv6PingResult, PingResult } from "./ipstack";
import { Job } from "./job";

const MAX_HOPS = 30;

interface Host {
  stack: IpStack;
  clock: Clock;
}

const ms = (n: number) => Math.round(n);

/** `ping` on IOS: five echoes, `!` `.` `U` `&` marks, then a summary. */
export function iosPing(host: Host, target: Ipv4, count = 5): Job {
  const job = new Job();
  const id = host.stack.newPingId();
  const rtts: number[] = [];
  let sent = 0;

  const summary = () => {
    const pct = sent ? Math.round((rtts.length / sent) * 100) : 0;
    let line = `Success rate is ${pct} percent (${rtts.length}/${sent})`;
    if (rtts.length) {
      const avg = rtts.reduce((a, b) => a + b, 0) / rtts.length;
      line += `, round-trip min/avg/max = ${ms(Math.min(...rtts))}/${ms(avg)}/${ms(Math.max(...rtts))} ms`;
    }
    job.write(`\n${line}\n`);
  };

  const next = () => {
    if (job.done) return;
    if (sent === count) {
      summary();
      job.finish();
      return;
    }
    host.stack.probe(target, { id, seq: sent++, timeoutMs: 2000 }, (r) => {
      if (job.done) return;
      job.write(iosMark(r));
      if (r.kind === "reply") rtts.push(r.rttMs);
      next();
    });
  };

  job.onAbort(summary);
  next();
  return job;
}

/** `ping ipv6` on IOS: five ICMPv6 echoes with IOS-style result marks. */
export function iosIpv6Ping(host: Host, target: Ipv6, count = 5): Job {
  const job = new Job();
  const id = host.stack.newPingId();
  const rtts: number[] = [];
  let sent = 0;
  const source = host.stack.sourceForIpv6(target);
  job.write(`Type escape sequence to abort.\nSending ${count}, 100-byte ICMP Echos to ${formatIpv6(target)}, timeout is 2 seconds:\n`);
  const next = () => {
    if (job.done) return;
    if (sent === count || !source) {
      const pct = sent ? Math.round((rtts.length / sent) * 100) : 0;
      let line = `\nSuccess rate is ${pct} percent (${rtts.length}/${sent})`;
      if (rtts.length) {
        const avg = rtts.reduce((a, b) => a + b, 0) / rtts.length;
        line += `, round-trip min/avg/max = ${ms(Math.min(...rtts))}/${ms(avg)}/${ms(Math.max(...rtts))} ms`;
      }
      job.write(`${line}\n`);
      job.finish();
      return;
    }
    host.stack.probeIpv6(target, { id, seq: sent++, timeoutMs: 2000, source }, (result) => {
      if (job.done) return;
      if (result.kind === "reply") rtts.push(result.rttMs);
      job.write(result.kind === "reply" ? "!" : result.kind === "unreachable" ? "U" : result.kind === "ttl-expired" ? "&" : ".");
      next();
    });
  };
  next();
  return job;
}

function iosMark(r: PingResult): string {
  switch (r.kind) {
    case "reply":
      return "!";
    case "unreachable":
      return "U";
    case "ttl-expired":
      return "&";
    default:
      return ".";
  }
}

/** `traceroute` on IOS: three probes per hop, raising the TTL each hop. */
export function iosTraceroute(host: Host, target: Ipv4): Job {
  return trace(host, target, 3000, (hop, results) => {
    const addr = results.find((r) => r.kind !== "timeout") as { from: Ipv4 } | undefined;
    const marks = results.map((r) =>
      r.kind === "timeout" ? "*" : r.kind === "unreachable" ? "!H" : `${ms(r.kind === "reply" ? r.rttMs : 0)} msec`,
    );
    return addr ? `  ${hop} ${formatIpv4(addr.from)} ${marks.join(" ")}` : `  ${hop}  ${marks.join("  ")} `;
  });
}

/** `traceroute ipv6` on IOS: three probes per hop, raising the hop limit. */
export function iosIpv6Traceroute(host: Host, target: Ipv6): Job {
  const job = new Job();
  const id = host.stack.newPingId();
  let seq = 0;
  const runHop = (hop: number) => {
    if (job.done) return;
    if (hop > MAX_HOPS) { job.finish(); return; }
    const results: Ipv6PingResult[] = [];
    const probe = () => {
      const source = host.stack.sourceForIpv6(target);
      if (!source) { job.write(`  ${hop}  *  *  *\n`); job.finish(); return; }
      host.stack.probeIpv6(target, { id, seq: seq++, timeoutMs: 3000, source, hopLimit: hop }, (result) => {
        if (job.done) return;
        results.push(result);
        if (results.length < 3) { probe(); return; }
        const addr = results.find((r) => r.kind !== "timeout") as { from: Ipv6 } | undefined;
        const marks = results.map((r) => r.kind === "timeout" ? "*" : r.kind === "unreachable" ? "!H" : `${ms(r.kind === "reply" ? r.rttMs : 0)} msec`);
        job.write(addr ? `  ${hop} ${formatIpv6(addr.from)} ${marks.join(" ")}\n` : `  ${hop}  ${marks.join("  ")}\n`);
        if (results.some((r) => r.kind === "reply" || r.kind === "unreachable")) job.finish();
        else runHop(hop + 1);
      });
    };
    probe();
  };
  runHop(1);
  return job;
}

/** `tracert` on Windows. */
export function winTracert(host: Host, target: Ipv4): Job {
  const job = trace(
    host,
    target,
    4000,
    (hop, results) => {
      const cols = results.map((r) => (r.kind === "timeout" ? "*" : `${ms(r.kind === "reply" ? r.rttMs : 0)} ms`).padEnd(10)).join("");
      const addr = results.find((r) => r.kind !== "timeout") as { from: Ipv4 } | undefined;
      return `${String(hop).padStart(3)}   ${cols}${addr ? formatIpv4(addr.from) : "Request timed out."}`;
    },
    "\nTrace complete.\n",
  );
  return job;
}

function trace(
  host: Host,
  target: Ipv4,
  timeoutMs: number,
  formatHop: (hop: number, results: PingResult[]) => string,
  trailer = "",
): Job {
  const job = new Job();
  const id = host.stack.newPingId();
  let seq = 0;

  const runHop = (hop: number) => {
    if (job.done) return;
    if (hop > MAX_HOPS) {
      job.write(trailer);
      job.finish();
      return;
    }
    const results: PingResult[] = [];
    const probe = () => {
      host.stack.probe(target, { id, seq: seq++, timeoutMs, ttl: hop }, (r) => {
        if (job.done) return;
        results.push(r);
        if (results.length < 3) {
          probe();
          return;
        }
        job.write(formatHop(hop, results) + "\n");
        const reached = results.some((x) => x.kind === "reply" || x.kind === "unreachable");
        if (reached) {
          job.write(trailer);
          job.finish();
        } else runHop(hop + 1);
      });
    };
    probe();
  };

  runHop(1);
  return job;
}

/** `ping` on Windows: four echoes, a second apart. */
export function winPing(host: Host, target: Ipv4, count = 4, label = formatIpv4(target)): Job {
  const job = new Job();
  const id = host.stack.newPingId();
  const shown = label === formatIpv4(target) ? label : `${label} [${formatIpv4(target)}]`;
  const rtts: number[] = [];
  let sent = 0;

  const summary = () => {
    const lost = sent - rtts.length;
    job.write(
      `\nPing statistics for ${shown}:\n` +
        `    Packets: Sent = ${sent}, Received = ${rtts.length}, Lost = ${lost} (${sent ? Math.round((lost / sent) * 100) : 0}% loss),\n`,
    );
    if (rtts.length) {
      const avg = rtts.reduce((a, b) => a + b, 0) / rtts.length;
      job.write(
        "Approximate round trip times in milli-seconds:\n" +
          `    Minimum = ${ms(Math.min(...rtts))}ms, Maximum = ${ms(Math.max(...rtts))}ms, Average = ${ms(avg)}ms\n`,
      );
    }
  };

  const next = () => {
    if (job.done) return;
    if (sent === count) {
      summary();
      job.finish();
      return;
    }
    host.stack.probe(target, { id, seq: sent++, timeoutMs: 4000 }, (r) => {
      if (job.done) return;
      if (r.kind === "reply") {
        rtts.push(r.rttMs);
        const time = r.rttMs < 1 ? "time<1ms" : `time=${ms(r.rttMs)}ms`;
        job.write(`Reply from ${formatIpv4(r.from)}: bytes=32 ${time} TTL=${r.ttl}\n`);
        host.clock.schedule(1000, next);
        return;
      }
      if (r.kind === "timeout") {
        job.write("Request timed out.\n");
        next();
        return;
      }
      if (r.kind === "unreachable") job.write(`Reply from ${formatIpv4(r.from)}: Destination host unreachable.\n`);
      else job.write(`Reply from ${formatIpv4(r.from)}: TTL expired in transit.\n`);
      host.clock.schedule(1000, next);
    });
  };

  job.write(`Pinging ${shown} with 32 bytes of data:\n\n`);
  job.onAbort(() => {
    summary();
    job.write("Control-C\n");
  });
  next();
  return job;
}
