/**
 * Modern 1–2 storey cottages for the small-house districts (islands, forest, great desert).
 *
 * Every cottage is assembled from a form, a roof, a material, a glazing pattern and
 * garden extras, chosen per plot and deterministic. No two cottages share the same
 * form + roof + floors + material + glazing while combinations last; after that a
 * repeat is only allowed far away, so neighbours never look alike.
 */
import type { Plot } from "./generator";
import type { Biome } from "./regions";
import { shade, type RGB } from "./palette";

export const COTTAGE_FORMS = ["cube", "long", "ell", "split", "cantilever", "pavilion", "barn", "twin"] as const;
export type CottageForm = (typeof COTTAGE_FORMS)[number];
export const COTTAGE_ROOFS = ["flat", "green", "shed", "gable", "hip"] as const;
export type CottageRoof = (typeof COTTAGE_ROOFS)[number];
export const GLAZINGS = ["band", "panes", "corner", "slits"] as const;
export type Glazing = (typeof GLAZINGS)[number] | "full" | "garage";

/** Facade materials: main wall and the second material for wings, upper floors and trim. */
export const MATERIALS = [
  { id: "white", wall: [244, 244, 240], wall2: [178, 128, 84] },
  { id: "graphite", wall: [72, 76, 84], wall2: [236, 236, 232] },
  { id: "cedar", wall: [186, 132, 86], wall2: [66, 70, 78] },
  { id: "charred", wall: [44, 42, 44], wall2: [196, 146, 96] },
  { id: "concrete", wall: [170, 172, 170], wall2: [244, 244, 240] },
  { id: "sandstone", wall: [222, 196, 150], wall2: [250, 248, 240] },
  { id: "brick", wall: [166, 84, 64], wall2: [60, 64, 72] },
  { id: "sage", wall: [146, 168, 140], wall2: [246, 244, 236] },
  { id: "terracotta", wall: [208, 128, 92], wall2: [246, 238, 222] },
  { id: "cream", wall: [238, 226, 200], wall2: [92, 100, 112] },
] as const satisfies readonly { id: string; wall: RGB; wall2: RGB }[];
export type MaterialId = (typeof MATERIALS)[number]["id"];

const ROOF_TONES: RGB[] = [
  [62, 66, 74], // anthracite metal
  [140, 148, 156], // zinc
  [176, 92, 64], // terracotta
  [48, 52, 58], // dark slate
  [112, 84, 66], // weathered timber
];

/** Materials a region leans to; any material may still appear. */
const PREFS: Partial<Record<Biome, number[]>> = {
  woodland: [2, 3, 7, 1, 0, 6],
  dunes: [5, 8, 0, 9, 4],
  oceania: [0, 9, 4, 2, 7, 8],
  isles: [1, 0, 4, 2, 3, 7],
};

export interface Cottage {
  form: CottageForm;
  roof: CottageRoof;
  floors: 1 | 2;
  material: MaterialId;
  glazing: (typeof GLAZINGS)[number];
  /** Design swapped across the tile diagonal (u <-> v). */
  flip: boolean;
  pool: boolean;
  deck: boolean;
  solar: boolean;
  chimney: boolean;
  shrubs: boolean;
  wall: RGB;
  wall2: RGB;
  roofColor: RGB;
}

/** What makes a cottage look different at a glance. */
export const cottageKey = (c: Cottage) => `${c.form}|${c.roof}|${c.floors}|${c.material}|${c.glazing}`;

const hash = (n: number) => {
  let h = (n * 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
};

function candidate(plot: Plot, biome: Biome, attempt: number): Cottage {
  const h = hash(plot.id * 977 + attempt * 7919 + 13);
  const g = hash(h + 101);
  const prefs = PREFS[biome];
  const m = prefs && attempt < 30 ? prefs[h % prefs.length] : h % MATERIALS.length;
  const mat = MATERIALS[m];
  const form = COTTAGE_FORMS[(h >>> 5) % COTTAGE_FORMS.length];
  const floors: 1 | 2 = form === "cantilever" ? 2 : form === "pavilion" ? 1 : (h >>> 9) % 5 < 3 ? 2 : 1;
  let roof = COTTAGE_ROOFS[(h >>> 12) % COTTAGE_ROOFS.length];
  if (form === "barn") roof = "gable";
  if (form === "pavilion" && (roof === "gable" || roof === "hip")) roof = roof === "gable" ? "shed" : "flat";
  const glazing = GLAZINGS[(h >>> 16) % GLAZINGS.length];
  const j = (c: number, k: number) => Math.max(0, Math.min(255, Math.round(c * (0.94 + ((g >>> k) % 13) / 100))));
  const jit = (c: readonly number[], k: number): RGB => [j(c[0], k), j(c[1], k + 1), j(c[2], k + 2)];
  const tone = form === "barn" && g % 2 === 0 ? mat.wall2 : ROOF_TONES[(g >>> 4) % ROOF_TONES.length];
  return {
    form,
    roof,
    floors,
    material: mat.id,
    glazing,
    flip: ((g >>> 7) & 1) === 1,
    pool: (g >>> 8) % 5 < 2,
    deck: (g >>> 11) % 3 !== 0,
    solar: (roof === "flat" || roof === "shed") && (g >>> 13) % 3 === 0,
    chimney: (roof === "gable" || roof === "hip") && (g >>> 15) % 2 === 0,
    shrubs: (g >>> 17) % 4 !== 0,
    wall: jit(mat.wall, 2),
    wall2: jit(mat.wall2, 6),
    roofColor: jit(tone, 10),
  };
}

/**
 * A distinct cottage for each plot, in plot order. `biomeOf` gives the plot's climate;
 * the result is keyed by plot id.
 */
export function designCottages(plots: Plot[], biomeOf: (p: Plot) => Biome): Map<number, Cottage> {
  const out = new Map<number, Cottage>();
  const used = new Map<string, { x: number; y: number }[]>();
  // repeats are only allowed this far apart, in tiles, once every combination is taken
  const FAR = 24;
  for (const plot of plots) {
    let pick: Cottage | null = null;
    for (let a = 0; !pick; a++) {
      const c = candidate(plot, biomeOf(plot), a);
      const seen = used.get(cottageKey(c));
      if (!seen) pick = c;
      else if (a > 400 && seen.every((s) => Math.abs(s.x - plot.anchor.x) + Math.abs(s.y - plot.anchor.y) > FAR)) pick = c;
    }
    const k = cottageKey(pick);
    if (!used.has(k)) used.set(k, []);
    used.get(k)!.push(plot.anchor);
    out.set(plot.id, pick);
  }
  return out;
}

/* ------------------------------------------------------------------ drawing */

/** Colours of one cottage at the current daylight. */
export interface CottagePalette {
  wallL: string;
  wallR: string;
  wall2L: string;
  wall2R: string;
  roofT: string;
  roofL: string;
  roofR: string;
  roofBack: string;
  parapet: string;
  membrane: string;
  sedum: string;
  sedumDot: string;
  glassL: string;
  glassR: string;
  frame: string;
  deck: string;
  coping: string;
  water: string;
  solar: string;
  shrub: string;
  shrubDark: string;
  shadow: string;
  night: boolean;
}

export function cottagePalette(c: Cottage, day: number): CottagePalette {
  const night = day < 0.5;
  const glass: RGB = night ? [226, 176, 108] : [126, 168, 196];
  const g = (k: number) => (night ? `rgb(${glass.map((v) => Math.round(v * k)).join(",")})` : shade(glass, day, k));
  return {
    wallL: shade(c.wall, day, 0.94),
    wallR: shade(c.wall, day, 0.74),
    wall2L: shade(c.wall2, day, 0.94),
    wall2R: shade(c.wall2, day, 0.74),
    roofT: shade(c.roofColor, day, 1),
    roofL: shade(c.roofColor, day, 0.92),
    roofR: shade(c.roofColor, day, 0.74),
    roofBack: shade(c.roofColor, day, 0.82),
    parapet: shade(c.wall2, day, 1),
    membrane: shade([132, 136, 140], day, 1),
    sedum: shade([104, 150, 72], day, 1),
    sedumDot: shade([150, 180, 92], day, 1),
    glassL: g(night ? 0.9 : 1),
    glassR: g(night ? 0.66 : 0.82),
    frame: shade([40, 42, 46], day, 1),
    deck: shade([168, 120, 78], day, 1),
    coping: shade([232, 228, 218], day, 1),
    water: night ? "rgb(70,190,220)" : shade([76, 190, 222], day, 1),
    solar: shade([36, 52, 92], day, 1),
    shrub: shade([70, 138, 66], day, 1),
    shrubDark: shade([46, 104, 52], day, 1),
    shadow: "rgba(10,16,30,0.22)",
    night,
  };
}

interface Box {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** Bottom and height in floors. */
  z0: number;
  h: number;
  /** 0 = main material, 1 = second material. */
  mat: 0 | 1;
  /** The volume that carries the cottage's roof; others get a flat roof. */
  main?: boolean;
  glazing?: Glazing;
  /** Roof slab reaching past the walls. */
  overhang?: number;
}

/** Volumes of each form in tile units (-0.5..0.5); the front corner (+u, +v) is left for the garden. */
function volumes(c: Cottage): Box[] {
  const f = c.floors;
  switch (c.form) {
    case "cube":
      return [{ u0: -0.34, u1: 0.24, v0: -0.38, v1: 0.2, z0: 0, h: f, mat: 0, main: true }];
    case "long":
      return [{ u0: -0.44, u1: 0.3, v0: -0.32, v1: 0.06, z0: 0, h: f, mat: 0, main: true }];
    case "ell":
      return [
        { u0: -0.44, u1: 0.28, v0: -0.42, v1: -0.06, z0: 0, h: f, mat: 0, main: true },
        { u0: -0.44, u1: -0.06, v0: -0.06, v1: 0.3, z0: 0, h: 1, mat: 1 },
      ];
    case "split":
      return [
        { u0: -0.44, u1: -0.04, v0: -0.4, v1: 0.24, z0: 0, h: f, mat: 0, main: true },
        { u0: -0.04, u1: 0.3, v0: -0.34, v1: 0.16, z0: 0, h: f === 2 ? 1 : 0.62, mat: 1, glazing: f === 2 ? undefined : "garage" },
      ];
    case "cantilever":
      return [
        { u0: -0.42, u1: 0.08, v0: -0.34, v1: 0.18, z0: 0, h: 1, mat: 1, glazing: "full" },
        { u0: -0.3, u1: 0.34, v0: -0.42, v1: 0.22, z0: 1, h: 1, mat: 0, main: true },
      ];
    case "pavilion":
      return [{ u0: -0.36, u1: 0.22, v0: -0.36, v1: 0.18, z0: 0, h: 1, mat: 0, main: true, glazing: "full", overhang: 0.07 }];
    case "barn":
      return [{ u0: -0.44, u1: 0.3, v0: -0.26, v1: 0.08, z0: 0, h: f, mat: 0, main: true }];
    case "twin":
      return [
        { u0: -0.44, u1: -0.1, v0: -0.38, v1: 0.06, z0: 0, h: f, mat: 0, main: true },
        { u0: -0.1, u1: 0.0, v0: -0.3, v1: -0.08, z0: 0, h: 0.9, mat: 1, glazing: "full" },
        { u0: 0.0, u1: 0.3, v0: -0.42, v1: 0.0, z0: 0, h: f, mat: 1 },
      ];
  }
}

/** Floor height in screen pixels at scale 1. */
const FP = 5.5;

/**
 * Draw a cottage standing on the tile whose centre is (px, py).
 * tw/th are the tile's screen width and height.
 */
export function drawCottage(ctx: CanvasRenderingContext2D, px: number, py: number, c: Cottage, pal: CottagePalette, tw: number, th: number) {
  const hw = tw / 2;
  const hh = th / 2;
  const P = (u: number, v: number, z: number): [number, number] => [px + (u - v) * hw, py + (u + v) * hh - z];
  const poly = (pts: [number, number][], fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fill();
  };
  const flipBox = (b: Box): Box => (c.flip ? { ...b, u0: b.v0, u1: b.v1, v0: b.u0, v1: b.u1 } : b);
  const boxes = volumes(c).map(flipBox);
  const sw = (u0: number, u1: number, v0: number, v1: number) =>
    c.flip ? { u0: v0, u1: v1, v0: u0, v1: u1 } : { u0, u1, v0, v1 };
  const flat = (r: { u0: number; u1: number; v0: number; v1: number }, z: number, fill: string) =>
    poly([P(r.u0, r.v0, z), P(r.u1, r.v0, z), P(r.u1, r.v1, z), P(r.u0, r.v1, z)], fill);

  // garden: deck, pool and soft shadows on the ground
  if (c.deck) flat(sw(-0.36, 0.22, 0.24, 0.44), 0.4, pal.deck);
  if (c.pool) {
    flat(sw(0.3, 0.47, -0.36, 0.14), 0.4, pal.coping);
    flat(sw(0.33, 0.44, -0.33, 0.11), 0.6, pal.water);
  }
  for (const b of boxes) flat({ u0: b.u0 + 0.06, u1: b.u1 + 0.1, v0: b.v0 + 0.02, v1: b.v1 + 0.04 }, 0.2, pal.shadow);

  const order = [...boxes].sort((a, b) => a.u0 + a.u1 + a.v0 + a.v1 - (b.u0 + b.u1 + b.v0 + b.v1) || a.z0 - b.z0);
  for (const b of order) drawBox(b);

  if (c.shrubs) {
    const spots = c.pool ? [[0.42, 0.3], [0.16, 0.42]] : [[0.4, -0.2], [0.42, 0.22], [0.12, 0.42]];
    for (const [u, v] of spots) {
      const q = c.flip ? P(v, u, 0) : P(u, v, 0);
      ctx.fillStyle = pal.shrubDark;
      ctx.beginPath();
      ctx.arc(q[0], q[1] - 1.6, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pal.shrub;
      ctx.beginPath();
      ctx.arc(q[0] - 0.5, q[1] - 2.2, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBox(b: Box) {
    const zb = b.z0 * FP;
    const zt = (b.z0 + b.h) * FP;
    const main = b.main && (c.roof === "shed" || c.roof === "gable" || c.roof === "hip");
    const longU = b.u1 - b.u0 >= b.v1 - b.v0;
    // shed roofs rise towards the back along the short side
    const rise = c.form === "barn" ? (longU ? b.v1 - b.v0 : b.u1 - b.u0) * 15 : (longU ? b.v1 - b.v0 : b.u1 - b.u0) * 11;
    const top = (u: number, v: number) => {
      if (!(b.main && c.roof === "shed")) return zt;
      const t = longU ? (b.v1 - v) / (b.v1 - b.v0) : (b.u1 - u) / (b.u1 - b.u0);
      return zt + t * FP * 0.9;
    };
    const wl = b.mat ? pal.wall2L : pal.wallL;
    const wr = b.mat ? pal.wall2R : pal.wallR;
    // walls: left face is v = v1, right face is u = u1
    poly([P(b.u0, b.v1, zb), P(b.u1, b.v1, zb), P(b.u1, b.v1, top(b.u1, b.v1)), P(b.u0, b.v1, top(b.u0, b.v1))], wl);
    poly([P(b.u1, b.v1, zb), P(b.u1, b.v0, zb), P(b.u1, b.v0, top(b.u1, b.v0)), P(b.u1, b.v1, top(b.u1, b.v1))], wr);
    const glazing: Glazing = b.glazing ?? c.glazing;
    windows(b, "L", glazing);
    windows(b, "R", glazing);
    if (main) {
      if (c.roof === "shed") shedRoof(b, top);
      else if (c.roof === "gable") gableRoof(b, zt, longU, rise);
      else hipRoof(b, zt, longU, rise * 0.8);
    } else flatRoof(b, zt);
  }

  function flatRoof(b: Box, zt: number) {
    const o = b.overhang ?? 0;
    const r = { u0: b.u0 - o, u1: b.u1 + o, v0: b.v0 - o, v1: b.v1 + o };
    if (o) {
      // a thin slab edge
      poly([P(r.u0, r.v1, zt), P(r.u1, r.v1, zt), P(r.u1, r.v1, zt + 1.4), P(r.u0, r.v1, zt + 1.4)], pal.wall2L);
      poly([P(r.u1, r.v1, zt), P(r.u1, r.v0, zt), P(r.u1, r.v0, zt + 1.4), P(r.u1, r.v1, zt + 1.4)], pal.wall2R);
    }
    const z = zt + (o ? 1.4 : 0);
    flat(r, z, pal.parapet);
    const i = 0.035;
    const inner = { u0: r.u0 + i, u1: r.u1 - i, v0: r.v0 + i, v1: r.v1 - i };
    const green = b.main && c.roof === "green";
    flat(inner, z - 0.4, green ? pal.sedum : pal.membrane);
    if (green) {
      ctx.fillStyle = pal.sedumDot;
      for (let k = 0; k < 7; k++) {
        const s = (k * 0.37) % 1;
        const t = (k * 0.61 + 0.2) % 1;
        const q = P(inner.u0 + (inner.u1 - inner.u0) * s, inner.v0 + (inner.v1 - inner.v0) * t, z);
        ctx.fillRect(q[0] - 0.7, q[1] - 0.5, 1.4, 1);
      }
    }
    if (b.main && c.solar) panels(inner, () => z + 0.6);
  }

  function shedRoof(b: Box, top: (u: number, v: number) => number) {
    const pts: [number, number][] = [P(b.u0, b.v0, top(b.u0, b.v0)), P(b.u1, b.v0, top(b.u1, b.v0)), P(b.u1, b.v1, top(b.u1, b.v1)), P(b.u0, b.v1, top(b.u0, b.v1))];
    poly(pts, pal.roofT);
    // fascia along the low edge
    ctx.strokeStyle = pal.frame;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(pts[3][0], pts[3][1]);
    ctx.lineTo(pts[2][0], pts[2][1]);
    ctx.lineTo(pts[1][0], pts[1][1]);
    ctx.stroke();
    if (c.solar) panels({ u0: b.u0 + 0.05, u1: b.u1 - 0.05, v0: b.v0 + 0.05, v1: b.v1 - 0.05 }, (u, v) => top(u, v) + 0.5);
  }

  function gableRoof(b: Box, zt: number, longU: boolean, r: number) {
    if (longU) {
      const vm = (b.v0 + b.v1) / 2;
      poly([P(b.u0, b.v0, zt), P(b.u1, b.v0, zt), P(b.u1, vm, zt + r), P(b.u0, vm, zt + r)], pal.roofBack);
      poly([P(b.u0, b.v1, zt), P(b.u1, b.v1, zt), P(b.u1, vm, zt + r), P(b.u0, vm, zt + r)], pal.roofL);
      poly([P(b.u1, b.v0, zt), P(b.u1, b.v1, zt), P(b.u1, vm, zt + r)], b.mat ? pal.wall2R : pal.wallR);
      if (c.form === "barn") poly([P(b.u1, b.v0 + 0.06, zt), P(b.u1, b.v1 - 0.06, zt), P(b.u1, vm, zt + r - 2)], pal.glassR);
      if (c.chimney) chimney(b.u0 + 0.14, vm - 0.04, zt + r * 0.75, r);
    } else {
      const um = (b.u0 + b.u1) / 2;
      poly([P(b.u0, b.v0, zt), P(b.u0, b.v1, zt), P(um, b.v1, zt + r), P(um, b.v0, zt + r)], pal.roofBack);
      poly([P(b.u1, b.v0, zt), P(b.u1, b.v1, zt), P(um, b.v1, zt + r), P(um, b.v0, zt + r)], pal.roofR);
      poly([P(b.u0, b.v1, zt), P(b.u1, b.v1, zt), P(um, b.v1, zt + r)], b.mat ? pal.wall2L : pal.wallL);
      if (c.form === "barn") poly([P(b.u0 + 0.06, b.v1, zt), P(b.u1 - 0.06, b.v1, zt), P(um, b.v1, zt + r - 2)], pal.glassL);
      if (c.chimney) chimney(um - 0.04, b.v0 + 0.14, zt + r * 0.75, r);
    }
  }

  function hipRoof(b: Box, zt: number, longU: boolean, r: number) {
    const vm = (b.v0 + b.v1) / 2;
    const um = (b.u0 + b.u1) / 2;
    const d = longU ? (b.v1 - b.v0) / 2 : (b.u1 - b.u0) / 2;
    const R1 = longU ? P(b.u0 + d, vm, zt + r) : P(um, b.v0 + d, zt + r);
    const R2 = longU ? P(b.u1 - d, vm, zt + r) : P(um, b.v1 - d, zt + r);
    const c00 = P(b.u0, b.v0, zt);
    const c10 = P(b.u1, b.v0, zt);
    const c11 = P(b.u1, b.v1, zt);
    const c01 = P(b.u0, b.v1, zt);
    if (longU) {
      poly([c00, c10, R2, R1], pal.roofBack);
      poly([c00, c01, R1], pal.roofBack);
      poly([c01, c11, R2, R1], pal.roofL);
      poly([c10, c11, R2], pal.roofR);
    } else {
      poly([c00, c01, R2, R1], pal.roofBack);
      poly([c00, c10, R1], pal.roofBack);
      poly([c10, c11, R2, R1], pal.roofR);
      poly([c01, c11, R2], pal.roofL);
    }
    if (c.chimney) chimney(longU ? b.u0 + d + 0.04 : um + 0.06, longU ? vm + 0.06 : b.v0 + d + 0.04, zt + r * 0.6, r);
  }

  function chimney(u: number, v: number, z0: number, r: number) {
    const s = 0.045;
    const z1 = z0 + r * 0.35 + 2;
    poly([P(u - s, v + s, z0), P(u + s, v + s, z0), P(u + s, v + s, z1), P(u - s, v + s, z1)], pal.wall2L);
    poly([P(u + s, v + s, z0), P(u + s, v - s, z0), P(u + s, v - s, z1), P(u + s, v + s, z1)], pal.wall2R);
    poly([P(u - s, v - s, z1), P(u + s, v - s, z1), P(u + s, v + s, z1), P(u - s, v + s, z1)], pal.frame);
  }

  function panels(r: { u0: number; u1: number; v0: number; v1: number }, z: (u: number, v: number) => number) {
    const n = 3;
    for (let k = 0; k < n; k++) {
      const a = r.u0 + ((r.u1 - r.u0) * (k + 0.15)) / n;
      const e = r.u0 + ((r.u1 - r.u0) * (k + 0.85)) / n;
      const v0 = r.v0 + (r.v1 - r.v0) * 0.15;
      const v1 = r.v0 + (r.v1 - r.v0) * 0.75;
      poly([P(a, v0, z(a, v0)), P(e, v0, z(e, v0)), P(e, v1, z(e, v1)), P(a, v1, z(a, v1))], pal.solar);
    }
  }

  /** Glass on one visible face of a box, floor by floor. */
  function windows(b: Box, face: "L" | "R", glazing: Glazing) {
    // face L runs along u at v = v1; face R runs along v at u = u1 (drawn from v1 to v0)
    const len = face === "L" ? b.u1 - b.u0 : b.v1 - b.v0;
    const at = (s: number, z: number) => (face === "L" ? P(b.u0 + len * s, b.v1, z) : P(b.u1, b.v1 - len * s, z));
    const pane = (s0: number, s1: number, z0: number, z1: number) =>
      poly([at(s0, z0), at(s1, z0), at(s1, z1), at(s0, z1)], face === "L" ? pal.glassL : pal.glassR);
    const mullion = (s: number, z0: number, z1: number) => {
      const a = at(s, z0);
      const e = at(s, z1);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(e[0], e[1]);
    };
    ctx.strokeStyle = pal.frame;
    ctx.lineWidth = 0.4;
    const floors = Math.max(1, Math.floor(b.h + 0.01));
    if (glazing === "garage") {
      // the garage door faces the drive on one side, a small window on the other
      if (face === "R") {
        poly([at(0.2, b.z0 * FP), at(0.8, b.z0 * FP), at(0.8, (b.z0 + b.h * 0.78) * FP), at(0.2, (b.z0 + b.h * 0.78) * FP)], pal.frame);
      } else pane(0.35, 0.6, (b.z0 + 0.3) * FP, (b.z0 + 0.55) * FP);
      return;
    }
    for (let f = 0; f < floors; f++) {
      const z = (b.z0 + f) * FP;
      const zH = Math.min(b.h, 1) * FP;
      switch (glazing) {
        case "full": {
          pane(0.04, 0.96, z + 0.4, z + zH - 0.5);
          ctx.beginPath();
          const n = Math.max(2, Math.round(len / 0.12));
          for (let k = 1; k < n; k++) mullion(0.04 + (0.92 * k) / n, z + 0.4, z + zH - 0.5);
          ctx.stroke();
          break;
        }
        case "band":
          pane(0.1, 0.9, z + zH * 0.35, z + zH * 0.78);
          break;
        case "panes": {
          const n = Math.max(2, Math.round(len / 0.2));
          for (let k = 0; k < n; k++) pane((k + 0.22) / n, (k + 0.78) / n, z + zH * 0.12, z + zH * 0.86);
          break;
        }
        case "corner":
          // floor-to-ceiling glass wrapping the front corner, one small window further back
          pane(face === "L" ? 0.55 : 0, face === "L" ? 1 : 0.45, z + zH * 0.08, z + zH * 0.9);
          pane(face === "L" ? 0.12 : 0.62, face === "L" ? 0.3 : 0.84, z + zH * 0.4, z + zH * 0.76);
          break;
        case "slits": {
          const n = Math.max(3, Math.round(len / 0.1));
          for (let k = 0; k < n; k++) if ((k + f) % 2 === 0) pane((k + 0.35) / n, (k + 0.65) / n, z + zH * 0.12, z + zH * 0.88);
          break;
        }
      }
    }
  }
}
