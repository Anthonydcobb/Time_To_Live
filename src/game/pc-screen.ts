import { formatIpv4, formatMacCisco, maskToPrefix, parseIpv4 } from "../sim/addr";
import type { Pc } from "../sim/devices/pc";
import type { TerminalView } from "../web/terminal";

/**
 * A PC's screen: Cryptis NetOS on an old CRT. It boots with the Cryptis sigil, then offers
 * Config (IP and interface settings, laid out like Packet Tracer's), Command Prompt (the
 * PC's real terminal) and Wireless Settings.
 *
 * IPv4 and DNS drive the simulated PC. IPv6, interface settings and wireless are shown the
 * way Packet Tracer lays them out, but the engine doesn't support them yet, so they're
 * read-only and say so.
 */
type Panel = "menu" | "config" | "cmd" | "wireless";

const BOOT_MS = 3200;
const BOOT_LINES = [
  "CRYPTIS BIOS 4.0.1993  ...  640K OK",
  "LOADING NETOS v1.08",
  "BINDING FastEthernet0 ............ OK",
  "BINDING WLAN01 ................... SCRAMBLED",
  "MOUNTING /dev/hollow ............. OK",
  "THE NETWORK IS LISTENING.",
];
const SSIDS = [
  ["BELLWETHER_GUEST", 6, 3],
  ["B&B-STAFF", 11, 1],
  ["STATIC_SPRINGS_FREE", 1, 2],
  ["▒▒▒▒▒▒▒▒▒", 13, 4],
] as const;

const $ = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

const h = (html: string) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

/** EUI-64 link-local address from a MAC, the way a PC would derive it. */
function linkLocal(mac: string): string {
  const b = mac.match(/../g)!.map((x) => parseInt(x, 16));
  b[0] ^= 0x02;
  const words = [(b[0] << 8) | b[1], (b[2] << 8) | 0xff, (0xfe << 8) | b[3], (b[4] << 8) | b[5]];
  return "FE80::" + words.map((w) => w.toString(16).toUpperCase()).join(":");
}

/** The default mask for an address's old class, which Packet Tracer fills in for you. */
function classfulMask(ip: number): number {
  const first = ip >>> 24;
  if (first < 128) return 0xff000000;
  if (first < 192) return 0xffff0000;
  return 0xffffff00;
}

export class PcScreen {
  readonly el: HTMLElement;
  private pc: Pc | null = null;
  private view: TerminalView | null = null;
  private viewHome: HTMLElement | null = null;
  private panel: Panel = "menu";
  private timers: number[] = [];
  private refresher = 0;
  private noise = 0;
  private onClosed: (() => void) | null = null;
  /** The story's command-line hint, shown under the Command Prompt. */
  private hint = "";

  constructor(parent: HTMLElement) {
    this.el = h(`
      <div id="pc" hidden>
        <div class="crt">
          <div class="tape">PROPERTY OF B&amp;B NETWORK</div>
          <div class="glass">
            <div class="boot">
              <img class="sigil" src="assets/ui/cryptis-sigil.png" alt="" />
              <div class="brand"><b>CRYPTIS</b><b>NETOS <small>v1.08</small></b><span>CRYPTIS SYSTEMS, INC.</span></div>
              <pre class="bootlog"></pre>
            </div>
            <div class="desk">
              <header>
                <img src="assets/ui/cryptis-sigil.png" alt="" />
                <span class="os">CRYPTIS NETOS v1.08</span>
                <span class="host"></span>
              </header>
              <nav>
                <button data-go="config">[ CONFIG ]</button>
                <button data-go="cmd">[ COMMAND PROMPT ]</button>
                <button data-go="wireless">[ WIRELESS SETTINGS ]</button>
              </nav>
              <section class="win" data-panel="menu">
                <div class="idle">
                  <p class="status"></p>
                  <p class="omen">SELECT A FUNCTION. THE NETWORK IS PATIENT.</p>
                </div>
              </section>
              <section class="win" data-panel="config">
                <div class="bar"><span>IP CONFIGURATION · FastEthernet0</span><button data-go="menu">X</button></div>
                <div class="body config">
                  <h4>IPv4 CONFIGURATION</h4>
                  <div class="row radios">
                    <label><input type="radio" name="v4" value="dhcp" /> DHCP</label>
                    <label><input type="radio" name="v4" value="static" /> STATIC</label>
                    <span class="dhcp-msg"></span>
                  </div>
                  <label class="row"><span>IPv4 ADDRESS</span><input data-f="ip" spellcheck="false" /></label>
                  <label class="row"><span>SUBNET MASK</span><input data-f="mask" spellcheck="false" /></label>
                  <label class="row"><span>DEFAULT GATEWAY</span><input data-f="gw" spellcheck="false" /></label>
                  <label class="row"><span>DNS SERVER</span><input data-f="dns" spellcheck="false" /></label>
                  <p class="err"></p>
                  <h4>IPv6 CONFIGURATION <em>MODULE NOT INSTALLED ON THIS UNIT</em></h4>
                  <div class="row radios off">
                    <label><input type="radio" name="v6" disabled checked /> AUTOMATIC</label>
                    <label><input type="radio" name="v6" disabled /> STATIC</label>
                  </div>
                  <label class="row off"><span>IPv6 ADDRESS</span><input disabled placeholder="" /><i>/</i><input class="prefix" disabled /></label>
                  <label class="row off"><span>LINK LOCAL ADDRESS</span><input data-f="ll" disabled /></label>
                  <label class="row off"><span>IPv6 GATEWAY</span><input disabled /></label>
                  <label class="row off"><span>IPv6 DNS SERVER</span><input disabled /></label>
                  <h4>INTERFACE · FastEthernet0 <em>FIXED BY CRYPTIS</em></h4>
                  <label class="row off"><span>PORT STATUS</span><span class="check"><input type="checkbox" disabled checked /> ON</span></label>
                  <label class="row off"><span>BANDWIDTH</span><select disabled><option>AUTO · 100 Mbps</option></select></label>
                  <label class="row off"><span>DUPLEX</span><select disabled><option>AUTO · FULL</option></select></label>
                  <label class="row off"><span>MAC ADDRESS</span><input data-f="mac" disabled /></label>
                </div>
              </section>
              <section class="win" data-panel="cmd">
                <div class="bar"><span>COMMAND LINE</span><button data-go="menu">X</button></div>
                <div class="body cmd"></div>
              </section>
              <section class="win" data-panel="wireless">
                <div class="bar"><span>PC WIRELESS · WLAN01</span><button data-go="menu">X</button></div>
                <div class="body wireless">
                  <div class="tabs"><button class="on" data-tab="connect">CONNECT</button><button data-tab="link">LINK INFORMATION</button><button data-tab="profiles">PROFILES</button></div>
                  <div data-tab-body="connect">
                    <table><thead><tr><th>WIRELESS NETWORK NAME</th><th>CH</th><th>SIGNAL</th></tr></thead><tbody></tbody></table>
                    <div class="row"><button class="refresh">REFRESH</button><button disabled>CONNECT</button></div>
                  </div>
                  <div data-tab-body="link" hidden><p>ADAPTER: WLAN01</p><p>STATUS: <span class="scramble">SCRAMBLED</span></p><p>SIGNAL: <span class="scramble">▒▒▒▒</span></p><p>IP ADDRESS: 0.0.0.0</p></div>
                  <div data-tab-body="profiles" hidden><p>NO PROFILES.</p><p class="omen">SOMEONE IS ALREADY CONNECTED.</p></div>
                  <p class="err">NO WIRELESS ADAPTER IS INSTALLED ON THIS UNIT.</p>
                </div>
              </section>
              <footer class="hint"></footer>
            </div>
            <canvas class="noise" width="160" height="120"></canvas>
            <div class="scan"></div>
            <div class="band"></div>
            <div class="zig"></div>
          </div>
        </div>
      </div>
    `);
    parent.appendChild(this.el);
    this.el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const go = t.closest("[data-go]")?.getAttribute("data-go") as Panel | null;
      if (go) this.show(go);
      const tab = t.closest("[data-tab]")?.getAttribute("data-tab");
      if (tab) this.showTab(tab);
      if (t.closest(".refresh")) this.scan();
    });
    this.el.querySelectorAll<HTMLInputElement>('input[name="v4"]').forEach((r) => r.addEventListener("change", () => this.setMode(r.value)));
    for (const f of ["ip", "mask", "gw", "dns"]) {
      const input = $<HTMLInputElement>(this.el, `[data-f="${f}"]`);
      input.addEventListener("change", () => this.applyStatic(f));
      input.addEventListener("keydown", (e) => e.key === "Enter" && input.blur());
      if (f === "mask") input.addEventListener("focus", () => this.fillClassfulMask());
    }
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** Whether the command prompt has the keyboard (so the terminal gets keys, not the page). */
  get typingInTerminal(): boolean {
    return this.isOpen && this.panel === "cmd";
  }

  open(pc: Pc, view: TerminalView, title: string, hint: string, onClosed: () => void): void {
    this.pc = pc;
    this.view = view;
    this.onClosed = onClosed;
    $(this.el, ".host").textContent = title.toUpperCase();
    this.hint = hint.replace("Esc closes the laptop", "Esc returns to the menu");
    // The PC's terminal moves into the Command Prompt window while the screen is up.
    this.viewHome = view.el.parentElement;
    $(this.el, ".body.cmd").appendChild(view.el);
    view.term.options.theme = { background: "#06100a", foreground: "#a8f0b8", cursor: "#a8f0b8", selectionBackground: "#1f4a2c" };
    this.el.hidden = false;
    this.el.classList.remove("off", "booted");
    this.el.classList.add("on");
    this.show("menu");
    this.startNoise();
    this.boot();
    this.refresher = window.setInterval(() => this.refresh(), 400);
  }

  /** Powers the CRT down, then hands control back. */
  close(): void {
    if (!this.isOpen) return;
    this.clearTimers();
    window.clearInterval(this.refresher);
    this.view?.hide();
    this.el.classList.remove("on");
    this.el.classList.add("off");
    this.later(() => {
      this.el.hidden = true;
      this.el.classList.remove("off");
      cancelAnimationFrame(this.noise);
      if (this.view && this.viewHome) this.viewHome.appendChild(this.view.el);
      this.view = null;
      this.pc = null;
      const done = this.onClosed;
      this.onClosed = null;
      done?.();
    }, 420);
  }

  resize(): void {
    if (this.panel === "cmd") this.view?.resize();
  }

  /** Esc: from a window back to the menu. Returns false on the menu, where Esc powers off. */
  back(): boolean {
    if (this.panel === "menu") return false;
    this.show("menu");
    return true;
  }

  // ---- boot -----------------------------------------------------------------

  private boot(): void {
    const log = $(this.el, ".bootlog");
    log.textContent = "";
    BOOT_LINES.forEach((line, i) => this.later(() => (log.textContent += line + "\n"), 700 + i * 300));
    this.later(() => this.el.classList.add("booted"), BOOT_MS);
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private clearTimers(): void {
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers = [];
  }

  // ---- panels ---------------------------------------------------------------

  private show(panel: Panel): void {
    this.panel = panel;
    this.el.querySelectorAll<HTMLElement>("[data-panel]").forEach((s) => s.hidden = s.dataset.panel !== panel);
    this.el.querySelectorAll<HTMLElement>("nav [data-go]").forEach((b) => b.classList.toggle("on", b.dataset.go === panel));
    if (panel === "cmd") this.view?.show();
    else this.view?.hide();
    $(this.el, ".hint").textContent = panel === "cmd" ? this.hint : panel === "menu" ? "ESC POWERS OFF THE UNIT" : "ESC RETURNS TO THE MENU";
    if (panel === "config") this.loadConfig();
    if (panel === "wireless") this.scan();
    // A little static every time the picture changes.
    const glass = $(this.el, ".glass");
    glass.classList.remove("jolt");
    void glass.offsetWidth;
    glass.classList.add("jolt");
  }

  private showTab(tab: string): void {
    this.el.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    this.el.querySelectorAll<HTMLElement>("[data-tab-body]").forEach((d) => d.hidden = d.dataset.tabBody !== tab);
  }

  /** Live status on the menu: the link light and the address, like the concept's INT01 line. */
  private refresh(): void {
    const pc = this.pc;
    if (!pc) return;
    const up = pc.nic.protocolUp;
    const addr = pc.ip !== null ? formatIpv4(pc.ip) : "0.0.0.0";
    $(this.el, ".status").innerHTML = `INT01: ${up ? "ETH_UP" : "ETH_DOWN"} · ${addr}<br>WLAN01: <span class="scramble">SCRAMBLED</span>`;
    // In DHCP mode the fields follow the lease as it arrives.
    if (this.panel === "config" && pc.dhcp) this.fillFields();
  }

  // ---- config ---------------------------------------------------------------

  private field(f: string): HTMLInputElement {
    return $<HTMLInputElement>(this.el, `[data-f="${f}"]`);
  }

  private loadConfig(): void {
    const pc = this.pc!;
    this.el.querySelectorAll<HTMLInputElement>('input[name="v4"]').forEach((r) => r.checked = r.value === (pc.dhcp ? "dhcp" : "static"));
    $(this.el, ".dhcp-msg").textContent = "";
    $(this.el, ".config .err").textContent = "";
    this.fillFields();
    this.field("ll").value = linkLocal(pc.nic.mac);
    this.field("mac").value = formatMacCisco(pc.nic.mac).toUpperCase();
  }

  private fillFields(): void {
    const pc = this.pc!;
    const show = (v: number | null) => (v === null ? "" : formatIpv4(v));
    const values: Record<string, string> = {
      ip: show(pc.ip),
      mask: show(pc.mask),
      gw: show(pc.gateway),
      dns: pc.dnsServers[0] !== undefined ? formatIpv4(pc.dnsServers[0]) : "",
    };
    for (const [f, v] of Object.entries(values)) {
      const input = this.field(f);
      input.disabled = pc.dhcp;
      if (document.activeElement !== input) input.value = v;
      input.classList.remove("bad");
    }
  }

  private setMode(mode: string): void {
    const pc = this.pc!;
    const msg = $(this.el, ".dhcp-msg");
    if (mode === "dhcp") {
      msg.textContent = "REQUESTING IP ADDRESS...";
      pc.useDhcp((lease) => {
        if (this.pc !== pc) return;
        msg.textContent = lease ? "DHCP REQUEST SUCCESSFUL." : "DHCP FAILED. APIPA IS BEING USED.";
        this.fillFields();
      });
      this.fillFields();
    } else {
      msg.textContent = "";
      // Switching to static keeps whatever address the PC has now, like Packet Tracer.
      pc.configure(pc.ip, pc.mask, pc.gateway);
      this.fillFields();
    }
  }

  private fillClassfulMask(): void {
    const ip = parseIpv4(this.field("ip").value.trim());
    const mask = this.field("mask");
    if (ip !== null && !mask.value.trim()) mask.value = formatIpv4(classfulMask(ip));
  }

  /** Static fields apply as soon as you leave them, the way Packet Tracer's do. */
  private applyStatic(changed: string): void {
    const pc = this.pc!;
    if (pc.dhcp) return;
    const err = $(this.el, ".config .err");
    const read = (f: string) => {
      const text = this.field(f).value.trim();
      if (!text) return { ok: true, value: null as number | null };
      const value = parseIpv4(text);
      return { ok: value !== null, value };
    };
    const ip = read("ip");
    const mask = read("mask");
    const gw = read("gw");
    const dns = read("dns");
    const bad = (f: string, ok: boolean) => this.field(f).classList.toggle("bad", !ok);
    bad("ip", ip.ok);
    bad("gw", gw.ok);
    bad("dns", dns.ok);
    const maskOk = mask.ok && (mask.value === null || maskToPrefix(mask.value) !== null);
    bad("mask", maskOk);
    if (!ip.ok || !gw.ok || !dns.ok) return void (err.textContent = "INVALID IPv4 ADDRESS.");
    if (!maskOk) return void (err.textContent = "INVALID SUBNET MASK.");
    err.textContent = "";
    pc.configure(ip.value, mask.value, gw.value);
    pc.dnsServers = dns.value === null ? [] : [dns.value];
    if (changed === "ip") this.fillClassfulMask();
  }

  // ---- wireless -------------------------------------------------------------

  private scan(): void {
    const body = $(this.el, ".wireless tbody");
    const rows = [...SSIDS].sort(() => Math.random() - 0.5);
    body.innerHTML = rows
      .map(([name, ch, bars]) => `<tr><td><span class="${name.startsWith("▒") ? "scramble" : ""}">${name}</span></td><td>${ch}</td><td>${"▮".repeat(bars)}${"▯".repeat(4 - bars)}</td></tr>`)
      .join("");
  }

  // ---- the picture ----------------------------------------------------------

  /** Animated grain on a tiny canvas, stretched over the glass. */
  private startNoise(): void {
    const canvas = $<HTMLCanvasElement>(this.el, ".noise");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(canvas.width, canvas.height);
    let frame = 0;
    const draw = () => {
      if (frame++ % 2 === 0) {
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const v = Math.random() * 255;
          d[i] = v * 0.6;
          d[i + 1] = v;
          d[i + 2] = v * 0.7;
          d[i + 3] = Math.random() < 0.06 ? 90 : 18;
        }
        ctx.putImageData(img, 0, 0);
      }
      this.noise = requestAnimationFrame(draw);
    };
    cancelAnimationFrame(this.noise);
    draw();
  }
}
