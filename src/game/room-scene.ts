import Phaser from "phaser";
import {
  FLOOR_FRAMES,
  pickFrame,
  ROOMS,
  TILE,
  WALL_FACE_FRAMES,
  WALL_LOWER_FRAMES,
  WALL_TOP_FRAME,
  WALL_UPPER_FRAMES,
  type Prop,
  type RoomDef,
  type RoomId,
} from "./rooms";
import { audio } from "./audio";
import { events, type Story } from "./story";
import type { Ui } from "./ui";

const SPEED = 260;
/** How close your feet need to be to something to use it, in pixels. */
const REACH = 40;
const FLOOR = [0x34332e, 0x31302b];
const WALL_TOP = 0x1c1b18;
const WALL_FACE = 0x26251f;

const DIRS = ["down", "up", "left", "right"] as const;

type Keys = Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d" | "e" | "q", Phaser.Input.Keyboard.Key>;

/** One grey-box room: tiles, props with labels, and you. */
export class RoomScene extends Phaser.Scene {
  private room!: RoomDef;
  private player!: Phaser.GameObjects.Container;
  private body_!: Phaser.Physics.Arcade.Body;
  private keys!: Keys;
  private prompt!: Phaser.GameObjects.Text;
  private dark!: Phaser.GameObjects.Rectangle;
  private near: Prop | null = null;
  private facing = new Phaser.Math.Vector2(0, 1);
  private sprite!: Phaser.GameObjects.Sprite;
  /** The room's darkness: ambient fill with lamp glows added, multiplied over everything. */
  private lightMap: Phaser.GameObjects.RenderTexture | null = null;
  private glow!: Phaser.GameObjects.Image;
  /** Per lamp: current brightness (0-1) and when it next changes, for flickering tubes. */
  private lampState: { level: number; next: number }[] = [];
  /** Prop sprites by prop id, for swapping frames when the story moves on. */
  private propSprites = new Map<string, Phaser.GameObjects.Sprite[]>();

  constructor(
    private readonly story: Story,
    private readonly ui: Ui,
  ) {
    super("room");
  }

  preload(): void {
    // Rows: down, up, left, right. Each row is stand, step, pass, step, pass.
    this.load.spritesheet("player", "assets/sprites/characters/player-walk.png", { frameWidth: 16, frameHeight: 32 });
    this.load.spritesheet("mrs-finch", "assets/sprites/characters/mrs-finch-walk.png", { frameWidth: 16, frameHeight: 32 });
    this.load.spritesheet("store-tiles", "assets/sprites/tiles/store-tiles.png", { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet("store-fridges", "assets/sprites/props/store-fridges.png", { frameWidth: 32, frameHeight: 48 });
    this.load.spritesheet("store-counter", "assets/sprites/props/store-counter.png", { frameWidth: 16, frameHeight: 80 });
    this.load.spritesheet("store-rack", "assets/sprites/props/store-rack.png", { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet("store-jack", "assets/sprites/props/store-jack.png", { frameWidth: 16, frameHeight: 16 });
    // Frame 0 the walkie on its charger, frame 1 the charger once you've taken it.
    this.load.spritesheet("walkie", "assets/sprites/props/walkie.png", { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet("office-tiles", "assets/sprites/tiles/office-tiles.png", { frameWidth: 16, frameHeight: 16 });
    // Bob's office props: 80x48 cells, each piece standing at the bottom centre of its cell.
    this.load.spritesheet("office-props", "assets/sprites/props/office-props.png", { frameWidth: 80, frameHeight: 48 });
    // Set dressing: 32x80 cells, each piece standing at the bottom centre of its cell.
    this.load.spritesheet("store-decor", "assets/sprites/props/store-decor.png", { frameWidth: 32, frameHeight: 80 });
  }

  create(data: { room?: RoomId }): void {
    DIRS.forEach((dir, row) => {
      if (this.anims.exists(`walk-${dir}`)) return;
      this.anims.create({ key: `walk-${dir}`, frames: this.anims.generateFrameNumbers("player", { start: row * 5 + 1, end: row * 5 + 4 }), frameRate: 8, repeat: -1 });
    });
    this.room = ROOMS[data.room ?? "office"];
    this.propSprites.clear();
    audio.setRoom(this.room.id, this.story.has("haunt"));
    const walls = this.physics.add.staticGroup();
    const solid = (x: number, y: number, w: number, h: number) => {
      const r = this.add.rectangle(x + w / 2, y + h / 2, w, h).setVisible(false);
      walls.add(r);
    };

    // Floor and walls. A wall shows its dark top and, above floor, a front face.
    this.room.map.forEach((row, ty) =>
      [...row].forEach((ch, tx) => {
        const x = tx * TILE;
        const y = ty * TILE;
        if (ch === " ") return;
        const tiles = this.room.tiles;
        if (tiles) {
          // A wall with floor below shows its face. If more wall sits above it, the face is two
          // tiles tall: this is the bottom half and the tile above draws the top half.
          const at = (dy: number) => this.room.map[ty + dy]?.[tx] ?? " ";
          let frame = WALL_TOP_FRAME;
          if (ch !== "#") frame = pickFrame(tx, ty, this.room.floor ?? FLOOR_FRAMES);
          else if (at(1) === ".") frame = pickFrame(tx, ty, at(-1) === "#" ? WALL_LOWER_FRAMES : WALL_FACE_FRAMES);
          else if (at(1) === "#" && at(2) === ".") frame = pickFrame(tx, ty, WALL_UPPER_FRAMES);
          this.add.image(x, y, tiles, frame).setOrigin(0).setScale(TILE / 16);
          if (ch === "#") solid(x, y, TILE, TILE);
        } else if (ch === "#") {
          const faceBelow = this.room.map[ty + 1]?.[tx] === ".";
          this.add.rectangle(x, y, TILE, TILE, faceBelow ? WALL_FACE : WALL_TOP).setOrigin(0);
          if (faceBelow) this.add.rectangle(x, y, TILE, TILE / 3, WALL_TOP).setOrigin(0);
          solid(x, y, TILE, TILE);
        } else {
          this.add.rectangle(x, y, TILE, TILE, FLOOR[(tx + ty) % 2]).setOrigin(0);
        }
      }),
    );

    for (const p of this.room.props) this.drawProp(p.id === "walkie" && this.story.has("walkie") ? { ...p, label: "Charger", frame: 1 } : p, solid);
    if (this.room.id === "shop" && this.story.has("haunt")) this.drawPhantomCable();

    // You: the contractor, 16x32 drawn at 4x, standing on her feet.
    const s = this.room.spawn;
    this.sprite = this.add.sprite(0, 0, "player", 0).setOrigin(0.5, 1).setScale(4);
    this.player = this.add.container((s.x + 0.5) * TILE, (s.y + 0.9) * TILE, [this.sprite]);
    this.physics.add.existing(this.player);
    this.body_ = this.player.body as Phaser.Physics.Arcade.Body;
    // Only your feet collide, so you can stand in front of tall things.
    this.body_.setSize(40, 22).setOffset(-20, -22);
    this.body_.setCollideWorldBounds(true);
    const worldW = this.room.map[0].length * TILE;
    const worldH = this.room.map.length * TILE;
    this.physics.world.setBounds(0, 0, worldW, worldH);
    this.physics.add.collider(this.player, walls);
    // Rooms bigger than the screen scroll with you.
    this.cameras.main.setBounds(0, 0, worldW, worldH).startFollow(this.player, true);
    this.setupLights(worldW, worldH);

    this.prompt = this.add
      .text(0, 0, "", { fontFamily: "IBM Plex Mono, monospace", fontSize: "16px", color: "#ffb000", backgroundColor: "#0b0c0acc", padding: { x: 6, y: 3 } })
      .setOrigin(0.5, 1)
      .setDepth(10_000)
      .setVisible(false);
    const title = this.add
      .text(this.scale.width / 2, this.scale.height / 2 - 40, this.room.title, { fontFamily: "IBM Plex Mono, monospace", fontSize: "28px", color: "#d8d4c0", backgroundColor: "#0b0c0acc", padding: { x: 12, y: 6 } })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(10_000);
    this.tweens.add({ targets: title, alpha: 0, delay: 1400, duration: 800, onComplete: () => title.destroy() });
    this.dark = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0).setOrigin(0).setScrollFactor(0).setDepth(20_000);

    // Capture nothing, so WASD and Space still reach the terminal.
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys("UP,DOWN,LEFT,RIGHT,W,A,S,D,E,Q", false) as unknown as Keys;
    this.keys = Object.fromEntries(Object.entries(this.keys).map(([k, v]) => [k.toLowerCase(), v])) as Keys;

    const onGoto = (to: RoomId) => this.scene.restart({ room: to });
    const onFlicker = () => this.flicker();
    const onHaunt = () => {
      audio.haunt();
      if (this.room.id === "shop") this.drawPhantomCable();
    };
    const onWalkie = () => this.propSprites.get("walkie")?.forEach((s) => s.setFrame(1));
    events.on("goto", onGoto);
    events.on("flicker", onFlicker);
    events.on("haunt", onHaunt);
    events.on("walkie", onWalkie);
    this.events.once("shutdown", () => {
      events.off("goto", onGoto);
      events.off("flicker", onFlicker);
      events.off("haunt", onHaunt);
      events.off("walkie", onWalkie);
    });

    this.cameras.main.fadeIn(300);
    this.story.enter(this.room.id);
  }

  private drawProp(p: Prop, solid: (x: number, y: number, w: number, h: number) => void): void {
    const x = p.x * TILE;
    const y = p.y * TILE;
    const w = p.w * TILE;
    const h = p.h * TILE;
    const inset = p.onWall ? 6 : 4;
    if (p.hidden) return;
    if (p.sprite) {
      // Standing on the bottom of its footprint, so tall things rise up over the wall behind.
      const sprite = this.add.sprite(x + w / 2, y + h, p.sprite, p.frame ?? 0).setOrigin(0.5, 1).setScale(4).setDepth(p.onWall ? 1 : y + h);
      this.propSprites.set(p.id, [...(this.propSprites.get(p.id) ?? []), sprite]);
      if (!p.onWall) solid(x + inset, y + inset, w - inset * 2, h - inset * 2);
      return;
    }
    this.add
      .rectangle(x + inset, y + inset, w - inset * 2, h - inset * 2, p.color)
      .setOrigin(0)
      .setStrokeStyle(2, 0x111110)
      .setDepth(p.onWall ? 1 : y + h);
    this.add
      .text(x + w / 2, y + h / 2, p.label, { fontFamily: "IBM Plex Mono, monospace", fontSize: "13px", color: "#d8d4c0", align: "center" })
      .setOrigin(0.5)
      .setDepth((p.onWall ? 1 : y + h) + 0.5);
    if (!p.onWall) solid(x + inset, y + inset, w - inset * 2, h - inset * 2);
  }

  /** The cable nobody ran: from the back of the fridges, along the floor, into the wall jack. */
  private drawPhantomCable(): void {
    for (const s of this.propSprites.get("jack") ?? []) s.setFrame(1);
    const g = this.add.graphics().setDepth(2);
    g.lineStyle(4, 0x2a6a8a, 1);
    g.beginPath();
    g.moveTo(9.15 * TILE, 3 * TILE);
    g.lineTo(9.15 * TILE, 3.4 * TILE);
    g.lineTo(8.1 * TILE, 3.6 * TILE);
    g.lineTo(8.1 * TILE, 5.5 * TILE);
    g.lineTo(8 * TILE, 5.5 * TILE);
    g.strokePath();
  }

  private setupLights(worldW: number, worldH: number): void {
    this.lightMap = null;
    const lights = this.room.lights;
    if (!lights) return;
    if (!this.textures.exists("light-glow")) {
      // A soft white disc, tinted per lamp when it's drawn.
      const size = 256;
      const tex = this.textures.createCanvas("light-glow", size, size)!;
      const ctx = tex.getContext();
      const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.35, "rgba(255,255,255,0.7)");
      grad.addColorStop(0.7, "rgba(255,255,255,0.22)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      tex.refresh();
    }
    this.glow = this.make.image({ key: "light-glow", add: false }).setBlendMode(Phaser.BlendModes.ADD);
    this.lightMap = this.add.renderTexture(0, 0, worldW, worldH).setOrigin(0).setDepth(9_000).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.lampState = lights.lamps.map(() => ({ level: 1, next: 0 }));
  }

  /** Redraws the darkness each frame so flickering tubes and your own glow can move. */
  private drawLights(now: number): void {
    const lights = this.room.lights;
    const map = this.lightMap;
    if (!lights || !map) return;
    map.fill(lights.ambient);
    const put = (x: number, y: number, r: number, wide: number, color: number, alpha: number) => {
      const d = (2 * r * TILE) / 256;
      this.glow.setPosition(x, y).setScale(d * wide, d).setTint(color).setAlpha(alpha);
      map.draw(this.glow);
    };
    lights.lamps.forEach((lamp, i) => {
      const s = this.lampState[i];
      if (lamp.flicker && now >= s.next) {
        // Mostly on; sometimes a quick stutter.
        const stutter = s.level === 1 && Math.random() < 0.35;
        s.level = stutter ? 0.15 + Math.random() * 0.35 : 1;
        if (stutter) audio.crackle();
        s.next = now + (stutter ? 40 + Math.random() * 120 : 600 + Math.random() * 3500);
      }
      put(lamp.x * TILE, lamp.y * TILE, lamp.r, lamp.wide ?? 1, lamp.color, s.level);
    });
    // Enough of a glow on you that you never vanish in the dark corners.
    put(this.player.x, this.player.y - 40, 1.6, 1, 0x7a8a7a, 0.6);
  }

  private flicker(): void {
    audio.crackle(true);
    const steps = [0.85, 0, 0.6, 0, 0.9, 0.2, 0];
    steps.forEach((a, i) => this.time.delayedCall(i * 110 + Math.random() * 60, () => this.dark.setFillStyle(0x000000, a)));
  }

  update(): void {
    const frozen = this.ui.busy;
    const k = this.keys;
    let vx = 0;
    let vy = 0;
    if (!frozen) {
      if (k.left.isDown || k.a.isDown) vx -= 1;
      if (k.right.isDown || k.d.isDown) vx += 1;
      if (k.up.isDown || k.w.isDown) vy -= 1;
      if (k.down.isDown || k.s.isDown) vy += 1;
    }
    const v = new Phaser.Math.Vector2(vx, vy);
    if (v.lengthSq() > 0) this.facing = v.clone().normalize();
    v.normalize().scale(SPEED);
    this.body_.setVelocity(v.x, v.y);
    this.player.setDepth(this.player.y);
    this.animate(v.lengthSq() > 0);
    this.drawLights(this.time.now);
    audio.update(this.player.x / TILE, this.player.y / TILE);

    this.near = frozen ? null : this.nearest();
    if (this.near) {
      const p = this.near;
      const above = p.onWall && p.y === 0;
      this.prompt
        .setText(`E  ${p.verb} ${p.label.replace(/\n/g, " ")}`)
        .setPosition((p.x + p.w / 2) * TILE, above ? (p.y + p.h) * TILE + 34 : p.y * TILE - 4)
        .setVisible(true);
    } else this.prompt.setVisible(false);

    // Ignore the press that just closed a dialogue box.
    const fresh = performance.now() - this.ui.closedAt > 200;
    if (!frozen && fresh && Phaser.Input.Keyboard.JustDown(k.e) && this.near) this.story.interact(this.near.id);
    if (!frozen && fresh && Phaser.Input.Keyboard.JustDown(k.q)) this.story.callWalter();
    if (frozen) {
      // Swallow presses made while the UI had the keyboard.
      Phaser.Input.Keyboard.JustDown(k.e);
      Phaser.Input.Keyboard.JustDown(k.q);
    }
  }

  /** Walks while moving; otherwise stands still facing the last way she walked. */
  private animate(moving: boolean): void {
    const f = this.facing;
    const dir = Math.abs(f.x) > Math.abs(f.y) ? (f.x < 0 ? "left" : "right") : f.y < 0 ? "up" : "down";
    if (moving) this.sprite.play(`walk-${dir}`, true);
    else this.sprite.stop().setFrame(DIRS.indexOf(dir) * 5);
  }

  /** The closest prop to your feet, a little ahead of where you face. */
  private nearest(): Prop | null {
    const fx = this.player.x + this.facing.x * 14;
    const fy = this.player.y - 10 + this.facing.y * 14;
    let best: Prop | null = null;
    let bestD = REACH;
    for (const p of this.room.props) {
      if (p.decor) continue;
      const x0 = p.x * TILE;
      const y0 = p.y * TILE;
      const dx = Math.max(x0 - fx, 0, fx - (x0 + p.w * TILE));
      const dy = Math.max(y0 - fy, 0, fy - (y0 + p.h * TILE));
      const d = Math.hypot(dx, dy);
      if (d <= bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }
}
