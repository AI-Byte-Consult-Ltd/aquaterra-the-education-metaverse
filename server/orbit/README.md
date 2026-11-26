# Orbit: the sky layer

Rules: `orbit.sql` (one-off migration, safe to run again; run after `server/heritage/heritage.sql`).
Test: `PGHOST=/var/tmp/pg PGPORT=5433 python3 server/orbit/test_orbit.py`.

n8n **[72 PUBLIC] AquaTerra Orbit**, `POST /webhook/aquaterra-orbit` (sky | body | me | mine | sell):
webhook → Code node `validate.js` → Postgres `SELECT aquaterra_orbit($1::jsonb)` → respond.

The 10,000 Milky Way Marvels NFTs (Cronos `0xf37a3686…a4`, tokens 0..9999, metadata
`ipfs://QmU84ZgnJiDwJ2cBXhabJjRnbLkpRfJYGq3HLAdjKdcN4W/<id>`: Type, Resource, Rarity, Main Planet, Name)
are loaded once into `aquaterra_planets` by a temporary n8n loader calling `aquaterra_planet_load(rows)`.
They come home through the Heritage Port (collection kind `planet`, choice `planet`).
Mining: once a UTC day per claim, `orbit_mine_units` × rarity factor. Selling: base price × `orbit_price_pct`,
paid by the AquaTerra Reserve as kind `income` (income tax and loan repayments by the treasury trigger).
