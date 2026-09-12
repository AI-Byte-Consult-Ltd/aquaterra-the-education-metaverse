// Loads the real Aquaterra world art -- converted from the team's Tiled
// (.tmx) map by scripts/tmx-to-grid.mjs -- as a flat tile-id grid plus the
// tileset metadata needed to slice the spritesheet. This is a purely visual
// layer: ownership/economy data in landMap.ts is generated independently and
// shares the same (wx, wy) coordinate space by construction (both are
// 0..639), so no offset math is needed to line them up.

export interface TileManifest {
  grid: { width: number; height: number; originTileX: number; originTileY: number };
  tileset: {
    name: string;
    tileWidth: number;
    tileHeight: number;
    spacing: number;
    tileCount: number;
    columns: number;
    imageWidth: number;
    imageHeight: number;
    imageSourceHint: string;
    webImagePath: string;
  };
}

export interface UnpackedTile {
  localId: number;
  flipH: boolean;
  flipV: boolean;
  flipD: boolean;
}

// 0 in the low 11 bits means "no tile" (raw gid 0) -- a real local tile id 0
// is itself a drawable tile (gid == firstgid), so ids are stored shifted by
// +1 to keep it distinguishable. See scripts/tmx-to-grid.mjs.
export function unpackTile(packed: number): UnpackedTile {
  return {
    localId: (packed & 0x7ff) - 1,
    flipH: (packed & 0x800) !== 0,
    flipV: (packed & 0x1000) !== 0,
    flipD: (packed & 0x2000) !== 0,
  };
}

export function isEmptyTile(packed: number): boolean {
  return (packed & 0x7ff) === 0;
}

export interface LoadedTileMap {
  manifest: TileManifest;
  grid: Uint16Array;
  image: HTMLImageElement | null; // null until the real spritesheet PNG is dropped into public/tiles/
  // A 1px-per-tile overview (640x640) for zoomed-out rendering. Point-sampling
  // one tile per screen block at high zoom-out ratios aliases badly on this
  // art (tight repeating patterns -- fences, crop rows -- turn into stripes),
  // so this pre-averages every tile's color once instead.
  overview: HTMLCanvasElement | null;
}

let cached: Promise<LoadedTileMap> | null = null;

// Average color of one source tile, found by letting the browser's own
// bilinear filtering downsample the tile region to a single pixel.
function averageTileColor(image: HTMLImageElement, sx: number, sy: number, tw: number, th: number, sampler: CanvasRenderingContext2D): [number, number, number, number] {
  sampler.clearRect(0, 0, 1, 1);
  sampler.drawImage(image, sx, sy, tw, th, 0, 0, 1, 1);
  const d = sampler.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

function buildOverview(manifest: TileManifest, grid: Uint16Array, image: HTMLImageElement): HTMLCanvasElement {
  const { tileWidth, tileHeight, spacing, columns } = manifest.tileset;
  const { width: gridW, height: gridH } = manifest.grid;

  const samplerCanvas = document.createElement("canvas");
  samplerCanvas.width = 1;
  samplerCanvas.height = 1;
  const sampler = samplerCanvas.getContext("2d", { willReadFrequently: true })!;
  sampler.imageSmoothingEnabled = true;

  const colorCache = new Map<number, [number, number, number, number]>();
  const colorFor = (localId: number) => {
    let c = colorCache.get(localId);
    if (!c) {
      const col = localId % columns;
      const row = Math.floor(localId / columns);
      c = averageTileColor(image, col * (tileWidth + spacing), row * (tileHeight + spacing), tileWidth, tileHeight, sampler);
      colorCache.set(localId, c);
    }
    return c;
  };

  const pixels = new Uint8ClampedArray(gridW * gridH * 4);
  for (let i = 0; i < gridW * gridH; i++) {
    const packed = grid[i];
    if (isEmptyTile(packed)) continue;
    const { localId } = unpackTile(packed);
    const [r, g, b, a] = colorFor(localId);
    const o = i * 4;
    pixels[o] = r;
    pixels[o + 1] = g;
    pixels[o + 2] = b;
    pixels[o + 3] = a;
  }

  const overview = document.createElement("canvas");
  overview.width = gridW;
  overview.height = gridH;
  overview.getContext("2d")!.putImageData(new ImageData(pixels, gridW, gridH), 0, 0);
  return overview;
}

export function loadTileMap(): Promise<LoadedTileMap> {
  if (cached) return cached;
  cached = (async () => {
    const [manifest, binResp] = await Promise.all([
      fetch("/tiles/aquaterra-grid.json").then((r) => r.json() as Promise<TileManifest>),
      fetch("/tiles/aquaterra-grid.bin").then((r) => r.arrayBuffer()),
    ]);
    const grid = new Uint16Array(binResp);

    const image = await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null); // tileset PNG not present yet -- caller falls back to a placeholder render
      img.src = manifest.tileset.webImagePath;
    });

    const overview = image ? buildOverview(manifest, grid, image) : null;

    return { manifest, grid, image, overview };
  })();
  return cached;
}
