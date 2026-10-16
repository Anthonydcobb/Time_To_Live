// The logical topology diagram: devices, the cables between them, which port
// each cable is in, and a link light at each end. Click a device to open its
// terminal, drag it to move it.
import { IosDevice } from "../sim/devices/ios-device";
import { Switch } from "../sim/devices/switch";
import type { Device, Network, Port } from "../sim/network";

export interface Point {
  x: number;
  y: number;
}

const SVG = "http://www.w3.org/2000/svg";
const WIDTH = 800;
const HEIGHT = 360;
/** Gap between a device's outline and the link light. */
const LIGHT_GAP = 9;
/** How far an icon reaches from its center: sideways, up, and down past the name and model. */
const EXTENT = { router: { w: 25, up: 25, down: 58 }, switch: { w: 33, up: 18, down: 58 }, pc: { w: 23, up: 21, down: 54 } };

/** Distance from a device's center to just outside its icon and labels, heading along (ux, uy). */
function lightOffset(device: Device, ux: number, uy: number): number {
  const e = EXTENT[device.kind];
  // Heading down means passing the name and model, which are wider than the icon.
  const w = uy > 0.3 ? Math.max(e.w, device.hostname.length * 4.3 + 4, modelOf(device).length * 3.4 + 4) : e.w;
  const h = uy > 0 ? e.down : e.up;
  return Math.min(Math.abs(ux) > 1e-6 ? w / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-6 ? h / Math.abs(uy) : Infinity) + LIGHT_GAP;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

/** Link light color, like the lights on the real port. */
export function lightFor(port: Port): "green" | "amber" | "red" {
  if (!port.linkUp) return "red";
  if (port.device instanceof Switch) return port.device.stpState(port) === "forwarding" ? "green" : "amber";
  return port.protocolUp ? "green" : "amber";
}

function modelOf(device: Device): string {
  return device instanceof IosDevice ? device.model : "PC";
}

function drawIcon(device: Device, g: SVGGElement): void {
  switch (device.kind) {
    case "router":
      el("circle", { r: 24, class: "icon" }, g);
      // The four arrows on a router symbol, simplified.
      el("path", { d: "M-12 -4 L12 -4 M6 -10 L12 -4 L6 2 M12 4 L-12 4 M-6 -2 L-12 4 L-6 10", class: "glyph" }, g);
      break;
    case "switch":
      el("rect", { x: -32, y: -17, width: 64, height: 34, rx: 4, class: "icon" }, g);
      el("path", { d: "M-18 -6 L18 -6 M12 -11 L18 -6 L12 -1 M18 6 L-18 6 M-12 1 L-18 6 L-12 11", class: "glyph" }, g);
      break;
    case "pc":
      el("rect", { x: -22, y: -20, width: 44, height: 30, rx: 3, class: "icon" }, g);
      el("rect", { x: -16, y: -14, width: 32, height: 18, class: "screen" }, g);
      el("path", { d: "M-6 10 L-8 18 L8 18 L6 10", class: "icon" }, g);
      break;
  }
}

interface CableView {
  a: Port;
  b: Port;
  line: SVGLineElement;
  ends: { port: Port; light: SVGCircleElement; label: SVGTextElement; title: SVGTitleElement }[];
}

interface DeviceView {
  g: SVGGElement;
  name: SVGTextElement;
}

export class TopologyView {
  readonly svg: SVGSVGElement;
  private readonly positions = new Map<Device, Point>();
  private readonly devices = new Map<Device, DeviceView>();
  private readonly cables: CableView[] = [];
  private selected: Device | null = null;

  constructor(
    net: Network,
    layout: Record<string, Point>,
    parent: HTMLElement,
    private readonly onSelect: (device: Device) => void,
  ) {
    this.svg = el("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, class: "topology", role: "img", "aria-label": "Network topology" });
    parent.appendChild(this.svg);
    const cableLayer = el("g", {}, this.svg);
    const deviceLayer = el("g", {}, this.svg);

    net.devices.forEach((d, i) => {
      // Devices the scenario didn't place go in a row along the bottom.
      this.positions.set(d, layout[d.id] ?? { x: 80 + i * 120, y: HEIGHT - 50 });
    });

    for (const d of net.devices) {
      for (const p of d.ports) {
        if (p.kind !== "ethernet" || !p.peer || this.cables.some((c) => c.b === p)) continue;
        const line = el("line", { class: "cable" }, cableLayer);
        const ends = [p, p.peer].map((port) => {
          const light = el("circle", { r: 5, class: "light" }, cableLayer);
          const label = el("text", { class: "port" }, cableLayer);
          label.textContent = port.shortName;
          const title = el("title", {}, label);
          return { port, light, label, title };
        });
        this.cables.push({ a: p, b: p.peer, line, ends });
      }
    }

    for (const d of net.devices) {
      const g = el("g", { class: "device" }, deviceLayer);
      drawIcon(d, g);
      const name = el("text", { y: d.kind === "pc" ? 36 : 40, class: "name" }, g);
      const model = el("text", { y: d.kind === "pc" ? 50 : 54, class: "model" }, g);
      model.textContent = modelOf(d);
      this.devices.set(d, { g, name });
      this.makeDraggable(d, g);
    }
    this.draw();
  }

  select(device: Device): void {
    this.selected = device;
    this.draw();
  }

  /** Redraws positions, names and lights from the live network. */
  draw(): void {
    for (const [d, view] of this.devices) {
      const p = this.positions.get(d)!;
      view.g.setAttribute("transform", `translate(${p.x} ${p.y})`);
      view.g.classList.toggle("selected", d === this.selected);
      view.name.textContent = d.hostname;
    }
    for (const c of this.cables) {
      const pa = this.positions.get(c.a.device)!;
      const pb = this.positions.get(c.b.device)!;
      c.line.setAttribute("x1", String(pa.x));
      c.line.setAttribute("y1", String(pa.y));
      c.line.setAttribute("x2", String(pb.x));
      c.line.setAttribute("y2", String(pb.y));
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
      const ux = (pb.x - pa.x) / len;
      const uy = (pb.y - pa.y) / len;
      for (const end of c.ends) {
        const from = end.port === c.a ? pa : pb;
        const dir = end.port === c.a ? 1 : -1;
        const off = lightOffset(end.port.device, ux * dir, uy * dir);
        const lx = from.x + ux * dir * off;
        const ly = from.y + uy * dir * off;
        end.light.setAttribute("cx", String(lx));
        end.light.setAttribute("cy", String(ly));
        end.light.setAttribute("class", `light ${lightFor(end.port)}`);
        // The port name sits beside its light: to the right of a steep cable,
        // otherwise above it, away from the device names underneath.
        const nx = -uy;
        const ny = ux;
        const side = Math.abs(ux) < 0.3 ? Math.sign(nx) || 1 : -(Math.sign(ny) || 1);
        const vx = nx * side;
        const vy = ny * side;
        end.label.setAttribute("x", String(lx + vx * 11 + ux * dir * 4));
        end.label.setAttribute("y", String(ly + vy * 11 + uy * dir * 4 + 4));
        end.label.setAttribute("text-anchor", vx > 0.3 ? "start" : vx < -0.3 ? "end" : "middle");
        end.title.textContent = `${end.port.device.hostname} ${end.port.name}: ${end.port.status()}, line protocol is ${end.port.protocolUp ? "up" : "down"}`;
      }
    }
  }

  private makeDraggable(device: Device, g: SVGGElement): void {
    g.addEventListener("pointerdown", (e) => {
      const ctm = this.svg.getScreenCTM();
      if (!ctm) return;
      const start = this.positions.get(device)!;
      const sx = e.clientX;
      const sy = e.clientY;
      let moved = false;
      g.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const dx = (ev.clientX - sx) / ctm.a;
        const dy = (ev.clientY - sy) / ctm.d;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        this.positions.set(device, {
          x: Math.max(40, Math.min(WIDTH - 40, start.x + dx)),
          y: Math.max(30, Math.min(HEIGHT - 60, start.y + dy)),
        });
        this.draw();
      };
      const up = () => {
        g.removeEventListener("pointermove", move);
        g.removeEventListener("pointerup", up);
        if (!moved) this.onSelect(device);
      };
      g.addEventListener("pointermove", move);
      g.addEventListener("pointerup", up);
    });
  }
}
