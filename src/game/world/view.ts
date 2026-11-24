/**
 * Camera rotation of the isometric map in 90° steps.
 *
 * The world itself never changes: plots, districts and addresses keep their
 * tile coordinates. Rotation only maps a world tile to the "view" tile the
 * renderer draws it at, so the map can be looked at from four sides.
 */
export type Rotation = 0 | 1 | 2 | 3;

/** A point of the world plane (tile units, 0..n) in view coordinates. */
export function toViewPoint(fx: number, fy: number, n: number, r: Rotation): [number, number] {
  switch (r) {
    case 0:
      return [fx, fy];
    case 1:
      return [n - fy, fx];
    case 2:
      return [n - fx, n - fy];
    case 3:
      return [fy, n - fx];
  }
}

/** World tile → view tile. */
export function toView(x: number, y: number, n: number, r: Rotation): [number, number] {
  const [vx, vy] = toViewPoint(x + 0.5, y + 0.5, n, r);
  return [Math.floor(vx), Math.floor(vy)];
}

/** View tile → world tile. */
export function fromView(vx: number, vy: number, n: number, r: Rotation): [number, number] {
  return toView(vx, vy, n, ((4 - r) % 4) as Rotation);
}

/** Lookup tables between view and world tile indices for one rotation. */
export function viewMaps(n: number, r: Rotation) {
  const toWorld = new Int32Array(n * n);
  const toViewIdx = new Int32Array(n * n);
  for (let vy = 0; vy < n; vy++)
    for (let vx = 0; vx < n; vx++) {
      const [x, y] = fromView(vx, vy, n, r);
      toWorld[vy * n + vx] = y * n + x;
      toViewIdx[y * n + x] = vy * n + vx;
    }
  return { toWorld, toView: toViewIdx };
}

/** Rotation after turning one step; +1 turns the map clockwise on screen. */
export const turn = (r: Rotation, dir: 1 | -1): Rotation => ((r + dir + 4) % 4) as Rotation;

/**
 * Screen-space matrix [a, b, c, d] (x' = a·x + c·y, y' = b·x + d·y) that turns the
 * ground of an isometric view by `phi` radians around the screen centre.
 * Used to animate a 90° turn between two rendered views.
 */
export function groundTurnMatrix(phi: number, tw: number, th: number): [number, number, number, number] {
  // iso projection M = [[tw/2, -tw/2], [th/2, th/2]]; result = M · R(phi) · M⁻¹
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const m = [tw / 2, -tw / 2, th / 2, th / 2]; // row-major m00 m01 m10 m11
  const det = m[0] * m[3] - m[1] * m[2];
  const inv = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
  const r = [cos, -sin, sin, cos];
  const mul = (p: number[], q: number[]) => [
    p[0] * q[0] + p[1] * q[2],
    p[0] * q[1] + p[1] * q[3],
    p[2] * q[0] + p[3] * q[2],
    p[2] * q[1] + p[3] * q[3],
  ];
  const a = mul(mul(m, r), inv);
  return [a[0], a[2], a[1], a[3]];
}
