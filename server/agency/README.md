# First Light Realty, sales to the state, harvest barter

Rules: `agency.sql` (one-off migration, safe to run again; run after build, roads, heritage, orbit and farm).
Test: `PGHOST=/var/tmp/pg PGPORT=5433 python3 server/agency/test_agency.py`.

n8n **[74 PUBLIC] AquaTerra Agency**, `POST /webhook/aquaterra-agency`
(list | mine | appraise | sell_state | list_add | list_cancel | buy | barter | barter_offer | barter_take | barter_cancel):
webhook → Code node `validate.js` → Postgres `SELECT aquaterra_agency($1::jsonb)` → respond.

- **Sale to the state** (tax valuation): land `state_buy_pct` (70) % of min(price paid, registry price), a building
  `sell_back_pct` (50) % of what was invested, minus `sales_tax_pct` to the State Treasury. The AquaTerra Reserve pays,
  the plot returns to the registry, the building is taken down. Only after `state_buy_hold_days` (7); not while pledged,
  at auction, farmed, or with unpaid land tax.
- **First Light Realty**: listings of plots (with houses, water plots, Heritage islands), roads, tower apartments, Orbit
  planets, AI companions. Seller pays `agency_fee_pct` (3.6) % to `state:agency` (First Light Realty) and `sales_tax_pct`
  to the State Treasury; buyer pays the price (free Tide only) and, for land, `deal_duty_pct`. A resold plot earns
  income on min(price, registry price). Buyer limits: `max_plots_per_citizen`, `road_max_per_citizen`.
- **Harvest barter**: crop for crop; each side pays `barter_tax_pct` (5) % of the Reserve value it receives (min 1 TIDE).
