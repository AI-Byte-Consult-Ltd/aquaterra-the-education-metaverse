/**
 * The map of Rainbowland drawn by the founder in Tiled (assets/rainbowland/*.tmx), imported by
 * scripts/import-rainbow-map.mjs into public/rainbowland/map.json: 640 x 640 cells from
 * (-128, -128), the coordinates of the LAND tokens, with the Kenney roguelike tiles
 * (public/rainbowland/roguelike.png) and the zones of the map.
 */
export interface MapZone {
  name: string;
  gid: number;
  cells: number;
  /** Label cell: image column and row. */
  c: number;
  r: number;
  /** Average colour of its ground tile. */
  color: [number, number, number];
}
export interface Terrain {
  w: number;
  h: number;
  tile: number;
  spacing: number;
  columns: number;
  gids: number[];
  /** Palette index per cell, row by row. */
  cells: Uint8Array;
  /** Average colour per palette index. */
  colors: [number, number, number][];
  /** 0 = open water, i + 1 = zones[i]. */
  zone: Uint8Array;
  zones: MapZone[];
  sheet: HTMLImageElement | null;
}

const unrle = (b64: string, size: number) => {
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const out = new Uint8Array(size);
  let o = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    out.fill(bytes[i], o, o + bytes[i + 1]);
    o += bytes[i + 1];
  }
  return out;
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>((ok) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = src;
  });

let cached: Promise<Terrain | null> | null = null;
export function loadTerrain(): Promise<Terrain | null> {
  if (cached) return cached;
  const base = import.meta.env.BASE_URL ?? "/";
  cached = (async () => {
    try {
      const [res, sheet] = await Promise.all([fetch(`${base}rainbowland/map.json`), loadImage(`${base}rainbowland/roguelike.png`)]);
      const j = await res.json();
      const size = j.w * j.h;
      // average colour of each tile, read from the tile sheet
      const colors: [number, number, number][] = j.gids.map(() => [120, 170, 110]);
      if (sheet) {
        const cv = document.createElement("canvas");
        cv.width = j.tile;
        cv.height = j.tile;
        const g = cv.getContext("2d", { willReadFrequently: true })!;
        j.gids.forEach((gid: number, i: number) => {
          if (!gid) return;
          const k = gid - 1;
          g.clearRect(0, 0, j.tile, j.tile);
          g.drawImage(sheet, (k % j.columns) * (j.tile + j.spacing), Math.floor(k / j.columns) * (j.tile + j.spacing), j.tile, j.tile, 0, 0, j.tile, j.tile);
          const d = g.getImageData(0, 0, j.tile, j.tile).data;
          let r = 0, gg = 0, b = 0, n = 0;
          for (let p = 0; p < d.length; p += 4) if (d[p + 3] > 0) { r += d[p]; gg += d[p + 1]; b += d[p + 2]; n++; }
          if (n) colors[i] = [Math.round(r / n), Math.round(gg / n), Math.round(b / n)];
        });
      }
      const zones: MapZone[] = j.zones.map((z: Omit<MapZone, "color">) => ({ ...z, color: colors[j.gids.indexOf(z.gid)] }));
      return { w: j.w, h: j.h, tile: j.tile, spacing: j.spacing, columns: j.columns, gids: j.gids, cells: unrle(j.rle, size), colors, zone: unrle(j.zoneRle, size), zones, sheet };
    } catch {
      cached = null;
      return null;
    }
  })();
  return cached;
}

/** Zone of an image cell, or null for open water. */
export const zoneAtCell = (t: Terrain, c: number, r: number): MapZone | null => t.zones[t.zone[r * t.w + c] - 1] ?? null;
