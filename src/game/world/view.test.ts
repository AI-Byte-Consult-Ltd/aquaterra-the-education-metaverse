import { describe, expect, it } from "vitest";
import { fromView, groundTurnMatrix, toView, toViewPoint, turn, viewMaps, type Rotation } from "./view";

const N = 440;
const ROTS: Rotation[] = [0, 1, 2, 3];

describe("map rotation", () => {
  it("maps every tile to a distinct view tile and back", () => {
    for (const r of ROTS) {
      const { toWorld, toView: tv } = viewMaps(N, r);
      const seen = new Uint8Array(N * N);
      for (let i = 0; i < N * N; i++) {
        expect(toWorld[tv[i]]).toBe(i);
        seen[tv[i]] = 1;
      }
      expect(seen.every((v) => v === 1)).toBe(true);
    }
  });

  it("rotation 0 is the original map", () => {
    expect(toView(12, 345, N, 0)).toEqual([12, 345]);
  });

  it("four turns come back to the start", () => {
    let r: Rotation = 0;
    for (let k = 0; k < 4; k++) r = turn(r, 1);
    expect(r).toBe(0);
    expect(turn(0, -1)).toBe(3);
  });

  it("one clockwise turn equals the next rotation", () => {
    for (const r of ROTS) {
      const [fx, fy] = toViewPoint(100.3, 17.8, N, r);
      const once = toViewPoint(fx, fy, N, 1);
      const next = toViewPoint(100.3, 17.8, N, turn(r, 1));
      expect(once[0]).toBeCloseTo(next[0]);
      expect(once[1]).toBeCloseTo(next[1]);
      const [x, y] = toView(7, 300, N, r);
      expect(fromView(x, y, N, r)).toEqual([7, 300]);
    }
  });

  it("a 90° ground turn lines the old view up with the new one", () => {
    // view direction of the tile x axis on screen
    const iso = (x: number, y: number) => [((x - y) * 32) / 2, ((x + y) * 16) / 2];
    const [a, b, c, d] = groundTurnMatrix(Math.PI / 2, 32, 16);
    const [sx, sy] = iso(1, 0); // screen vector of one tile along x
    const turned = [a * sx + c * sy, b * sx + d * sy];
    // after one clockwise turn, old +x points along new +y
    const expected = iso(0, 1);
    expect(turned[0]).toBeCloseTo(expected[0]);
    expect(turned[1]).toBeCloseTo(expected[1]);
  });
});
