/**
 * Prism Hills: the continent of the LAND NFTs on Polygon ("The Rainbowland", symbol LAND,
 * 0x1e0b16b9a4c072fc81e015a3757f6685edb1ccda, 90,000 tokens numbered 1..90000).
 * Their metadata holds no coordinates and no rarity, so the continent is a new grid of its
 * own beside Rainbowland, never overlapping the Cronos LAND: token t is Parcel (x, y) with
 * x = (t - 1) mod 300 and y = floor((t - 1) / 300). Hills and a ragged harbour, no houses.
 * A plot is small, 1 to 3 cells, fixed by the token number. Server: server/rainbowland/prism.sql.
 * Nothing here is ever renumbered.
 */
export const PRISM_CONTRACT = "0x1e0b16b9a4c072fc81e015a3757f6685edb1ccda";
export const PRISM_COLS = 300;
export const PRISM_ROWS = 300;
export const PRISM_TOTAL = 90_000;
/** Plot ids of Prism Hills: 3,000,000 + token id. */
export const PRISM_PLOT_BASE = 3_000_000;
export const PRISM_DISTRICT = 1001;
export const PRISM_NAME = "Prism Hills";

export const prismX = (t: number) => (t - 1) % PRISM_COLS;
export const prismY = (t: number) => Math.floor((t - 1) / PRISM_COLS);
export const prismAt = (x: number, y: number): number | null =>
  x >= 0 && x < PRISM_COLS && y >= 0 && y < PRISM_ROWS ? y * PRISM_COLS + x + 1 : null;
export const parcelName = (t: number) => `Parcel (${prismX(t)}, ${prismY(t)})`;
export const prismAddress = (t: number) => `${parcelName(t)}, ${PRISM_NAME}`;

/** Plot size of a token, 1..3 cells: about 60% one cell, 30% two, 10% three. Same rule as aquaterra_prism_size(). */
export function prismSize(t: number): 1 | 2 | 3 {
  const h = ((t * 2654435761) % 4294967296) % 100;
  return h < 60 ? 1 : h < 90 ? 2 : 3;
}
/** Plot value per cell of land, in Tide (income is the usual daily share of it). */
export const PRISM_PRICE_PER_CELL = 200;

/** Parses "Parcel (12, 40)", "12, 40" or a token number "#5601" / "5601". */
export function parsePrism(q: string): number | null {
  const s = q.trim();
  const xy = s.match(/(\d+)\s*[, ]\s*(\d+)/);
  if (xy) return prismAt(Number(xy[1]), Number(xy[2]));
  const id = s.match(/^#?(\d{1,6})$/);
  if (id) {
    const t = Number(id[1]);
    return t >= 1 && t <= PRISM_TOTAL ? t : null;
  }
  return null;
}
