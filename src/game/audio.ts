/**
 * All of the game's sound, generated live with the Web Audio API. There are no audio files:
 * hums, static, whispers and crackles are built from oscillators and filtered noise.
 *
 * Browsers only allow sound after a click, so nothing plays until `start()` is called from
 * the "Click to play" button. Calls made before that are remembered or quietly ignored.
 */
import type { RoomId } from "./rooms";

/** Where sounds come from, in tiles, so they get louder as you walk up to them. */
const FRIDGES = { x: 13, y: 2.5 };
const JACK = { x: 7.5, y: 5 };
const GARY_DOOR = { x: 5, y: 1.5 };

const near = (px: number, py: number, p: { x: number; y: number }, reach: number) =>
  Math.max(0, 1 - Math.hypot(px - p.x, py - p.y) / reach);

interface Ambience {
  /** Called a few times a second with your position in tiles. */
  update(px: number, py: number): void;
  stop(): void;
}

class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private muted = false;
  private room: RoomId | null = null;
  private haunted = false;
  private ambience: Ambience | null = null;
  private drone: { gain: GainNode; stop(): void } | null = null;
  private radio: { stop(): void } | null = null;
  private lastUpdate = 0;
  private pos = { x: 0, y: 0 };

  /** Call from a click or key press: that's the only time a browser lets audio start. */
  start(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(this.ctx.destination);
    // Two seconds of white noise, looped and filtered into everything that hisses.
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    if (this.room) this.buildRoom();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  /** The room you're in and whether it's haunted yet. Rebuilds the ambience. */
  setRoom(room: RoomId, haunted: boolean): void {
    this.room = room;
    this.haunted = haunted;
    if (this.ctx) this.buildRoom();
  }

  /** Your position in tiles, every frame. Throttled here. */
  update(px: number, py: number): void {
    this.pos = { x: px, y: py };
    const now = performance.now();
    if (now - this.lastUpdate < 100) return;
    this.lastUpdate = now;
    this.ambience?.update(px, py);
  }

  /** The store goes wrong: a deep beating drone fades in and stays. */
  haunt(): void {
    this.haunted = true;
    if (!this.ctx || this.room !== "shop") return;
    this.startDrone(6);
    this.crackle(true);
  }

  /** A fluorescent tube stuttering. `big` is the story's blackout flicker. */
  crackle(big = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = big ? 0.6 : 0.12 + Math.random() * 0.12;
    const src = this.noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.value = 0;
    // A spray of clicks rather than a smooth hiss.
    const clicks = big ? 26 : 6 + Math.floor(Math.random() * 6);
    for (let i = 0; i < clicks; i++) {
      const at = t + Math.random() * dur;
      g.gain.setValueAtTime(0.06 + Math.random() * 0.08, at);
      g.gain.setValueAtTime(0, at + 0.004 + Math.random() * 0.01);
    }
    src.connect(hp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
    if (big) this.thump(t, 0.25);
  }

  /** The apparition: a wall of loud static that tears and drops, with a sub-bass fall under it. */
  burst(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = this.noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.25);
    // Tear it up: the signal keeps cutting out and slamming back.
    for (let i = 0; i < 18; i++) {
      const at = t + 0.3 + Math.random() * (seconds - 0.9);
      g.gain.setValueAtTime(0.02, at);
      g.gain.setValueAtTime(0.18 + Math.random() * 0.1, at + 0.03 + Math.random() * 0.08);
    }
    g.gain.setValueAtTime(0.2, t + seconds - 0.6);
    g.gain.linearRampToValueAtTime(0, t + seconds);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + seconds + 0.1);
    const sub = ctx.createOscillator();
    sub.frequency.setValueAtTime(90, t);
    sub.frequency.exponentialRampToValueAtTime(24, t + seconds);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(0.35, t + 0.4);
    sg.gain.linearRampToValueAtTime(0, t + seconds);
    sub.connect(sg).connect(this.master);
    sub.start(t);
    sub.stop(t + seconds + 0.1);
  }

  /** Walter's radio: squelch in, static under his voice, squelch out. Safe to call repeatedly. */
  walkie(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx || on === !!this.radio) return;
    this.squelch();
    if (!on) {
      this.radio?.stop();
      this.radio = null;
      return;
    }
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.018, ctx.currentTime + 0.08, 0.05);
    // The static breathes a little, like a weak signal.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 3.3;
    const depth = ctx.createGain();
    depth.gain.value = 0.007;
    lfo.connect(depth).connect(g.gain);
    src.connect(bp).connect(g).connect(this.master);
    src.start();
    lfo.start();
    this.radio = {
      stop: () => {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
        src.stop(ctx.currentTime + 0.2);
        lfo.stop(ctx.currentTime + 0.2);
      },
    };
  }

  // ---- building blocks -------------------------------------------------------

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    return src;
  }

  private squelch(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const click = ctx.createOscillator();
    click.type = "square";
    click.frequency.value = 1400;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.04, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    click.connect(cg).connect(this.master);
    click.start(t);
    click.stop(t + 0.05);
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.2);
  }

  private thump(t: number, level: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.55);
  }

  /** Mains hum from the tubes: 60 Hz and its harmonics, plus a thin high buzz. */
  private hum(level: number): { stop(): void } {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(level, ctx.currentTime, 1.5);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    const oscs = [
      [60, "sawtooth", 0.5],
      [120, "sine", 0.6],
      [180, "sine", 0.25],
    ].map(([f, type, g]) => {
      const o = ctx.createOscillator();
      o.type = type as OscillatorType;
      o.frequency.value = f as number;
      const og = ctx.createGain();
      og.gain.value = g as number;
      o.connect(og).connect(lp);
      o.start();
      return o;
    });
    lp.connect(out);
    const buzz = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3200;
    bp.Q.value = 9;
    const bg = ctx.createGain();
    bg.gain.value = 0.12;
    buzz.connect(bp).connect(bg).connect(out);
    buzz.start();
    out.connect(this.master);
    return {
      stop: () => {
        out.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
        const end = ctx.currentTime + 1.5;
        oscs.forEach((o) => o.stop(end));
        buzz.stop(end);
      },
    };
  }

  private startDrone(fadeSeconds: number): void {
    const ctx = this.ctx!;
    if (this.drone) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.06, ctx.currentTime, fadeSeconds / 3);
    // Two sines a hair apart beat against each other, slow and wrong.
    const oscs = [38, 38.6, 76.4].map((f, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i === 2 ? 0.3 : 0.8;
      o.connect(g).connect(gain);
      o.start();
      return o;
    });
    gain.connect(this.master);
    this.drone = {
      gain,
      stop: () => {
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
        oscs.forEach((o) => o.stop(ctx.currentTime + 2));
      },
    };
  }

  /** The store: hum, the fridges' low rustle, and whispers that come from their direction. */
  private shopAmbience(): Ambience {
    const ctx = this.ctx!;
    const hum = this.hum(0.035);
    // Low breathy rustle, slowly swelling.
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 320;
    bp.Q.value = 1.2;
    const rustle = ctx.createGain();
    rustle.gain.value = 0;
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.13;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 0.01;
    swell.connect(swellDepth).connect(rustle.gain);
    const pan = ctx.createStereoPanner();
    src.connect(bp).connect(rustle).connect(pan).connect(this.master);
    src.start();
    swell.start();
    let closeness = 0.2;
    let timer = 0;
    const whisper = () => {
      // A breathy formant sweep, like a word you can't make out.
      const t = ctx.currentTime;
      const dur = 0.5 + Math.random() * 0.9;
      const w = this.noiseSource();
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 7;
      f.frequency.setValueAtTime(600 + Math.random() * 300, t);
      f.frequency.linearRampToValueAtTime(1400 + Math.random() * 900, t + dur * 0.6);
      f.frequency.linearRampToValueAtTime(800, t + dur);
      const g = ctx.createGain();
      const peak = (this.haunted ? 0.07 : 0.035) * closeness;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + dur * 0.3);
      g.gain.linearRampToValueAtTime(0, t + dur);
      w.connect(f).connect(g).connect(pan);
      w.start(t);
      w.stop(t + dur + 0.05);
      const wait = this.haunted ? 2000 + Math.random() * 4000 : 4000 + Math.random() * 7000;
      timer = window.setTimeout(whisper, wait);
    };
    timer = window.setTimeout(whisper, 3000);
    if (this.haunted) this.startDrone(2);
    return {
      update: (px, py) => {
        // Loudest between the fridges and the jack; it follows you a little everywhere.
        closeness = Math.max(0.15, near(px, py, FRIDGES, 9), near(px, py, JACK, 6));
        const base = (this.haunted ? 0.05 : 0.028) * closeness;
        rustle.gain.setTargetAtTime(base, ctx.currentTime, 0.4);
        swellDepth.gain.setTargetAtTime(base * 0.4, ctx.currentTime, 0.4);
        pan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, (FRIDGES.x - px) / 8)), ctx.currentTime, 0.3);
      },
      stop: () => {
        window.clearTimeout(timer);
        hum.stop();
        rustle.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
        src.stop(ctx.currentTime + 1.5);
        swell.stop(ctx.currentTime + 1.5);
      },
    };
  }

  /** Bob's office: hum, and a low throb behind Gary's door that grows as you walk up to it. */
  private officeAmbience(): Ambience {
    const ctx = this.ctx!;
    const hum = this.hum(0.03);
    const throb = ctx.createGain();
    throb.gain.value = 0;
    const o = ctx.createOscillator();
    o.frequency.value = 33;
    const pulse = ctx.createOscillator();
    pulse.frequency.value = 0.7;
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0;
    pulse.connect(pulseDepth).connect(throb.gain);
    const rumble = this.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 110;
    o.connect(throb);
    rumble.connect(lp).connect(throb);
    throb.connect(this.master);
    o.start();
    pulse.start();
    rumble.start();
    return {
      update: (px, py) => {
        // Only Bob's office has Gary's door; elsewhere this is just the tube hum.
        const c = this.room === "office" ? near(px, py, GARY_DOOR, 7) : 0;
        throb.gain.setTargetAtTime(0.09 * c * c, ctx.currentTime, 0.4);
        pulseDepth.gain.setTargetAtTime(0.05 * c * c, ctx.currentTime, 0.4);
      },
      stop: () => {
        hum.stop();
        throb.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
        const end = ctx.currentTime + 1.5;
        o.stop(end);
        pulse.stop(end);
        rumble.stop(end);
      },
    };
  }

  private buildRoom(): void {
    this.ambience?.stop();
    this.drone?.stop();
    this.drone = null;
    this.ambience = this.room === "shop" ? this.shopAmbience() : this.officeAmbience();
    this.ambience.update(this.pos.x, this.pos.y);
  }
}

export const audio = new GameAudio();
