# City orders and workforce

Rules: `city.sql` (one-off migration, safe to run again; run after farm and industry).
Test: `PGHOST=/var/tmp/pg PGPORT=5433 python3 server/city/test_city.py`.

Same webhook as farms (n8n **[73 PUBLIC] AquaTerra Farm**): `aquaterra_farm()` hands `city | deliver` to `aquaterra_city()`.

- Workforce: homes house NPC residents (starter house, cottage, skyscraper by height, laws `workforce_*`); companies and
  fields have jobs (`aquaterra_city_jobs`). Output = `workforce_base_pct` + the rest times people/jobs. Industry applies it
  in `aquaterra_ind_per_day`, farms at harvest (`aquaterra_farm_staff`, 1 while the city is not installed).
- City orders: each UTC day NICS AI posts `city_orders_day` orders (land crop, material, raw, sea crop), goods made last
  week first. Pay = Reserve price × `city_order_bonus_pct`, from the Reserve as income (10% tax). Limits:
  `city_order_share_pct` of an order per resident, `city_order_cap` TIDE a day, `city_orders_pot` for the whole day.
