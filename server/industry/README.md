# Industry: companies on plots, resources and building materials

Rules: `industry.sql` (one-off migration, safe to run again; run after build, farm and orbit).
Test: `PGHOST=/var/tmp/pg PGPORT=5433 python3 server/industry/test_industry.py`.

Same webhook as farms (n8n **[73 PUBLIC] AquaTerra Farm**): `aquaterra_farm()` hands the actions
`works | setup | produce | dismantle | ship` to `aquaterra_industry()`.

- 14 company types in `aquaterra_works_types`: extraction (timber, clay, stone, sand, iron, copper, gold, oil on land,
  oil rigs on water) by biome deposits in `aquaterra_geology`, and works (bricks, steel, glass, concrete, building materials)
  that take inputs from the storehouse. Output piles up for `industry_cap_hours`.
- Goods are rows of `aquaterra_crops` with `source` industry or orbit: same storehouse, Reserve cap, market, tax and barter.
- Building (`build.sql` hooks `aquaterra_build_materials` / `aquaterra_build_salvage`): recipe per 100 TIDE of cost in
  `aquaterra_build_recipe`; own materials are used first and their depot value is not charged; demolish returns
  `industry_salvage_pct` of what is in the building.
