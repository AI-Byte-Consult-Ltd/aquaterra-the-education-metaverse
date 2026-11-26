import { describe, expect, it } from "vitest";
import { AVATAR_STYLES, isStyle, spread } from "./avatars";
import { avatarOf } from "./api";

describe("avatars", () => {
  it("knows its styles, the same list as the server", () => {
    expect(AVATAR_STYLES).toEqual(["drop", "explorer", "builder", "sailor", "scholar", "pilot", "diver", "robot", "astronaut", "wisp"]);
    expect(isStyle("robot")).toBe(true);
    expect(isStyle("dragon")).toBe(false);
  });
  it("shows a resident without an avatar as the drop in their colour", () => {
    expect(avatarOf(null, 205)).toEqual({ style: "drop", hue: 205 });
    expect(avatarOf({ style: "pilot", hue: null }, 140)).toEqual({ style: "pilot", hue: 140 });
  });
  it("sets residents of one spot side by side, a lone one on its tile", () => {
    const one = spread([{ key: "a", x: 10, y: 10 }]);
    expect(one[0]).toMatchObject({ fx: 10.5, fy: 10.5 });
    const crowd = spread(Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, x: 50, y: 50 })));
    const spots = new Set(crowd.map((c) => `${c.fx.toFixed(2)},${c.fy.toFixed(2)}`));
    expect(spots.size).toBe(12);
    for (const c of crowd) expect(Math.hypot(c.fx - 50.5, c.fy - 50.5)).toBeLessThan(4);
  });
});
