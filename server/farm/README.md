# Farms and the Harvest Market

Rules: `farm.sql` (one-off migration, safe to run again; run after `server/build/build.sql` and the treasury).
Test: `PGHOST=/var/tmp/pg PGPORT=5433 python3 server/farm/test_farm.py`.

n8n **[73 PUBLIC] AquaTerra Farm**, `POST /webhook/aquaterra-farm`
(market | book | me | plant | harvest | clear | reserve | order | cancel):
webhook → Code node `validate.js` → Postgres `SELECT aquaterra_farm($1::jsonb)` → respond.

- 15 crops in `aquaterra_crops` (flowers, fruit, vegetables, wheat, tea, coffee). A field covers the whole plot:
  seed `seed_per_tile × tiles` (min 1) to the Reserve, yield `yield_per_tile × tiles` after `hours`.
  Ripe for longer than `farm_wilt_hours` → half. A building on the field destroys it.
- Reserve buys at `price × farm_price_pct` as kind `income` (income tax), at most `farm_reserve_cap` Tide a day per resident.
- Harvest Market: limit orders, matched at the resting price; buy orders hold Tide in `farm:escrow`;
  the seller pays `farm_market_tax_pct` (10) to `state:treasury`. No trades with yourself.
