import { describe, expect, it } from "vitest";
import { generateWorld } from "./generator";
import { landmarkFor, SECOND_TOWER, towerOnPlot } from "./landmarks";

const world = generateWorld();

describe("landmarks", () => {
  it("stands the Second Light Tower on 13 Velvet Highway in First Light City, by the lake", () => {
    const plot = world.plots[SECOND_TOWER.plotId];
    expect(plot.address).toBe(SECOND_TOWER.address);
    expect(world.districts[plot.district].name).toBe("First Light City");
    const b = landmarkFor(world, plot.id)!;
    expect(b.tower!.name).toBe("Second Light Tower");
    expect(Math.max(...b.tower!.heights)).toBe(SECOND_TOWER.floors);
    expect(SECOND_TOWER.floors).toBeGreaterThan(108);
    expect(towerOnPlot(world, plot.id)).toBe("second-light");
    expect(landmarkFor(world, plot.id + 1)).toBeUndefined();
  });
});
