-- AquaTerra: industry. Companies on plots extract resources and make building materials.
-- One-off migration (never per request). Safe to run again.
-- Needs: economy, governance (districts, laws), arcade (pay helpers), treasury, build, farm (storehouse and market), orbit.
-- n8n quirks: no double-dollar quotes (use $fn$), no positional parameters in the text,
-- no dollar sign right before a quote, no apostrophes in comments.
--
--  * An owner sets up one company on a whole plot for Tide (to the Reserve, plus the building permit fee to
--    the State Treasury). It works on its own, around the clock: output piles up for at most
--    industry_cap_hours, then the company waits for its owner to collect.
--  * Extraction (timber, clay, stone, sand, iron, copper, gold, oil) depends on the ground: every biome has its
--    deposits (aquaterra_geology), each plot is a little richer or poorer (0.8 to 1.2), mountains are rich in rock.
--    Oil rigs stand on water plots. Processing works (bricks, steel, glass, concrete, building materials) take
--    their inputs from the storehouse when the owner collects; the Forgeworks district works faster.
--  * Everything lands in the same storehouse as the harvest (aquaterra_farm_barn) and trades on the same market
--    (limit orders, 10 percent seller tax to the State Treasury), sells to the Reserve under the same daily cap,
--    and can be bartered. Orbit claims ship their mined goods down to the storehouse as well.
--  * Building (server/build/build.sql) needs materials: a recipe per 100 Tide of the construction cost. What the
--    owner has in the storehouse is used first and that part of the cost is not charged (at depot price); the
--    rest is bought at the Builder Depot inside the price, so nobody is blocked. Demolishing returns
--    industry_salvage_pct of the materials in the building (a starter house of the map gives
--    industry_starter_salvage_pct of a cottage). Selling a building to the Reserve leaves the materials in it.
--  * Balance: about 0.5 Tide a tile a day at the Reserve price for a normal deposit, like a farm.

INSERT INTO aquaterra_crops (key, grp, hours, seed_per_tile, yield_per_tile, price, sort, water, source) VALUES
  ('wood', 'raw', 1, 0, 0, 0.50, 100, false, 'industry'),
  ('clay', 'raw', 1, 0, 0, 0.30, 101, false, 'industry'),
  ('stone', 'raw', 1, 0, 0, 0.40, 102, false, 'industry'),
  ('sand', 'raw', 1, 0, 0, 0.30, 103, false, 'industry'),
  ('iron', 'raw', 1, 0, 0, 0.60, 104, false, 'industry'),
  ('copper', 'raw', 1, 0, 0, 0.80, 105, false, 'industry'),
  ('gold', 'raw', 1, 0, 0, 3.00, 106, false, 'industry'),
  ('oil', 'raw', 1, 0, 0, 1.00, 107, false, 'industry'),
  ('bricks', 'material', 1, 0, 0, 1.00, 120, false, 'industry'),
  ('steel', 'material', 1, 0, 0, 2.00, 121, false, 'industry'),
  ('glass', 'material', 1, 0, 0, 1.00, 122, false, 'industry'),
  ('concrete', 'material', 1, 0, 0, 1.20, 123, false, 'industry'),
  ('materials', 'material', 1, 0, 0, 1.40, 124, false, 'industry')
ON CONFLICT (key) DO NOTHING;

-- Company types. rate: units a tile a day at factor 1. place: land | rock (land or mountain) | water.
CREATE TABLE IF NOT EXISTS aquaterra_works_types (
  key text PRIMARY KEY,
  product text NOT NULL REFERENCES aquaterra_crops (key),
  in1 text REFERENCES aquaterra_crops (key),
  in1_qty int NOT NULL DEFAULT 0,
  in2 text REFERENCES aquaterra_crops (key),
  in2_qty int NOT NULL DEFAULT 0,
  rate numeric NOT NULL CHECK (rate > 0),
  place text NOT NULL CHECK (place IN ('land', 'rock', 'water')),
  cost bigint NOT NULL CHECK (cost >= 0),
  sort int NOT NULL DEFAULT 0
);
INSERT INTO aquaterra_works_types (key, product, in1, in1_qty, in2, in2_qty, rate, place, cost, sort) VALUES
  ('timber', 'wood', NULL, 0, NULL, 0, 1.00, 'land', 120, 10),
  ('claypit', 'clay', NULL, 0, NULL, 0, 1.60, 'land', 120, 11),
  ('quarry', 'stone', NULL, 0, NULL, 0, 1.25, 'rock', 150, 12),
  ('sandpit', 'sand', NULL, 0, NULL, 0, 1.60, 'land', 120, 13),
  ('ironmine', 'iron', NULL, 0, NULL, 0, 0.80, 'rock', 200, 14),
  ('coppermine', 'copper', NULL, 0, NULL, 0, 0.60, 'rock', 200, 15),
  ('goldmine', 'gold', NULL, 0, NULL, 0, 0.15, 'rock', 400, 16),
  ('oilwell', 'oil', NULL, 0, NULL, 0, 0.50, 'land', 300, 17),
  ('oilrig', 'oil', NULL, 0, NULL, 0, 0.50, 'water', 400, 18),
  ('brickworks', 'bricks', 'clay', 2, NULL, 0, 1.00, 'land', 250, 30),
  ('steelmill', 'steel', 'iron', 2, NULL, 0, 0.60, 'land', 350, 31),
  ('glassworks', 'glass', 'sand', 2, NULL, 0, 1.00, 'land', 250, 32),
  ('cementworks', 'concrete', 'stone', 1, 'sand', 1, 1.00, 'land', 250, 33),
  ('buildersyard', 'materials', 'wood', 1, 'stone', 1, 1.00, 'land', 250, 34)
ON CONFLICT (key) DO NOTHING;

-- What the ground of each biome holds: factor 1 is a normal deposit, no row means none.
CREATE TABLE IF NOT EXISTS aquaterra_geology (
  biome text NOT NULL,
  resource text NOT NULL REFERENCES aquaterra_crops (key),
  factor numeric NOT NULL CHECK (factor > 0),
  PRIMARY KEY (biome, resource)
);
INSERT INTO aquaterra_geology (biome, resource, factor)
SELECT b, r, f::numeric FROM (VALUES
  ('woodland', 'wood', 1.6), ('jungle', 'wood', 1.5), ('autumn', 'wood', 1.4), ('temperate', 'wood', 1.1), ('blossom', 'wood', 1.0),
  ('hills', 'wood', 1.0), ('rainbow', 'wood', 1.0), ('wetland', 'wood', 0.8), ('isles', 'wood', 0.7), ('savanna', 'wood', 0.6),
  ('oceania', 'wood', 0.6), ('tundra', 'wood', 0.5), ('deco', 'wood', 0.4),
  ('wetland', 'clay', 1.6), ('temperate', 'clay', 1.2), ('savanna', 'clay', 1.1), ('jungle', 'clay', 1.0), ('autumn', 'clay', 1.0),
  ('rainbow', 'clay', 1.0), ('blossom', 'clay', 0.9), ('hills', 'clay', 0.9), ('isles', 'clay', 0.8), ('oceania', 'clay', 0.7), ('woodland', 'clay', 0.7),
  ('volcanic', 'stone', 1.6), ('hills', 'stone', 1.5), ('tundra', 'stone', 1.3), ('isles', 'stone', 1.2), ('desert', 'stone', 1.0),
  ('industrial', 'stone', 1.0), ('rainbow', 'stone', 1.0), ('savanna', 'stone', 0.9), ('autumn', 'stone', 0.8), ('temperate', 'stone', 0.8),
  ('woodland', 'stone', 0.7), ('airport', 'stone', 0.5), ('metropolis', 'stone', 0.5),
  ('dunes', 'sand', 1.7), ('desert', 'sand', 1.5), ('oceania', 'sand', 1.3), ('isles', 'sand', 1.2), ('rainbow', 'sand', 1.0),
  ('savanna', 'sand', 0.8), ('wetland', 'sand', 0.7), ('airport', 'sand', 0.6),
  ('volcanic', 'iron', 1.5), ('industrial', 'iron', 1.4), ('tundra', 'iron', 1.3), ('hills', 'iron', 1.2), ('rainbow', 'iron', 1.0),
  ('desert', 'iron', 0.9), ('savanna', 'iron', 0.8), ('autumn', 'iron', 0.6),
  ('hills', 'copper', 1.4), ('volcanic', 'copper', 1.3), ('desert', 'copper', 1.1), ('rainbow', 'copper', 1.0), ('tundra', 'copper', 0.8),
  ('savanna', 'copper', 0.7), ('jungle', 'copper', 0.6),
  ('volcanic', 'gold', 1.4), ('hills', 'gold', 1.2), ('rainbow', 'gold', 1.0), ('desert', 'gold', 0.9), ('tundra', 'gold', 0.8), ('jungle', 'gold', 0.6),
  ('dunes', 'oil', 1.6), ('desert', 'oil', 1.4), ('tundra', 'oil', 1.0), ('savanna', 'oil', 0.8), ('wetland', 'oil', 0.6), ('industrial', 'oil', 0.6)
) v (b, r, f)
ON CONFLICT (biome, resource) DO NOTHING;

-- Building recipes: units per 100 Tide of construction cost.
CREATE TABLE IF NOT EXISTS aquaterra_build_recipe (
  kind text NOT NULL CHECK (kind IN ('cottage', 'tower')),
  resource text NOT NULL REFERENCES aquaterra_crops (key),
  per100 numeric NOT NULL CHECK (per100 > 0),
  PRIMARY KEY (kind, resource)
);
INSERT INTO aquaterra_build_recipe (kind, resource, per100) VALUES
  ('cottage', 'wood', 7.5), ('cottage', 'bricks', 10), ('cottage', 'steel', 1.25), ('cottage', 'glass', 2.5), ('cottage', 'materials', 5),
  ('tower', 'concrete', 8), ('tower', 'steel', 4), ('tower', 'glass', 5), ('tower', 'materials', 4), ('tower', 'bricks', 2), ('tower', 'copper', 1)
ON CONFLICT (kind, resource) DO NOTHING;

CREATE TABLE IF NOT EXISTS aquaterra_works (
  plot_id int PRIMARY KEY REFERENCES aquaterra_plots (id),
  owner text NOT NULL REFERENCES aquaterra_players (email),
  kind text NOT NULL REFERENCES aquaterra_works_types (key),
  factor numeric NOT NULL,
  since timestamptz NOT NULL DEFAULT now(),
  built_at timestamptz NOT NULL DEFAULT now(),
  cost_paid bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS aquaterra_works_owner ON aquaterra_works (owner);

-- Materials that went into each building (all of them, also those bought at the depot).
CREATE TABLE IF NOT EXISTS aquaterra_building_materials (
  plot_id int NOT NULL REFERENCES aquaterra_plots (id),
  resource text NOT NULL REFERENCES aquaterra_crops (key),
  qty bigint NOT NULL CHECK (qty >= 0),
  PRIMARY KEY (plot_id, resource)
);

INSERT INTO aquaterra_gov_params (key, value, min_value, max_value, label) VALUES
  ('industry_rate_pct', 100, 0, 1000, 'Industry: output of every company, % of the base rate'),
  ('industry_cap_hours', 48, 1, 720, 'Industry: hours of output a company keeps before it waits to be collected'),
  ('industry_max_works', 20, 1, 200, 'Industry: companies one resident may run'),
  ('industry_depot_pct', 150, 100, 1000, 'Builder Depot: price of materials it adds to a construction, % of the Reserve price'),
  ('industry_salvage_pct', 50, 0, 100, 'Demolition: % of the materials in a building that come back to the owner'),
  ('industry_starter_salvage_pct', 25, 0, 100, 'Demolition of a starter house of the map: % of the materials of a cottage that come back')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION aquaterra_ind_law(k text) RETURNS numeric LANGUAGE sql STABLE AS
$fn$ SELECT COALESCE((SELECT value FROM aquaterra_gov_params WHERE key = k), 0)::numeric $fn$;

CREATE OR REPLACE FUNCTION aquaterra_ind_depot(res text) RETURNS numeric LANGUAGE sql STABLE AS
$fn$ SELECT round(aquaterra_farm_price(res) * aquaterra_ind_law('industry_depot_pct') / 100.0, 3) $fn$;

-- Units of each material a construction of this kind and cost needs: [{resource, qty, depot}].
CREATE OR REPLACE FUNCTION aquaterra_ind_recipe(k text, cost bigint) RETURNS TABLE (resource text, qty bigint, depot numeric)
LANGUAGE sql STABLE AS $fn$
  SELECT r.resource, ceil(r.per100 * cost / 100.0)::bigint, aquaterra_ind_depot(r.resource)
  FROM aquaterra_build_recipe r WHERE r.kind = k AND cost > 0 ORDER BY r.resource
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_ind_biome(pid int) RETURNS text LANGUAGE sql STABLE AS
$fn$ SELECT d.biome FROM aquaterra_plots p JOIN aquaterra_districts d ON d.name = p.district WHERE p.id = pid ORDER BY d.id LIMIT 1 $fn$;

-- How rich this plot is for this company: null when it cannot stand here.
CREATE OR REPLACE FUNCTION aquaterra_ind_factor(pid int, wk text) RETURNS numeric LANGUAGE plpgsql STABLE AS $fn$
DECLARE t aquaterra_works_types; v_water boolean; v_build boolean; g numeric; rich numeric;
BEGIN
  SELECT * INTO t FROM aquaterra_works_types WHERE key = wk;
  IF t.key IS NULL THEN RETURN NULL; END IF;
  v_water := aquaterra_farm_water(pid);
  v_build := COALESCE((SELECT buildable FROM aquaterra_build_sites WHERE plot_id = pid), false);
  IF t.place = 'water' THEN
    IF NOT v_water THEN RETURN NULL; END IF;
    g := 1;
  ELSE
    IF v_water OR (t.place = 'land' AND NOT v_build) THEN RETURN NULL; END IF;
    IF t.in1 IS NOT NULL THEN
      g := CASE WHEN aquaterra_ind_biome(pid) = 'industrial' THEN 1.25 ELSE 1 END;
    ELSE
      SELECT factor INTO g FROM aquaterra_geology WHERE biome = aquaterra_ind_biome(pid) AND resource = t.product;
      IF g IS NULL THEN RETURN NULL; END IF;
      IF NOT v_build THEN g := g * 1.3; END IF;   -- a mountain: rich in rock
    END IF;
  END IF;
  rich := CASE WHEN t.in1 IS NULL THEN 0.8 + (abs(hashtext(pid::text || ':' || t.product)) % 41) / 100.0 ELSE 1 END;
  RETURN round(g * rich, 2);
END $fn$;

-- Units a day a company makes. Workers (server/city/city.sql): with too few people in the homes of the owner
-- every company of the owner works slower (aquaterra_farm_staff is 1 while the city is not installed).
CREATE OR REPLACE FUNCTION aquaterra_ind_per_day(w aquaterra_works) RETURNS numeric LANGUAGE sql STABLE AS
$fn$ SELECT t.rate * p.tiles * w.factor * aquaterra_ind_law('industry_rate_pct') / 100.0 * aquaterra_farm_staff(w.owner)
  FROM aquaterra_works_types t, aquaterra_plots p WHERE t.key = w.kind AND p.id = w.plot_id $fn$;

-- Units waiting (before inputs are checked).
CREATE OR REPLACE FUNCTION aquaterra_ind_pending(w aquaterra_works) RETURNS bigint LANGUAGE sql STABLE AS
$fn$ SELECT floor(aquaterra_ind_per_day(w) * least(greatest(0, extract(epoch FROM now() - w.since)) / 86400.0,
  aquaterra_ind_law('industry_cap_hours') / 24.0) + 1e-9)::bigint $fn$;

CREATE OR REPLACE FUNCTION aquaterra_ind_stock(who text, res text) RETURNS bigint LANGUAGE sql STABLE AS
$fn$ SELECT COALESCE((SELECT units FROM aquaterra_farm_barn WHERE email = who AND crop = res), 0) $fn$;

-- Collect one company: output to the storehouse, inputs taken from it. Returns units made.
CREATE OR REPLACE FUNCTION aquaterra_ind_collect(pid int, who text) RETURNS bigint LANGUAGE plpgsql AS $fn$
DECLARE w aquaterra_works; t aquaterra_works_types; n bigint; per_day numeric;
BEGIN
  SELECT * INTO w FROM aquaterra_works WHERE plot_id = pid AND owner = who FOR UPDATE;
  IF w.plot_id IS NULL THEN RETURN 0; END IF;
  SELECT * INTO t FROM aquaterra_works_types WHERE key = w.kind;
  n := aquaterra_ind_pending(w);
  IF t.in1 IS NOT NULL THEN n := least(n, aquaterra_ind_stock(who, t.in1) / t.in1_qty); END IF;
  IF t.in2 IS NOT NULL THEN n := least(n, aquaterra_ind_stock(who, t.in2) / t.in2_qty); END IF;
  IF n < 1 THEN RETURN 0; END IF;
  IF t.in1 IS NOT NULL THEN UPDATE aquaterra_farm_barn SET units = units - n * t.in1_qty WHERE email = who AND crop = t.in1; END IF;
  IF t.in2 IS NOT NULL THEN UPDATE aquaterra_farm_barn SET units = units - n * t.in2_qty WHERE email = who AND crop = t.in2; END IF;
  PERFORM aquaterra_farm_put(who, t.product, n);
  per_day := aquaterra_ind_per_day(w);
  -- unused capacity waits for inputs, up to the cap
  UPDATE aquaterra_works SET since = greatest(since + make_interval(secs => n * 86400.0 / per_day),
    now() - make_interval(hours => aquaterra_ind_law('industry_cap_hours')::int)) WHERE plot_id = pid;
  INSERT INTO aquaterra_farm_log (email, kind, crop, plot_id, units) VALUES (who, 'produce', t.product, pid, n);
  RETURN n;
END $fn$;

-- Called by aquaterra_build() for every construction. Takes the materials the owner has, records the whole
-- recipe in the building, and returns the depot value of what came from the storehouse (not charged).
CREATE OR REPLACE FUNCTION aquaterra_industry_use(who text, pid int, k text, lvl int, cost bigint, own boolean) RETURNS bigint
LANGUAGE plpgsql AS $fn$
DECLARE r record; take bigint; save numeric := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM aquaterra_works WHERE plot_id = pid) THEN RAISE EXCEPTION 'works'; END IF;
  FOR r IN SELECT * FROM aquaterra_ind_recipe(k, cost) LOOP
    take := CASE WHEN own THEN least(r.qty, aquaterra_ind_stock(who, r.resource)) ELSE 0 END;
    IF take > 0 THEN
      UPDATE aquaterra_farm_barn SET units = units - take WHERE email = who AND crop = r.resource;
      save := save + take * r.depot;
    END IF;
    INSERT INTO aquaterra_building_materials (plot_id, resource, qty) VALUES (pid, r.resource, r.qty)
    ON CONFLICT (plot_id, resource) DO UPDATE SET qty = aquaterra_building_materials.qty + EXCLUDED.qty;
  END LOOP;
  IF save > 0 THEN
    INSERT INTO aquaterra_farm_log (email, kind, crop, plot_id, units, tide) VALUES (who, 'build', NULL, pid, 0, floor(save));
  END IF;
  RETURN least(cost, floor(save))::bigint;
END $fn$;

-- Called by aquaterra_build() when a building goes: demolish (or replace) gives part of the materials back.
CREATE OR REPLACE FUNCTION aquaterra_industry_salvage(who text, pid int, act text, starter boolean) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE r record; n bigint; got jsonb := '{}'::jsonb;
BEGIN
  IF act <> 'sell' THEN
    IF starter AND NOT EXISTS (SELECT 1 FROM aquaterra_building_materials WHERE plot_id = pid) THEN
      FOR r IN SELECT * FROM aquaterra_ind_recipe('cottage', aquaterra_build_param('cottage_cost')) LOOP
        n := floor(r.qty * aquaterra_ind_law('industry_starter_salvage_pct') / 100.0);
        IF n > 0 THEN PERFORM aquaterra_farm_put(who, r.resource, n); got := got || jsonb_build_object(r.resource, n); END IF;
      END LOOP;
    ELSE
      FOR r IN SELECT * FROM aquaterra_building_materials WHERE plot_id = pid LOOP
        n := floor(r.qty * aquaterra_ind_law('industry_salvage_pct') / 100.0);
        IF n > 0 THEN PERFORM aquaterra_farm_put(who, r.resource, n); got := got || jsonb_build_object(r.resource, n); END IF;
      END LOOP;
    END IF;
    IF got <> '{}'::jsonb THEN
      INSERT INTO aquaterra_farm_log (email, kind, crop, plot_id, units) VALUES (who, 'salvage', NULL, pid,
        (SELECT sum(value::bigint) FROM jsonb_each_text(got)));
    END IF;
  END IF;
  DELETE FROM aquaterra_building_materials WHERE plot_id = pid;
  RETURN got;
END $fn$;

-- An Orbit resource as a good of the storehouse: sky + its letters (skygold, skyplatinum).
CREATE OR REPLACE FUNCTION aquaterra_ind_sky_key(res text) RETURNS text LANGUAGE sql IMMUTABLE AS
$fn$ SELECT left('sky' || lower(regexp_replace(res, '[^A-Za-z]', '', 'g')), 20) $fn$;

CREATE OR REPLACE FUNCTION aquaterra_ind_sky_good(res text) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE k text := aquaterra_ind_sky_key(res);
BEGIN
  INSERT INTO aquaterra_crops (key, grp, hours, seed_per_tile, yield_per_tile, price, sort, water, source)
  VALUES (k, 'orbit', 1, 0, 0, greatest(0.01, aquaterra_orbit_base(res)), 900, false, 'orbit') ON CONFLICT (key) DO NOTHING;
  RETURN k;
END $fn$;

-- The industry API (reached through aquaterra_farm). req: {action, session, plotId, works, resource, units}.
--  works: catalog (and my companies, plots and storehouse with a session) | setup | produce | dismantle | ship
CREATE OR REPLACE FUNCTION aquaterra_industry(req jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  act text := coalesce(req->>'action', '');
  me text; res jsonb := '{}'::jsonb;
  pid int; v_plot record; v_kind text; t aquaterra_works_types; v_f numeric; v_fee bigint; v_n bigint; v_m int; v_txt text;
  r record; v_have bigint; v_key text;
BEGIN
  IF coalesce(req->>'session', '') <> '' THEN
    SELECT s.email INTO me FROM aquaterra_sessions s
    WHERE s.token_hash = encode(sha256(convert_to(req->>'session', 'UTF8')), 'hex') AND s.expires_at > now();
  END IF;
  IF act <> 'works' AND me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401);
  END IF;
  pid := CASE WHEN coalesce(req->>'plotId', '') ~ '^[0-9]' AND length(req->>'plotId') <= 9 AND (req->>'plotId') !~ '[^0-9]' THEN (req->>'plotId')::int END;
  v_kind := left(coalesce(req->>'works', ''), 20);

  BEGIN
    IF act = 'setup' THEN
      SELECT p.* INTO v_plot FROM aquaterra_plots p WHERE p.id = pid;
      IF v_plot.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      PERFORM 1 FROM aquaterra_plot_owners WHERE plot_id = pid AND owner = me FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'not_owner'; END IF;
      SELECT * INTO t FROM aquaterra_works_types WHERE key = v_kind;
      IF t.key IS NULL THEN RAISE EXCEPTION 'works_kind'; END IF;
      IF EXISTS (SELECT 1 FROM aquaterra_works WHERE plot_id = pid) THEN RAISE EXCEPTION 'works'; END IF;
      IF EXISTS (SELECT 1 FROM aquaterra_farm_fields WHERE plot_id = pid) THEN RAISE EXCEPTION 'planted'; END IF;
      IF EXISTS (SELECT 1 FROM aquaterra_buildings WHERE plot_id = pid AND kind <> 'empty') THEN RAISE EXCEPTION 'building'; END IF;
      v_f := aquaterra_ind_factor(pid, v_kind);
      IF v_f IS NULL THEN RAISE EXCEPTION 'place'; END IF;
      IF (SELECT count(*) FROM aquaterra_works WHERE owner = me) >= aquaterra_ind_law('industry_max_works') THEN RAISE EXCEPTION 'too_many'; END IF;
      v_fee := round(t.cost * aquaterra_build_param('permit_pct') / 100.0);
      IF aquaterra_arc_free(me) < t.cost + v_fee THEN RAISE EXCEPTION 'insufficient'; END IF;
      PERFORM aquaterra_arc_pay(me, 'treasury', t.cost, 'works', pid, 'Industry: ' || v_kind || ' on ' || v_plot.address, me,
        'works:' || pid || ':' || floor(extract(epoch FROM now())));
      PERFORM aquaterra_arc_pay(me, 'state:treasury', v_fee, 'permit', pid, 'Building permit, ' || v_kind || ', ' || v_plot.address, me,
        'works:permit:' || pid || ':' || floor(extract(epoch FROM now())));
      INSERT INTO aquaterra_works (plot_id, owner, kind, factor, cost_paid) VALUES (pid, me, v_kind, v_f, t.cost);
      INSERT INTO aquaterra_farm_log (email, kind, crop, plot_id, units, tide) VALUES (me, 'setup', t.product, pid, 0, t.cost + v_fee);
      res := jsonb_build_object('cost', t.cost, 'permit', v_fee, 'factor', v_f);

    ELSIF act = 'produce' THEN
      -- One company, or all of mine: extraction first, so its output feeds the works.
      v_n := 0; v_m := 0;
      FOR r IN SELECT w.plot_id FROM aquaterra_works w JOIN aquaterra_works_types t2 ON t2.key = w.kind
          WHERE w.owner = me AND (pid IS NULL OR w.plot_id = pid) ORDER BY t2.sort, w.plot_id LOOP
        v_have := aquaterra_ind_collect(r.plot_id, me);
        IF v_have > 0 THEN v_n := v_n + v_have; v_m := v_m + 1; END IF;
      END LOOP;
      IF v_m = 0 THEN RAISE EXCEPTION 'nothing'; END IF;
      res := jsonb_build_object('collected', v_m, 'units', v_n);

    ELSIF act = 'dismantle' THEN
      IF NOT EXISTS (SELECT 1 FROM aquaterra_works WHERE plot_id = pid AND owner = me) THEN RAISE EXCEPTION 'not_found'; END IF;
      PERFORM aquaterra_ind_collect(pid, me);
      DELETE FROM aquaterra_works WHERE plot_id = pid AND owner = me RETURNING kind INTO v_txt;
      INSERT INTO aquaterra_farm_log (email, kind, crop, plot_id) VALUES (me, 'dismantle', (SELECT product FROM aquaterra_works_types WHERE key = v_txt), pid);
      res := jsonb_build_object('dismantled', pid);

    ELSIF act = 'ship' THEN
      -- Bring mined Orbit goods down to the storehouse (all units of one resource, or a number).
      v_txt := left(coalesce(req->>'resource', ''), 30);
      SELECT units INTO v_have FROM aquaterra_orbit_holds WHERE email = me AND resource = v_txt FOR UPDATE;
      v_n := CASE WHEN coalesce(req->>'units', '') ~ '^[0-9]' AND length(req->>'units') <= 12 AND (req->>'units') !~ '[^0-9]' THEN (req->>'units')::bigint ELSE v_have END;
      IF v_have IS NULL OR v_n IS NULL OR v_n < 1 OR v_n > v_have THEN RAISE EXCEPTION 'nothing'; END IF;
      v_key := aquaterra_ind_sky_good(v_txt);
      UPDATE aquaterra_orbit_holds SET units = units - v_n WHERE email = me AND resource = v_txt;
      PERFORM aquaterra_farm_put(me, v_key, v_n);
      INSERT INTO aquaterra_orbit_log (email, kind, resource, units) VALUES (me, 'ship', v_txt, v_n);
      INSERT INTO aquaterra_farm_log (email, kind, crop, units) VALUES (me, 'ship', v_key, v_n);
      res := jsonb_build_object('shipped', v_n, 'good', v_key);

    ELSIF act <> 'works' THEN
      RAISE EXCEPTION 'action';
    END IF;

    res := res || jsonb_build_object(
      'types', (SELECT jsonb_agg(jsonb_build_object('key', t2.key, 'product', t2.product, 'in1', t2.in1, 'in1Qty', t2.in1_qty,
          'in2', t2.in2, 'in2Qty', t2.in2_qty, 'rate', round(t2.rate * aquaterra_ind_law('industry_rate_pct') / 100.0, 3),
          'place', t2.place, 'cost', t2.cost, 'permit', round(t2.cost * aquaterra_build_param('permit_pct') / 100.0),
          'biomes', (SELECT jsonb_object_agg(g.biome, g.factor) FROM aquaterra_geology g WHERE g.resource = t2.product AND t2.in1 IS NULL))
        ORDER BY t2.sort) FROM aquaterra_works_types t2),
      'goods', (SELECT jsonb_agg(jsonb_build_object('key', c.key, 'group', c.grp, 'price', aquaterra_farm_price(c.key), 'depot', aquaterra_ind_depot(c.key))
        ORDER BY c.sort) FROM aquaterra_crops c WHERE c.source <> 'farm'),
      'recipes', (SELECT jsonb_object_agg(x.kind, x.r) FROM (SELECT kind, jsonb_object_agg(resource, per100) AS r FROM aquaterra_build_recipe GROUP BY kind) x),
      'laws', jsonb_build_object('capHours', aquaterra_ind_law('industry_cap_hours'), 'maxWorks', aquaterra_ind_law('industry_max_works'),
        'depotPct', aquaterra_ind_law('industry_depot_pct'), 'salvagePct', aquaterra_ind_law('industry_salvage_pct'),
        'starterSalvagePct', aquaterra_ind_law('industry_starter_salvage_pct'), 'marketTaxPct', aquaterra_farm_law('farm_market_tax_pct')),
      'companies', (SELECT count(*) FROM aquaterra_works), 'owners', (SELECT count(DISTINCT owner) FROM aquaterra_works));
    IF me IS NOT NULL THEN
      res := res || jsonb_build_object(
        'plots', COALESCE((SELECT jsonb_agg(jsonb_build_object('plotId', p.id, 'address', p.address, 'district', p.district, 'tiles', p.tiles,
            'biome', aquaterra_ind_biome(p.id), 'water', aquaterra_farm_water(p.id),
            'block', CASE WHEN w.plot_id IS NOT NULL THEN NULL WHEN ff.plot_id IS NOT NULL THEN 'planted'
              WHEN EXISTS (SELECT 1 FROM aquaterra_buildings b WHERE b.plot_id = p.id AND b.kind <> 'empty') THEN 'building' END,
            'works', CASE WHEN w.plot_id IS NOT NULL THEN jsonb_build_object('kind', w.kind, 'factor', w.factor,
              'perDay', round(aquaterra_ind_per_day(w), 2), 'pending', aquaterra_ind_pending(w), 'since', w.since) END,
            'options', CASE WHEN w.plot_id IS NULL THEN (SELECT jsonb_object_agg(t3.key, f) FROM (SELECT t4.key, aquaterra_ind_factor(p.id, t4.key) AS f
              FROM aquaterra_works_types t4) t3 WHERE t3.f IS NOT NULL) END)
            ORDER BY (w.plot_id IS NULL), p.id)
          FROM aquaterra_plot_owners o JOIN aquaterra_plots p ON p.id = o.plot_id
          LEFT JOIN aquaterra_works w ON w.plot_id = p.id LEFT JOIN aquaterra_farm_fields ff ON ff.plot_id = p.id
          WHERE o.owner = me), '[]'::jsonb),
        'store', COALESCE((SELECT jsonb_object_agg(b.crop, b.units) FROM aquaterra_farm_barn b JOIN aquaterra_crops c ON c.key = b.crop
          WHERE b.email = me AND b.units > 0 AND c.source <> 'farm'), '{}'::jsonb),
        'orbit', COALESCE((SELECT jsonb_agg(jsonb_build_object('resource', h.resource, 'units', h.units, 'good', aquaterra_ind_sky_key(h.resource))
          ORDER BY h.resource) FROM aquaterra_orbit_holds h WHERE h.email = me AND h.units > 0), '[]'::jsonb),
        'free', aquaterra_arc_free(me));
    END IF;
    RETURN jsonb_build_object('ok', true) || res;
  EXCEPTION WHEN raise_exception OR check_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM,
      'status', CASE SQLERRM WHEN 'not_found' THEN 404 ELSE 400 END);
  END;
END $fn$;
