/**
 * Our own "gameplay" for split-screen backgrounds: small physics simulations
 * that draw their frames from scratch, so the footage is original, different
 * on every export (seeded per clip), and free of anyone else's rights.
 *
 *   escape_rings — "Will the ball escape?": nested spinning rings shatter as the ball slips through
 *   grow_ball   — a ball grows on every bounce until it fills the circle
 *   ring_bounce — balls bounce inside a spinning ring; each escape spawns two
 *   plinko      — marbles rain through pegs and build a bell curve
 *   runner      — an endless runner that jumps spikes and grabs coins
 *   stacker     — sliding blocks stack into a tower, trimming the overhang
 *
 * Pure TypeScript with no Node or DOM imports: the web editor runs this same
 * file for its live preview (apps/web/src/lib/games.ts is a copy; a test keeps
 * them identical).
 */

export const GAME_W = 540;
export const GAME_H = 480; // 9:8 — the bottom half of a 9:16 frame

export const GAMES: Record<string, string> = {
  escape_rings: "Will it escape?",
  grow_ball: "Growing ball",
  ring_bounce: "Ball multiplier",
  plinko: "Plinko drop",
  runner: "Neon runner",
  stacker: "Tower stack",
};

type RGB = [number, number, number];

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hsv(h: number, s: number, v: number): RGB {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** An RGB frame buffer with the few anti-aliased shapes the games need. */
export class Canvas {
  readonly buf: Uint8Array;
  constructor(readonly w = GAME_W, readonly h = GAME_H) { this.buf = new Uint8Array(w * h * 3); }

  private primed = false;
  fill(c: RGB) {
    this.primed = true;
    const b = this.buf;
    for (let i = 0; i < b.length; i += 3) { b[i] = c[0]; b[i + 1] = c[1]; b[i + 2] = c[2]; }
  }
  /** Pulls every pixel toward `c` — leaves motion trails behind moving things. */
  fade(c: RGB, keep: number) {
    // Start from the background itself: fading up from black never quite
    // arrives (integer rounding), which leaves ghost marks where things were.
    if (!this.primed) { this.fill(c); return; }
    const b = this.buf, k = keep, a0 = c[0] * (1 - k), a1 = c[1] * (1 - k), a2 = c[2] * (1 - k);
    for (let i = 0; i < b.length; i += 3) { b[i] = b[i] * k + a0; b[i + 1] = b[i + 1] * k + a1; b[i + 2] = b[i + 2] * k + a2; }
  }
  private blend(x: number, y: number, c: RGB, a: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 3, b = this.buf;
    if (a >= 1) { b[i] = c[0]; b[i + 1] = c[1]; b[i + 2] = c[2]; return; }
    b[i] += (c[0] - b[i]) * a; b[i + 1] += (c[1] - b[i + 1]) * a; b[i + 2] += (c[2] - b[i + 2]) * a;
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1) {
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w)), y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.blend(xx, yy, c, a);
  }
  circle(cx: number, cy: number, r: number, c: RGB, a = 1) {
    const x0 = Math.floor(cx - r - 1), x1 = Math.ceil(cx + r + 1), y0 = Math.floor(cy - r - 1), y1 = Math.ceil(cy + r + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cov = Math.min(1, Math.max(0, r + 0.5 - d));
      if (cov > 0) this.blend(x, y, c, cov * a);
    }
  }
  /** A ring between radii r0..r1, missing the arc [gapA, gapA + gapLen). */
  ring(cx: number, cy: number, r0: number, r1: number, c: RGB, gapA: number, gapLen: number) {
    // Per row, visit only the band between the circles (not the whole box).
    const ro = r1 + 1, ri = Math.max(0, r0 - 1);
    const y0 = Math.floor(cy - ro), y1 = Math.ceil(cy + ro);
    const px = (x: number, y: number) => {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.sqrt(dx * dx + dy * dy);
      const cov = Math.min(1, Math.max(0, Math.min(d - r0 + 0.5, r1 + 0.5 - d)));
      if (cov <= 0) return;
      if (gapLen > 0) {
        const a = (((Math.atan2(dy, dx) - gapA) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        if (a < gapLen) return;
      }
      this.blend(x, y, c, cov);
    };
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy, xo = Math.sqrt(Math.max(0, ro * ro - dy * dy));
      const xi = Math.abs(dy) < ri ? Math.sqrt(ri * ri - dy * dy) : 0;
      const a0 = Math.floor(cx - xo), a1 = Math.ceil(cx - xi), b0 = Math.floor(cx + xi), b1 = Math.ceil(cx + xo);
      if (a1 >= b0) { for (let x = a0; x <= b1; x++) px(x, y); continue; }
      for (let x = a0; x <= a1; x++) px(x, y);
      for (let x = b0; x <= b1; x++) px(x, y);
    }
  }
  /** Seven-segment number, right-aligned at x. */
  number(n: number, x: number, y: number, size: number, c: RGB) {
    const SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
    const s = String(Math.max(0, Math.floor(n))), t = Math.max(2, Math.round(size / 5)), w = size * 0.6, gap = size * 0.25;
    let px = x - s.length * (w + gap);
    for (const ch of s) {
      const m = SEG[+ch];
      const seg = (bit: number, sx: number, sy: number, sw: number, sh: number) => { if (m & (1 << bit)) this.rect(px + sx, y + sy, sw, sh, c); };
      seg(0, 0, 0, w, t); seg(1, w - t, 0, t, size / 2); seg(2, w - t, size / 2, t, size / 2);
      seg(3, 0, size - t, w, t); seg(4, 0, size / 2, t, size / 2); seg(5, 0, 0, t, size / 2); seg(6, 0, size / 2 - t / 2, w, t);
      px += w + gap;
    }
  }
}

export interface Game {
  step(dt: number): void;
  draw(c: Canvas): void;
  /** Payoffs so far (a ring shatters, a ball escapes, the circle fills…). */
  events: number;
  /** Seconds of build-up to show before a payoff when the footage starts. */
  readonly lead?: number;
}

/**
 * The challenge line shown on the footage — the same "will it…?" framing the
 * viral simulation videos use to make people wait for the payoff.
 */
export const GAME_HOOKS: Record<string, string> = {
  escape_rings: "WILL IT ESCAPE?",
  grow_ball: "WILL IT FILL THE CIRCLE?",
  ring_bounce: "EVERY ESCAPE = 2 MORE BALLS",
  plinko: "WHERE WILL THEY LAND?",
  runner: "HOW FAR CAN IT GET?",
  stacker: "HOW HIGH CAN IT STACK?",
};

// ---------------------------------------------------------------------------

/** Balls bounce inside a spinning ring; a ball that slips out of the gap spawns two more. */
class RingBounce implements Game {
  events = 0; readonly lead = 1.2;
  private balls: { x: number; y: number; vx: number; vy: number; r: number; hue: number; out: boolean }[] = [];
  private rot = 0; private hue: number; private escaped = 0; private t = 0;
  private readonly cx = GAME_W / 2; private readonly cy = GAME_H / 2 + 6; private readonly R = 205;
  private readonly gap = 0.55; private readonly spin: number;
  constructor(private rand: () => number) { this.hue = rand(); this.spin = (rand() < 0.5 ? -1 : 1) * (0.9 + rand() * 0.6); this.reset(); }
  private reset() { this.balls = []; this.spawn(); }
  private spawn() {
    const a = this.rand() * Math.PI * 2, sp = 220 + this.rand() * 160;
    this.balls.push({ x: this.cx, y: this.cy - 40, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 9, hue: this.hue += 0.071, out: false });
  }
  step(dt: number) {
    this.t += dt; this.rot += this.spin * dt;
    const sub = 4, h = dt / sub;
    for (let k = 0; k < sub; k++) {
      for (const b of this.balls) {
        b.vy += 520 * h; b.x += b.vx * h; b.y += b.vy * h;
        if (b.out) continue;
        const dx = b.x - this.cx, dy = b.y - this.cy, d = Math.hypot(dx, dy);
        if (d + b.r < this.R) continue;
        const ang = (((Math.atan2(dy, dx) - this.rot) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const slack = b.r / this.R;
        if (ang > slack && ang < this.gap - slack) {
          b.out = true; this.escaped++; this.events++;
          const alive = this.balls.filter((x) => !x.out).length;
          if (alive < 60) { this.spawn(); this.spawn(); }
          continue;
        }
        const nx = dx / d, ny = dy / d, dot = b.vx * nx + b.vy * ny;
        if (dot > 0) { b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny; }
        const sp = Math.hypot(b.vx, b.vy), target = Math.min(820, sp * 1.015 + 6);
        b.vx *= target / sp; b.vy *= target / sp;
        b.x = this.cx + nx * (this.R - b.r - 0.5); b.y = this.cy + ny * (this.R - b.r - 0.5);
      }
    }
    this.balls = this.balls.filter((b) => b.y < GAME_H + 40 && b.x > -40 && b.x < GAME_W + 40);
    if (!this.balls.some((b) => !b.out)) this.reset();
  }
  draw(c: Canvas) {
    c.fade([8, 6, 22], 0.8);
    c.ring(this.cx, this.cy, this.R, this.R + 7, hsv(this.t * 0.05 + 0.55, 0.5, 1), this.rot, this.gap);
    for (const b of this.balls) c.circle(b.x, b.y, b.r, hsv(b.hue, 0.75, 1));
    c.number(this.escaped, GAME_W - 18, 14, 34, [255, 255, 255]);
  }
}

/** Marbles rain through a peg board and pile up into a bell curve. */
class Plinko implements Game {
  events = 0;
  private pegs: { x: number; y: number; flash: number }[] = [];
  private balls: { x: number; y: number; vx: number; vy: number; hue: number }[] = [];
  private bins: number[]; private readonly binW = 45; private t = 0; private hue: number;
  private rows: number[][] = [];
  constructor(private rand: () => number) {
    this.hue = rand();
    for (let r = 0; r < 10; r++) {
      const y = 70 + r * 30, row: number[] = [];
      for (let x = (r % 2 ? 22.5 : 45); x < GAME_W; x += 45) { row.push(this.pegs.length); this.pegs.push({ x, y, flash: 0 }); }
      this.rows.push(row);
    }
    this.bins = new Array(Math.ceil(GAME_W / this.binW)).fill(0);
  }
  step(dt: number) {
    this.t += dt;
    if (this.balls.length < 45 && this.rand() < dt * 9) {
      this.balls.push({ x: GAME_W / 2 + (this.rand() - 0.5) * 30, y: 20, vx: (this.rand() - 0.5) * 30, vy: 0, hue: this.hue += 0.037 });
    }
    const sub = 3, h = dt / sub, R = 8, P = 4;
    for (let k = 0; k < sub; k++) for (const b of this.balls) {
      b.vy += 900 * h; b.x += b.vx * h; b.y += b.vy * h;
      if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx) * 0.6; }
      if (b.x > GAME_W - R) { b.x = GAME_W - R; b.vx = -Math.abs(b.vx) * 0.6; }
      const ri = Math.round((b.y - 70) / 30);
      for (const r of [ri - 1, ri, ri + 1]) for (const pi of this.rows[r] ?? []) {
        const p = this.pegs[pi], dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
        if (d >= R + P || d === 0) continue;
        const nx = dx / d, ny = dy / d, dot = b.vx * nx + b.vy * ny;
        if (dot < 0) { b.vx -= 1.5 * dot * nx; b.vy -= 1.5 * dot * ny; b.vx += (this.rand() - 0.5) * 40; }
        b.x = p.x + nx * (R + P); b.y = p.y + ny * (R + P); p.flash = 1;
      }
    }
    const floor = GAME_H - 4;
    this.balls = this.balls.filter((b) => {
      const bin = Math.min(this.bins.length - 1, Math.max(0, Math.floor(b.x / this.binW)));
      if (b.y < floor - this.bins[bin] * 3 - 8) return true;
      this.bins[bin]++;
      return false;
    });
    if (Math.max(...this.bins) * 3 > 120) this.bins = this.bins.map((n) => Math.floor(n / 2));
    for (const p of this.pegs) p.flash = Math.max(0, p.flash - dt * 3);
  }
  draw(c: Canvas) {
    c.fade([10, 8, 28], 0.7);
    for (let i = 0; i < this.bins.length; i++) {
      const hgt = this.bins[i] * 3;
      c.rect(i * this.binW + 3, GAME_H - 4 - hgt, this.binW - 6, hgt, hsv(this.hue - i * 0.03, 0.65, 0.95));
      c.rect(i * this.binW, GAME_H - 130, 2, 130, [70, 60, 120]);
    }
    for (const p of this.pegs) c.circle(p.x, p.y, 4, p.flash > 0 ? [255, 255, 200] : [150, 140, 220], 1);
    for (const b of this.balls) c.circle(b.x, b.y, 8, hsv(b.hue, 0.7, 1));
  }
}

/** An endless runner: jumps the spikes, grabs the coins, speeds up. */
class Runner implements Game {
  events = 0; readonly lead = 1.0;
  private x = 0; private speed = 280; private py = 0; private vy = 0; private score = 0; private crash = 0;
  private obstacles: { x: number; w: number; h: number }[] = [];
  private coins: { x: number; y: number; got: number }[] = [];
  private stars: { x: number; y: number; z: number }[] = [];
  private skyline: { x: number; w: number; h: number }[] = [];
  private nextObs = 400; private hue: number;
  private readonly ground = 400; private readonly px = 110; private readonly size = 30;
  constructor(private rand: () => number) {
    this.hue = rand();
    for (let i = 0; i < 70; i++) this.stars.push({ x: rand() * GAME_W, y: rand() * 260, z: 0.2 + rand() * 0.8 });
    for (let x = 0; x < GAME_W + 200; x += 40 + rand() * 50) this.skyline.push({ x, w: 30 + rand() * 50, h: 40 + rand() * 120 });
  }
  step(dt: number) {
    if (this.crash > 0) { this.crash -= dt; if (this.crash <= 0) { this.speed = 280; this.obstacles = []; this.coins = []; this.score = 0; } return; }
    this.speed = Math.min(560, this.speed + dt * 6);
    const dx = this.speed * dt;
    this.x += dx; this.score += dx / 20;
    for (const s of this.stars) { s.x -= dx * s.z * 0.15; if (s.x < 0) s.x += GAME_W; }
    for (const b of this.skyline) { b.x -= dx * 0.35; if (b.x + b.w < 0) b.x += GAME_W + 200; }
    for (const o of this.obstacles) o.x -= dx;
    for (const c of this.coins) c.x -= dx;
    this.obstacles = this.obstacles.filter((o) => o.x + o.w > -10);
    this.coins = this.coins.filter((c) => c.x > -20 && c.got < 1);
    this.nextObs -= dx;
    if (this.nextObs <= 0) {
      const h = 22 + this.rand() * 40, w = 18 + this.rand() * 26;
      this.obstacles.push({ x: GAME_W + 20, w, h });
      for (let k = 0; k < 3; k++) this.coins.push({ x: GAME_W + 20 + w / 2 + (k - 1) * 34, y: this.ground - h - 70 - (k === 1 ? 14 : 0), got: 0 });
      this.nextObs = 230 + this.rand() * 260 + this.speed * 0.25;
    }
    // The "player": jumps when the next obstacle is close (and very rarely mistimes it).
    const onGround = this.py >= 0;
    const next = this.obstacles.find((o) => o.x + o.w > this.px);
    if (onGround && next) {
      const lead = next.x - (this.px + this.size);
      const when = this.speed * 0.2 + (this.rand() < 0.004 ? 140 : 0);
      if (lead > 0 && lead < when) this.vy = -620;
    }
    this.vy += 1900 * dt; this.py = Math.min(0, this.py + this.vy * dt);
    if (this.py >= 0) this.vy = 0;
    const top = this.ground - this.size + this.py;
    for (const o of this.obstacles) {
      if (o.x < this.px + this.size - 4 && o.x + o.w > this.px + 4 && top + this.size > this.ground - o.h + 4) { this.crash = 0.8; return; }
    }
    for (const c of this.coins) {
      if (!c.got && Math.abs(c.x - (this.px + this.size / 2)) < 24 && Math.abs(c.y - (top + this.size / 2)) < 26) { c.got = 0.01; this.score += 25; this.events++; }
      if (c.got) c.got += dt * 4;
    }
  }
  draw(c: Canvas) {
    c.fill([12, 6, 30]);
    for (const s of this.stars) c.rect(s.x, s.y, 2, 2, [180, 180, 255], s.z);
    for (const b of this.skyline) c.rect(b.x, this.ground - b.h, b.w, b.h, [34, 20, 70]);
    c.rect(0, this.ground, GAME_W, GAME_H - this.ground, [20, 10, 44]);
    c.rect(0, this.ground, GAME_W, 3, hsv(this.hue, 0.8, 1));
    for (let gx = -(this.x % 48); gx < GAME_W; gx += 48) c.rect(gx, this.ground + 14, 24, 3, [80, 50, 150]);
    for (const o of this.obstacles) {
      // a spike: stacked bars narrowing to a point
      for (let k = 0; k < o.h; k += 2) { const ww = o.w * (1 - k / o.h); c.rect(o.x + (o.w - ww) / 2, this.ground - k - 2, ww, 2, hsv(this.hue + 0.5, 0.85, 1)); }
    }
    for (const co of this.coins) c.circle(co.x, co.y - co.got * 30, 9 * (1 - co.got * 0.7), [255, 210, 40], 1 - co.got * 0.8);
    const top = this.ground - this.size + this.py;
    const col: RGB = this.crash > 0 ? [255, 60, 60] : hsv(this.hue + 0.15, 0.6, 1);
    for (let k = 1; k <= 4; k++) c.rect(this.px - k * 10, top + 4, this.size - 8, this.size - 8, col, 0.12 * (5 - k));
    c.rect(this.px, top, this.size, this.size, col);
    c.rect(this.px + 18, top + 8, 6, 6, [20, 10, 40]);
    c.number(this.score, GAME_W - 18, 14, 30, [255, 255, 255]);
  }
}

/** Sliding blocks stack into a tower; the overhang is sliced off and falls. */
class Stacker implements Game {
  events = 0; readonly lead = 1.2;
  private tower: { x: number; w: number; hue: number }[] = [];
  private cur = { x: 0, w: 0, dir: 1, target: 0 };
  private debris: { x: number; y: number; w: number; vy: number; hue: number }[] = [];
  private cam = 0; private hue: number; private flash = 0; private speed = 260;
  private readonly bh = 24; private readonly baseY = GAME_H - 30;
  constructor(private rand: () => number) { this.hue = rand(); this.reset(); }
  private reset() {
    this.tower = [{ x: GAME_W / 2 - 130, w: 260, hue: this.hue }];
    this.speed = 260; this.cam = 0; this.next();
  }
  private next() {
    const top = this.tower[this.tower.length - 1];
    const dir = this.tower.length % 2 ? 1 : -1;
    const err = this.rand() < 0.3 ? 0 : (this.rand() - 0.5) * 2 * Math.min(40, top.w * 0.35);
    this.cur = { x: dir > 0 ? -top.w : GAME_W, w: top.w, dir, target: top.x + err };
  }
  private yOf(level: number) { return this.baseY - level * this.bh + this.cam; }
  step(dt: number) {
    this.flash = Math.max(0, this.flash - dt * 3);
    for (const d of this.debris) { d.vy += 1400 * dt; d.y += d.vy * dt; }
    this.debris = this.debris.filter((d) => d.y < GAME_H + 50);
    const want = Math.max(0, (this.tower.length - 10) * this.bh);
    this.cam += (want - this.cam) * Math.min(1, dt * 4);
    const c = this.cur, top = this.tower[this.tower.length - 1];
    c.x += c.dir * this.speed * dt;
    if ((c.dir > 0 && c.x < c.target) || (c.dir < 0 && c.x > c.target)) return;
    // drop
    let x = c.target, w = c.w;
    const level = this.tower.length, hue = this.hue + level * 0.045;
    if (Math.abs(x - top.x) < 3) { x = top.x; w = Math.min(260, top.w + 4); this.flash = 1; this.events++; }
    else {
      const l = Math.max(x, top.x), r = Math.min(x + w, top.x + top.w);
      const y = this.yOf(level);
      if (x < top.x) this.debris.push({ x, y, w: top.x - x, vy: 0, hue });
      if (x + w > top.x + top.w) this.debris.push({ x: top.x + top.w, y, w: x + w - top.x - top.w, vy: 0, hue });
      x = l; w = r - l;
    }
    if (w < 14) { this.debris.push(...this.tower.map((t, i) => ({ x: t.x, y: this.yOf(i), w: t.w, vy: -i * 8, hue: t.hue }))); this.reset(); return; }
    this.tower.push({ x, w, hue });
    this.speed = Math.min(520, this.speed + 8);
    this.next();
  }
  draw(cv: Canvas) {
    const bg = hsv(this.hue + this.tower.length * 0.01, 0.45, 0.16);
    cv.fill(bg);
    for (let i = 0; i < this.tower.length; i++) {
      const t = this.tower[i], y = this.yOf(i);
      if (y > GAME_H || y < -this.bh) continue;
      cv.rect(t.x, y, t.w, this.bh - 2, hsv(t.hue, 0.55, 0.95));
      cv.rect(t.x, y, t.w, 3, hsv(t.hue, 0.3, 1));
    }
    const lvl = this.tower.length;
    cv.rect(this.cur.x, this.yOf(lvl), this.cur.w, this.bh - 2, hsv(this.hue + lvl * 0.045, 0.55, 1));
    for (const d of this.debris) cv.rect(d.x, d.y, d.w, this.bh - 2, hsv(d.hue, 0.55, 0.85));
    if (this.flash > 0) cv.rect(0, 0, GAME_W, GAME_H, [255, 255, 255], this.flash * 0.18);
    cv.number(lvl - 1, GAME_W - 18, 14, 34, [255, 255, 255]);
  }
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; c: RGB }
function stepParticles(ps: Particle[], dt: number): Particle[] {
  for (const p of ps) { p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  return ps.filter((p) => p.life > 0 && p.y < GAME_H + 10);
}

/**
 * "Will the ball escape?" — the format behind the bouncing-ball trend: a ball
 * inside nested spinning rings; slipping through a ring's gap shatters it.
 */
class EscapeRings implements Game {
  events = 0; readonly lead = 1.5;
  private rings: { r: number; rot: number; spin: number; hue: number }[] = [];
  private ball = { x: 0, y: 0, vx: 0, vy: 0, hue: 0 };
  private parts: Particle[] = []; private wait = 0; private hue: number;
  private readonly cx = GAME_W / 2; private readonly cy = GAME_H / 2 + 4; private readonly gap = 0.62;
  constructor(private rand: () => number) { this.hue = rand(); this.reset(); }
  private reset() {
    this.rings = [];
    for (let i = 0; i < 6; i++) {
      this.rings.push({ r: 62 + i * 30, rot: this.rand() * 6.28, spin: (i % 2 ? -1 : 1) * (0.7 + this.rand() * 0.9), hue: this.hue + i * 0.09 });
    }
    const a = this.rand() * 6.28;
    this.ball = { x: this.cx, y: this.cy, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, hue: this.hue };
    this.wait = 0;
  }
  step(dt: number) {
    this.parts = stepParticles(this.parts, dt);
    for (const r of this.rings) r.rot += r.spin * dt;
    if (!this.rings.length) { this.wait += dt; this.ball.vy += 600 * dt; this.ball.x += this.ball.vx * dt; this.ball.y += this.ball.vy * dt; if (this.wait > 1.4) this.reset(); return; }
    const b = this.ball, R = 8, sub = 4, h = dt / sub;
    for (let k = 0; k < sub && this.rings.length; k++) {
      b.vy += 420 * h; b.x += b.vx * h; b.y += b.vy * h;
      const ring = this.rings[0];
      const dx = b.x - this.cx, dy = b.y - this.cy, d = Math.hypot(dx, dy);
      if (d + R < ring.r) continue;
      const ang = (((Math.atan2(dy, dx) - ring.rot) % 6.2832) + 6.2832) % 6.2832, slack = R / ring.r;
      if (ang > slack && ang < this.gap - slack) {
        // shatter the ring
        for (let p = 0; p < 70; p++) {
          const a = this.rand() * 6.2832, sp = 60 + this.rand() * 200;
          this.parts.push({ x: this.cx + Math.cos(a) * ring.r, y: this.cy + Math.sin(a) * ring.r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6 + this.rand() * 0.6, c: hsv(ring.hue, 0.7, 1) });
        }
        this.rings.shift();
        this.events++;
        // Tension rises: every ring that's left spins a little faster.
        for (const r of this.rings) r.spin *= 1.18;
        continue;
      }
      const nx = dx / d, ny = dy / d, dot = b.vx * nx + b.vy * ny;
      if (dot > 0) { b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny; }
      const sp = Math.hypot(b.vx, b.vy), target = Math.min(700, Math.max(300, sp * 1.01));
      b.vx *= target / sp; b.vy *= target / sp;
      b.x = this.cx + nx * (ring.r - R - 0.5); b.y = this.cy + ny * (ring.r - R - 0.5);
      b.hue += 0.06;
    }
  }
  draw(c: Canvas) {
    c.fade([6, 4, 16], 0.78);
    for (const r of this.rings) c.ring(this.cx, this.cy, r.r, r.r + 5, hsv(r.hue, 0.65, 1), r.rot, this.gap);
    for (const p of this.parts) c.rect(p.x, p.y, 3, 3, p.c, Math.min(1, p.life * 2));
    c.circle(this.ball.x, this.ball.y, 8, hsv(this.ball.hue, 0.8, 1));
    c.number(this.rings.length, GAME_W - 18, 14, 34, [255, 255, 255]);
  }
}

/** A ball that grows a little on every bounce until it fills the circle. */
class GrowBall implements Game {
  events = 0; readonly lead = 5; // open with it nearly full, then pop
  private b = { x: 0, y: 0, vx: 0, vy: 0, r: 10, hue: 0 };
  private bounces = 0; private flash = 0; private hue: number; private parts: Particle[] = [];
  private readonly cx = GAME_W / 2; private readonly cy = GAME_H / 2 + 4; private readonly R = 212;
  constructor(private rand: () => number) { this.hue = rand(); this.reset(); }
  private reset() {
    const a = this.rand() * 6.28;
    this.b = { x: this.cx, y: this.cy - 60, vx: Math.cos(a) * 320, vy: Math.sin(a) * 320, r: 10, hue: this.hue };
    this.bounces = 0;
  }
  step(dt: number) {
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.parts = stepParticles(this.parts, dt);
    const b = this.b, sub = 4, h = dt / sub;
    for (let k = 0; k < sub; k++) {
      b.vy += 600 * h; b.x += b.vx * h; b.y += b.vy * h;
      const dx = b.x - this.cx, dy = b.y - this.cy, d = Math.hypot(dx, dy);
      if (d + b.r < this.R) continue;
      const nx = dx / d, ny = dy / d, dot = b.vx * nx + b.vy * ny;
      if (dot > 0) {
        b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny;
        b.r += 2.2 + b.r * 0.012; b.hue += 0.05; this.bounces++;
        for (let p = 0; p < 6; p++) this.parts.push({ x: this.cx + nx * this.R, y: this.cy + ny * this.R, vx: (this.rand() - 0.5) * 200 - nx * 80, vy: (this.rand() - 0.5) * 200 - ny * 80, life: 0.4, c: hsv(b.hue, 0.6, 1) });
      }
      const sp = Math.hypot(b.vx, b.vy), target = Math.max(380, Math.min(760, sp));
      b.vx *= target / sp; b.vy *= target / sp;
      b.x = this.cx + nx * Math.max(0, this.R - b.r - 0.5); b.y = this.cy + ny * Math.max(0, this.R - b.r - 0.5);
      if (b.r >= this.R * 0.93) { this.flash = 1; this.events++; this.reset(); break; }
    }
  }
  draw(c: Canvas) {
    c.fade([10, 6, 24], 0.82);
    c.ring(this.cx, this.cy, this.R, this.R + 6, [255, 255, 255], 0, 0);
    for (const p of this.parts) c.rect(p.x, p.y, 3, 3, p.c, Math.min(1, p.life * 3));
    c.circle(this.b.x, this.b.y, this.b.r, hsv(this.b.hue, 0.75, 1));
    if (this.flash > 0) c.rect(0, 0, GAME_W, GAME_H, [255, 255, 255], this.flash * 0.35);
    c.number(this.bounces, GAME_W - 18, 14, 34, [255, 255, 255]);
  }
}

export function makeGame(id: string, seed: number): Game {
  const r = rng(seed);
  switch (id) {
    case "escape_rings": return new EscapeRings(r);
    case "grow_ball": return new GrowBall(r);
    case "plinko": return new Plinko(r);
    case "runner": return new Runner(r);
    case "stacker": return new Stacker(r);
    case "ring_bounce":
    default: return new RingBounce(r);
  }
}

/**
 * Renders `frames` frames, handing each RGB buffer to `emit`. A short warm-up
 * runs first so the footage starts mid-action, not on an empty board.
 */
/**
 * Where the footage should start: `lead` seconds before the first payoff, so
 * the clip opens on build-up and pays off almost at once (the hook), instead
 * of on an empty board. Deterministic: same id + seed → same start.
 */
export function hookStartSteps(id: string, seed: number, fps: number): number {
  const game = makeGame(id, seed), dt = 1 / fps;
  const lead = Math.round((game.lead ?? 0) * fps), minStep = lead + Math.round(fps * 0.5);
  if (!game.lead) return fps * 4;
  for (let i = 0; i < fps * 60; i++) {
    const before = game.events;
    game.step(dt);
    if (game.events > before && i >= minStep) return i - lead;
  }
  return fps * 4;
}

export async function renderGame(id: string, seed: number, fps: number, frames: number, emit: (rgb: Uint8Array) => Promise<void> | void): Promise<void> {
  const game = makeGame(id, seed), canvas = new Canvas(), dt = 1 / fps;
  const warm = hookStartSteps(id, seed, fps);
  for (let i = 0; i < warm; i++) game.step(dt);
  for (let f = 0; f < frames; f++) {
    game.step(dt);
    game.draw(canvas);
    await emit(canvas.buf);
  }
}
