/**
 * Rainbowland: the continent of the old LAND NFTs ("The Rainbowland" on Cronos,
 * 0x3ff260ce7a8dfcadaf5e880137ee1750ceae9889, 55,524 tokens).
 *
 * The grid is the old one, kept exactly: token id t is LAND (x, y) with
 * x = t mod 640 - 128 and y = floor(t / 640) - 128, as in each token's name.
 * A cell stays fog until its LAND comes home through the Heritage Port; then it
 * becomes a plot at the same address, "LAND (x, y), Rainbowland".
 * Server: server/rainbowland/rainbowland.sql. Nothing here is ever renumbered.
 */
export const RAINBOW_CONTRACT = "0x3ff260ce7a8dfcadaf5e880137ee1750ceae9889";
export const COLS = 640;
export const TOTAL = 55_524;
export const ROWS = Math.ceil(TOTAL / COLS); // 87, the last row is partly minted
export const X0 = -128;
export const Y0 = -128;
/** Plot ids of Rainbowland: 1,000,000 + token id, far from the generated world. */
export const PLOT_BASE = 1_000_000;
/** District id of Rainbowland for the state and the transport network. */
export const RAINBOW_DISTRICT = 1000;
export const RAINBOW_NAME = "Rainbowland";

export const tokenX = (t: number) => (t % COLS) + X0;
export const tokenY = (t: number) => Math.floor(t / COLS) + Y0;
export const tokenAt = (x: number, y: number): number | null => {
  const c = x - X0;
  const r = y - Y0;
  if (c < 0 || c >= COLS || r < 0) return null;
  const t = r * COLS + c;
  return t < TOTAL ? t : null;
};
export const landName = (t: number) => `LAND (${tokenX(t)}, ${tokenY(t)})`;
export const plotAddress = (t: number) => `${landName(t)}, ${RAINBOW_NAME}`;

/** Parses "LAND (12, -40)", "12, -40", "12 -40" or a token number "#5601" / "5601". */
export function parseCell(q: string): number | null {
  const s = q.trim();
  const xy = s.match(/(-?\d+)\s*[, ]\s*(-?\d+)/);
  if (xy) return tokenAt(Number(xy[1]), Number(xy[2]));
  const id = s.match(/^#?(\d{1,6})$/);
  if (id) {
    const t = Number(id[1]);
    return t < TOTAL ? t : null;
  }
  return null;
}

export type Tier = "common" | "rare" | "epic" | "legendary" | "cyber";
export const TIERS: Tier[] = ["common", "rare", "epic", "legendary", "cyber"];
export const TIER_OF_CODE: Record<string, Tier | undefined> = { c: "common", r: "rare", e: "epic", l: "legendary", x: "cyber" };

/** Colours of the tiers, used for owned plots and the shimmer of rare land under the fog. */
export const TIER_COLOR: Record<Tier, [number, number, number]> = {
  common: [214, 226, 204],
  rare: [92, 200, 255],
  epic: [178, 112, 255],
  legendary: [255, 196, 64],
  cyber: [255, 46, 214],
};
