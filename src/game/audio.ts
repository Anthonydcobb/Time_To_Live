/**
 * All of the game's sound, through the Web Audio API. Hums, static, whispers and crackles are
 * built live from oscillators and filtered noise; the only files are each room's music and the
 * dialogue's typing.
 *
 * Browsers only allow sound after a click, so nothing plays until `start()` is called from
 * the "Click to play" button. Calls made before that are remembered or quietly ignored.
 */
import type { RoomId } from "./rooms";

/** Where sounds come from, in tiles, so they get louder as you walk up to them. */
const FRIDGES = { x: 13, y: 2.5 };
const JACK = { x: 7.5, y: 5 };
const GARY_DOOR = { x: 5, y: 1.5 };

/** Looping music per room, from public/assets/sound/music. Rooms not listed have none. */
const MUSIC: Partial<Record<RoomId, string>> = {
  office: "assets/sound/music/bobs-office-theme-loop.mp3",
};
/** Quiet on purpose: the music sits under the room's hum and flickers, not over them. */
const MUSIC_LEVEL = 0.1;

/** An RJ45 plug clicking into a port, or (lower and slower) out of one. */
const RJ45 = "assets/sound/ui/rj45-click.mp3";
const RJ45_LEVEL = 0.5;

/** A low drone under the store after the apparition, until you leave. Starts 2 s into the source. */
const LINGER = "assets/sound/shop/after-apparition-drone-loop.mp3";
const LINGER_LEVEL = 0.12;

/** A deep, distant roar as a PC's screen boots: seconds 2 to 6 of the source, with quick fades. */
const PC_BOOT = "assets/sound/pc/pc-boot-roar.mp3";
const PC_BOOT_LEVEL = 0.25;

/** The fluorescent hum under every room. Kept low: it's felt more than heard. The store's tubes are a little louder. */
const HUM_LEVEL = 0.013;

/** Soft key clicks that loop under dialogue while it types out. */
const TYPING = "assets/sound/ui/dialogue-typing-loop.mp3";
const TYPING_LEVEL = 0.5;

/** Gary hammering on the inside of his door when you talk to him: the first second of a door bang. */
const GARY_BANG = "assets/sound/office/gary-door-bang.mp3";
const GARY_BANG_LEVEL = 0.35;

const near = (px: number, py: number, p: { x: number; y: number }, reach: number) =>
  Math.max(0, 1 - Math.hypot(px - p.x, py - p.y) / reach);

interface Ambience {
  /** Called a few times a second with your position in tiles. */
  update(px: number, py: number): void;
  stop(): void;
}

class GameAudio {
  private ctx: AudioContext | null = null;
  /** Everything but the music. Its level is the Options screen's sound volume. */
  private master!: GainNode;
  /** Room music, with its own volume. */
  private musicBus!: GainNode;
  /** Both, on their way out; M mutes it. */
  private out!: GainNode;
  private volume = { music: 1, sound: 1 };
  private noise!: AudioBuffer;
  private muted = false;
  private room: RoomId | null = null;
  private haunted = false;
  private ambience: Ambience | null = null;
  private drone: { gain: GainNode; stop(): void } | null = null;
  private radio: { stop(): void } | null = null;
  private music: { url: string; stop(): void } | null = null;
  private typist: { stop(): void } | null = null;
  private lingering: { stop(): void } | null = null;
  private booting: { stop(): void } | null = null;
  private tracks = new Map<string, Promise<AudioBuffer>>();
  private lastUpdate = 0;
  private pos = { x: 0, y: 0 };

  /** Call from a click or key press: that's the only time a browser lets audio start. */
  start(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.out = this.ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.7;
    this.out.connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume.sound;
    this.master.connect(this.out);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.volume.music;
    this.musicBus.connect(this.out);
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
    if (this.ctx) this.out.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  /** Music and sound volumes from the Options screen, 0 to 1. Safe to call before `start()`. */
  setVolume(music: number, sound: number): void {
    this.volume = { music, sound };
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(music, this.ctx.currentTime, 0.05);
    this.master.gain.setTargetAtTime(sound, this.ctx.currentTime, 0.05);
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

  /** Barely-there static, like something on the line that isn't the radio. */
  hiss(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3200;
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.012, t + 0.15);
    g.gain.linearRampToValueAtTime(0, t + seconds);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + seconds + 0.1);
  }

  /**
   * Walter's radio: squelch in and one short burst of static when he starts talking, squelch out
   * when he's done. The static plays once rather than looping under his lines. Safe to call
   * repeatedly.
   */
  walkie(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx || on === !!this.radio) return;
    this.squelch(on);
    if (!on) {
      this.radio?.stop();
      this.radio = null;
      return;
    }
    const t = ctx.currentTime;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.018, t + 0.1);
    g.gain.setTargetAtTime(0, t + 0.3, 0.15);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 1.2);
    this.radio = {
      stop: () => {
        g.gain.cancelScheduledValues(ctx.currentTime);
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      },
    };
  }

  /** Key clicks while a line of dialogue types out; they stop as soon as it's all on screen. */
  typing(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx || on === !!this.typist) return;
    if (!on) {
      this.typist?.stop();
      this.typist = null;
      return;
    }
    const gain = ctx.createGain();
    gain.gain.value = TYPING_LEVEL;
    gain.connect(this.master);
    let src: AudioBufferSourceNode | null = null;
    let stopped = false;
    this.typist = {
      stop: () => {
        stopped = true;
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
        src?.stop(ctx.currentTime + 0.2);
      },
    };
    this.load(TYPING)
      .then((buffer) => {
        if (stopped) return;
        src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.connect(gain);
        // Start somewhere in the loop so every line doesn't open on the same clicks.
        src.start(0, Math.random() * buffer.duration);
      })
      .catch(() => {});
  }

  /** A cable going into a port at the rack, or coming out. */
  rj45(plugIn: boolean): void {
    this.oneShot(RJ45, plugIn ? RJ45_LEVEL : RJ45_LEVEL * 0.7, plugIn ? 1 : 0.8);
  }

  /** Teeth rattling against the glass of their jar: three small clinks, never quite the same. */
  teethJar(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    [0, 0.11, 0.27].forEach((at, i) => {
      const t = t0 + at + Math.random() * 0.03;
      const level = 0.05 * (1 - i * 0.25);
      // Glass rings at a few high, unrelated pitches that die away fast.
      for (const f of [2350, 3870, 5610]) {
        const o = ctx.createOscillator();
        o.frequency.value = f * (0.96 + Math.random() * 0.08);
        const g = ctx.createGain();
        g.gain.setValueAtTime(level, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18 + Math.random() * 0.1);
        o.connect(g).connect(this.master);
        o.start(t);
        o.stop(t + 0.35);
      }
      // The tick of a tooth hitting it.
      const src = this.noiseSource();
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 4000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(level * 1.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
      src.connect(hp).connect(g).connect(this.master);
      src.start(t);
      src.stop(t + 0.05);
    });
  }

  /** The drone that hangs over the store after the apparition. Off fades it out. */
  linger(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx || on === !!this.lingering) return;
    if (!on) {
      this.lingering?.stop();
      this.lingering = null;
      return;
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.musicBus);
    let src: AudioBufferSourceNode | null = null;
    let stopped = false;
    this.lingering = {
      stop: () => {
        stopped = true;
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.8);
        src?.stop(ctx.currentTime + 4);
      },
    };
    this.load(LINGER)
      .then((buffer) => {
        if (stopped) return;
        src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.connect(gain);
        src.start();
        gain.gain.setTargetAtTime(LINGER_LEVEL, ctx.currentTime, 1.5);
      })
      .catch(() => {});
  }

  /** A PC's screen booting up. Off fades it out, if you power the PC down before it's over. */
  pcBoot(on: boolean): void {
    const ctx = this.ctx;
    this.booting?.stop();
    this.booting = null;
    if (!ctx || !on) return;
    const gain = ctx.createGain();
    gain.gain.value = PC_BOOT_LEVEL;
    gain.connect(this.master);
    let src: AudioBufferSourceNode | null = null;
    let stopped = false;
    const boot = {
      stop: () => {
        stopped = true;
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
        src?.stop(ctx.currentTime + 0.5);
      },
    };
    this.booting = boot;
    this.load(PC_BOOT)
      .then((buffer) => {
        if (stopped) return;
        src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(gain);
        src.onended = () => {
          if (this.booting === boot) this.booting = null;
        };
        src.start();
      })
      .catch(() => {});
  }

  /** Gary bangs on his door as you start talking to him. */
  garyBang(): void {
    this.oneShot(GARY_BANG, GARY_BANG_LEVEL);
  }

  // ---- building blocks -------------------------------------------------------

  /** Plays a sound file once. A missing file is silence. */
  private oneShot(url: string, level: number, rate = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.load(url)
      .then((buffer) => {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = rate;
        const gain = ctx.createGain();
        gain.gain.value = level;
        src.connect(gain).connect(this.master);
        src.start();
      })
      .catch(() => {});
  }

  /** Fetches and decodes a sound file once; a failed one is forgotten so it can be tried again. */
  private load(url: string): Promise<AudioBuffer> {
    let track = this.tracks.get(url);
    if (!track) {
      track = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((data) => this.ctx!.decodeAudioData(data));
      track.catch(() => this.tracks.delete(url));
      this.tracks.set(url, track);
    }
    return track;
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    return src;
  }

  /** Opening: the key click and a short rush of static. Closing: a longer static tail and a falling chirp. */
  private squelch(open: boolean): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const click = ctx.createOscillator();
    click.type = "square";
    click.frequency.setValueAtTime(open ? 1400 : 1100, t);
    if (!open) click.frequency.exponentialRampToValueAtTime(420, t + 0.09);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(open ? 0.04 : 0.03, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + (open ? 0.04 : 0.1));
    click.connect(cg).connect(this.master);
    click.start(t);
    click.stop(t + 0.12);
    const tail = open ? 0.16 : 0.32;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(1800, t);
    if (!open) bp.frequency.exponentialRampToValueAtTime(900, t + tail);
    const g = ctx.createGain();
    g.gain.setValueAtTime(open ? 0.05 : 0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + tail);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + tail + 0.04);
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
    const hum = this.hum(HUM_LEVEL * 1.15);
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
    const hum = this.hum(HUM_LEVEL);
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

  /** Fades the room's track in, or out if it has none. Leaves it alone if it's already playing. */
  private playMusic(url: string | undefined): void {
    const ctx = this.ctx!;
    if (this.music?.url === url) return;
    this.music?.stop();
    this.music = null;
    if (!url) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.musicBus);
    let src: AudioBufferSourceNode | null = null;
    let stopped = false;
    const music = {
      url,
      stop: () => {
        stopped = true;
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
        src?.stop(ctx.currentTime + 2);
      },
    };
    this.music = music;
    this.load(url)
      .then((buffer) => {
        if (stopped) return;
        src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.connect(gain);
        src.start();
        gain.gain.setTargetAtTime(MUSIC_LEVEL, ctx.currentTime, 0.8);
      })
      .catch(() => {
        // A missing or broken file just means silence, never a crash.
        if (this.music === music) this.music = null;
      });
  }

  private buildRoom(): void {
    this.playMusic(this.room ? MUSIC[this.room] : undefined);
    this.ambience?.stop();
    this.drone?.stop();
    this.drone = null;
    this.ambience = this.room === "shop" ? this.shopAmbience() : this.officeAmbience();
    this.ambience.update(this.pos.x, this.pos.y);
  }
}

export const audio = new GameAudio();
