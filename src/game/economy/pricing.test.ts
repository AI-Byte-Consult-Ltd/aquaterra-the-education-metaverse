import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD, generateWorld } from "@/game/world/generator";
import { MIN_PRICE, landRegistry, plotPrice } from "./pricing";
import { dailyIncome, transferFee } from "./api";

const world = generateWorld(DEFAULT_WORLD);

describe("land prices", () => {
  it("prices every plot in whole tens of TIDE, never below the minimum", () => {
    for (const p of world.plots) {
      const price = plotPrice(world, p);
      expect(price).toBeGreaterThanOrEqual(MIN_PRICE);
      expect(price % 10).toBe(0);
    }
  });

  it("lets a new resident afford a typical plot with the welcome coins", () => {
    const prices = world.plots.map((p) => plotPrice(world, p)).sort((a, b) => a - b);
    expect(prices[Math.floor(prices.length / 2)]).toBeLessThanOrEqual(1000);
  });

  it("registry ids run 0..n-1 so new lands are appended after the old ones", () => {
    const rows = landRegistry(world);
    rows.forEach(([id], i) => expect(id).toBe(i));
    expect(new Set(rows.map((r) => r[1])).size).toBe(rows.length);
  });
});

describe("fees and income", () => {
  it("matches the server rules", () => {
    expect(transferFee(100, 100)).toBe(1);
    expect(transferFee(5, 100)).toBe(1);
    expect(transferFee(1000, 100)).toBe(10);
    expect(transferFee(1000, 0)).toBe(0);
    expect(dailyIncome(720)).toBe(7);
  });
});
