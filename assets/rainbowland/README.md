# Rainbowland map

`Aquaterra Map V.2.tmx` is the founder's map of Rainbowland, made in Tiled: 640 x 640 cells from
(-128, -128), the same coordinates as the LAND tokens, so map cell (x, y) is LAND (x, y).
Tiles: Kenney "Roguelike pack" (`public/rainbowland/roguelike.png`, CC0, kenney.nl).

After editing the map, run `node scripts/import-rainbow-map.mjs` and commit `public/rainbowland/map.json`.
New ground tiles that should be zones go into the ZONES list of that script.
