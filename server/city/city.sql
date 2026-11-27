-- AquaTerra: city orders and workforce. One-off migration (never per request). Safe to run again.
-- Needs: economy, governance (laws), arcade (pay helpers), treasury, build, farm, industry.
-- n8n quirks: no double-dollar quotes (use $fn$), no positional parameters in the text,
-- no dollar sign right before a quote, no apostrophes in comments.
--
-- Workforce
--  * Homes house NPC residents: a starter house of the map, a cottage, a skyscraper by its height (a tower
--    that is being raised keeps the people of the level below). They work for the owner of the home.
--  * Every company (server/industry) and every field or sea pen (server/farm) has jobs.
--  * Staffing = people / jobs (at most 1). Output = workforce_base_pct + the rest times staffing:
--    with no homes a resident works at half speed, with enough people at full speed.
--    Industry: the daily rate of every company. Farms: the harvest.
--
-- City orders
--  * Every UTC day (lazy, first request) NICS AI posts city_orders_day orders from live data, no model:
--    one land crop, one building material, one raw resource, one sea crop. Goods that residents made in
--    the last 7 days come first; the size is about one day of what the city makes, at least a small batch.
--  * A resident delivers from the storehouse; the goods are used by the city (they leave the game).
--    Pay per unit = Reserve price times city_order_bonus_pct, from the AquaTerra Reserve, as income
--    (10 percent income tax by the treasury trigger). One resident fills at most city_order_share_pct of an
--    order and earns at most city_order_cap a day. The whole day pays at most city_orders_pot.
--    Orders end with the UTC day, filled or not.

INSERT INTO aquaterra_gov_params (key, value, min_value, max_value, label) VALUES
  ('workforce_base_pct', 50, 0, 100, 'Workforce: output of a company or farm with no workers, % of full'),
  ('workforce_starter', 3, 0, 100, 'Workforce: NPC residents of a starter house of the map'),
  ('workforce_cottage', 4, 0, 100, 'Workforce: NPC residents of a cottage'),
  ('workforce_tower_1', 40, 0, 2000, 'Workforce: NPC residents of a skyscraper of 10 floors'),
  ('workforce_tower_2', 120, 0, 5000, 'Workforce: NPC residents of a skyscraper of 30 floors'),
  ('workforce_tower_3', 240, 0, 10000, 'Workforce: NPC residents of a skyscraper of 60 floors'),
  ('city_orders_day', 4, 0, 8, 'City orders: orders NICS AI posts each day'),
  ('city_orders_pot', 2000, 0, 100000, 'City orders: TIDE the city pays a day for all orders together'),
  ('city_order_bonus_pct', 150, 100, 500, 'City orders: pay per unit, % of the Reserve price'),
  ('city_order_share_pct', 50, 1, 100, 'City orders: largest share of one order a single resident may fill, %'),
  ('city_order_cap', 500, 0, 100000, 'City orders: most TIDE one resident earns from orders a day')
ON CONFLICT (key) DO NOTHING;

-- Jobs: workers one company of each kind needs; farm and seafarm for a field or a sea pen.
CREATE TABLE IF NOT EXISTS aquaterra_city_jobs (
  kind text PRIMARY KEY,
  workers int NOT NULL CHECK (workers >= 0)
);
INSERT INTO aquaterra_city_jobs (kind, workers) VALUES
  ('farm', 2), ('seafarm', 2),
  ('timber', 3), ('claypit', 2), ('quarry', 4), ('sandpit', 2), ('ironmine', 5), ('coppermine', 5), ('goldmine', 6),
  ('oilwell', 4), ('oilrig', 6), ('brickworks', 5), ('steelmill', 8), ('glassworks', 5), ('cementworks', 5), ('buildersyard', 6)
ON CONFLICT (kind) DO NOTHING;

CREATE TABLE IF NOT EXISTS aquaterra_city_orders (
  id bigserial PRIMARY KEY,
  day date NOT NULL,
  slot int NOT NULL,
  good text NOT NULL REFERENCES aquaterra_crops (key),
  project text NOT NULL,
  qty bigint NOT NULL CHECK (qty > 0),
  delivered bigint NOT NULL DEFAULT 0 CHECK (delivered >= 0),
  reward numeric NOT NULL CHECK (reward > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day, slot)
);

CREATE TABLE IF NOT EXISTS aquaterra_city_deliveries (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES aquaterra_city_orders (id),
  email text NOT NULL,
  units bigint NOT NULL CHECK (units > 0),
  tide bigint NOT NULL CHECK (tide >= 0),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aquaterra_city_deliveries_order ON aquaterra_city_deliveries (order_id);
CREATE INDEX IF NOT EXISTS aquaterra_city_deliveries_email ON aquaterra_city_deliveries (email, at);

CREATE OR REPLACE FUNCTION aquaterra_city_law(k text) RETURNS numeric LANGUAGE sql STABLE AS
$fn$ SELECT COALESCE((SELECT value FROM aquaterra_gov_params WHERE key = k), 0)::numeric $fn$;

CREATE OR REPLACE FUNCTION aquaterra_city_jobs_of(k text) RETURNS int LANGUAGE sql STABLE AS
$fn$ SELECT COALESCE((SELECT workers FROM aquaterra_city_jobs WHERE kind = k), 0) $fn$;

-- NPC residents of one home: kind and level of the building (a tower being raised keeps the level below).
CREATE OR REPLACE FUNCTION aquaterra_city_home(k text, lvl int, ready boolean) RETURNS int LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN k = 'starter' THEN aquaterra_city_law('workforce_starter')::int
    WHEN k = 'cottage' AND ready THEN aquaterra_city_law('workforce_cottage')::int
    WHEN k = 'tower' AND (CASE WHEN ready THEN lvl ELSE lvl - 1 END) >= 1
      THEN aquaterra_city_law('workforce_tower_' || (CASE WHEN ready THEN lvl ELSE lvl - 1 END))::int
    ELSE 0 END
$fn$;

-- The homes of a resident: [{plotId, kind, level, people}].
CREATE OR REPLACE FUNCTION aquaterra_city_homes(who text) RETURNS TABLE (plot_id int, kind text, level int, people int)
LANGUAGE sql STABLE AS $fn$
  SELECT x.plot_id, x.k, x.lvl, aquaterra_city_home(x.k, x.lvl, x.ready) FROM (
    SELECT o.plot_id,
      CASE WHEN b.plot_id IS NOT NULL THEN b.kind WHEN s.starter = 'cottage' THEN 'starter' ELSE 'none' END AS k,
      COALESCE(b.level, 0) AS lvl, COALESCE(b.ready_at <= now(), true) AS ready
    FROM aquaterra_plot_owners o
    LEFT JOIN aquaterra_buildings b ON b.plot_id = o.plot_id
    LEFT JOIN aquaterra_build_sites s ON s.plot_id = o.plot_id
    WHERE o.owner = who) x
  WHERE aquaterra_city_home(x.k, x.lvl, x.ready) > 0
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_city_people(who text) RETURNS bigint LANGUAGE sql STABLE AS
$fn$ SELECT COALESCE(sum(people), 0)::bigint FROM aquaterra_city_homes(who) $fn$;

CREATE OR REPLACE FUNCTION aquaterra_city_jobs_total(who text) RETURNS bigint LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE((SELECT sum(aquaterra_city_jobs_of(w.kind)) FROM aquaterra_works w WHERE w.owner = who), 0)::bigint
    + COALESCE((SELECT sum(aquaterra_city_jobs_of(CASE WHEN aquaterra_farm_water(f.plot_id) THEN 'seafarm' ELSE 'farm' END))
        FROM aquaterra_farm_fields f WHERE f.owner = who), 0)::bigint
$fn$;

-- Share of full output (0..1) for this resident: base + (1 - base) * staffing.
CREATE OR REPLACE FUNCTION aquaterra_city_staff(who text) RETURNS numeric LANGUAGE plpgsql STABLE AS $fn$
DECLARE j bigint; p bigint; base numeric;
BEGIN
  base := least(1, greatest(0, aquaterra_city_law('workforce_base_pct') / 100.0));
  j := aquaterra_city_jobs_total(who);
  IF j = 0 THEN RETURN 1; END IF;
  p := aquaterra_city_people(who);
  RETURN round(base + (1 - base) * least(1, p::numeric / j), 4);
END $fn$;

-- Today: post the orders once (several requests may come at the same moment).
CREATE OR REPLACE FUNCTION aquaterra_city_make_orders(d date) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  n int; s int; v_grp text; g record; per_order numeric; v_reward numeric; v_qty bigint; v_proj text; used text[] := '{}';
  groups text[] := ARRAY['crop', 'material', 'raw', 'sea'];
BEGIN
  IF EXISTS (SELECT 1 FROM aquaterra_city_orders WHERE day = d) THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('aquaterra_city_orders'));
  IF EXISTS (SELECT 1 FROM aquaterra_city_orders WHERE day = d) THEN RETURN; END IF;
  n := least(8, greatest(0, aquaterra_city_law('city_orders_day')::int));
  IF n = 0 OR aquaterra_city_law('city_orders_pot') < 1 THEN RETURN; END IF;
  per_order := aquaterra_city_law('city_orders_pot') / n;
  FOR s IN 1..n LOOP
    v_grp := groups[1 + (s - 1) % 4];
    SELECT c.key, aquaterra_farm_price(c.key) AS price,
      COALESCE((SELECT sum(l.units) FROM aquaterra_farm_log l WHERE l.crop = c.key AND l.kind IN ('harvest', 'produce')
        AND l.at > now() - interval '7 days'), 0) AS made
    INTO g
    FROM aquaterra_crops c
    WHERE aquaterra_farm_price(c.key) > 0 AND NOT (c.key = ANY (used))
      AND CASE v_grp WHEN 'crop' THEN c.source = 'farm' AND NOT c.water
                   WHEN 'sea' THEN c.source = 'farm' AND c.water
                   WHEN 'material' THEN c.source = 'industry' AND c.grp = 'material'
                   ELSE c.source = 'industry' AND c.grp = 'raw' END
    ORDER BY (COALESCE((SELECT sum(l.units) FROM aquaterra_farm_log l WHERE l.crop = c.key AND l.kind IN ('harvest', 'produce')
        AND l.at > now() - interval '7 days'), 0) > 0) DESC, hashtext(d::text || ':' || s || ':' || c.key)
    LIMIT 1;
    CONTINUE WHEN g.key IS NULL;
    used := used || g.key::text;
    v_reward := round(g.price * aquaterra_city_law('city_order_bonus_pct') / 100.0, 3);
    v_qty := least(floor(per_order / v_reward)::bigint, greatest(ceil(g.made / 7.0)::bigint, ceil(60 / g.price)::bigint));
    IF v_qty > 20 THEN v_qty := (v_qty / 5) * 5; END IF;
    CONTINUE WHEN v_qty < 1;
    v_proj := CASE v_grp
      WHEN 'crop' THEN (ARRAY['feast', 'canteen', 'foodbank', 'festival'])[1 + abs(hashtext(d::text || 'p' || s)) % 4]
      WHEN 'sea' THEN (ARRAY['fishmarket', 'harbourfeast', 'canteen'])[1 + abs(hashtext(d::text || 'p' || s)) % 3]
      WHEN 'material' THEN (ARRAY['bridge', 'school', 'harbour', 'clinic', 'library', 'seawall'])[1 + abs(hashtext(d::text || 'p' || s)) % 6]
      ELSE (ARRAY['foundry', 'roads', 'station', 'workshop'])[1 + abs(hashtext(d::text || 'p' || s)) % 4] END;
    INSERT INTO aquaterra_city_orders (day, slot, good, project, qty, reward) VALUES (d, s, g.key, v_proj, v_qty, v_reward)
    ON CONFLICT (day, slot) DO NOTHING;
  END LOOP;
END $fn$;

-- The city API (reached through aquaterra_farm). req: {action, session, orderId, units}.
--  city: orders of today, the last days, workforce of the city (and mine with a session) | deliver
CREATE OR REPLACE FUNCTION aquaterra_city(req jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  act text := coalesce(req->>'action', '');
  me text; res jsonb := '{}'::jsonb;
  today date := (now() AT TIME ZONE 'utc')::date;
  day0 timestamptz := ((now() AT TIME ZONE 'utc')::date)::timestamp AT TIME ZONE 'utc';
  o aquaterra_city_orders; oid bigint; v_have bigint; v_units bigint; v_mine bigint; v_share bigint; v_left numeric; v_tide bigint; v_req bigint;
BEGIN
  IF coalesce(req->>'session', '') <> '' THEN
    SELECT s.email INTO me FROM aquaterra_sessions s
    WHERE s.token_hash = encode(sha256(convert_to(req->>'session', 'UTF8')), 'hex') AND s.expires_at > now();
  END IF;
  IF act <> 'city' AND me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401);
  END IF;
  PERFORM aquaterra_city_make_orders(today);

  BEGIN
    IF act = 'deliver' THEN
      oid := CASE WHEN coalesce(req->>'orderId', '') ~ '^[0-9]' AND length(req->>'orderId') <= 15 AND (req->>'orderId') !~ '[^0-9]' THEN (req->>'orderId')::bigint END;
      SELECT * INTO o FROM aquaterra_city_orders WHERE id = oid FOR UPDATE;
      IF o.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      IF o.day <> today THEN RAISE EXCEPTION 'expired'; END IF;
      IF o.delivered >= o.qty THEN RAISE EXCEPTION 'filled'; END IF;
      v_mine := COALESCE((SELECT sum(units) FROM aquaterra_city_deliveries WHERE order_id = o.id AND email = me), 0);
      v_share := greatest(1, ceil(o.qty * aquaterra_city_law('city_order_share_pct') / 100.0))::bigint;
      IF v_mine >= v_share THEN RAISE EXCEPTION 'share'; END IF;
      v_left := aquaterra_city_law('city_order_cap') - COALESCE((SELECT sum(tide) FROM aquaterra_city_deliveries WHERE email = me AND at >= day0), 0);
      IF v_left < o.reward THEN RAISE EXCEPTION 'cap'; END IF;
      SELECT units INTO v_have FROM aquaterra_farm_barn WHERE email = me AND crop = o.good FOR UPDATE;
      IF coalesce(v_have, 0) < 1 THEN RAISE EXCEPTION 'nothing'; END IF;
      v_req := CASE WHEN coalesce(req->>'units', '') ~ '^[0-9]' AND length(req->>'units') <= 12 AND (req->>'units') !~ '[^0-9]'
        THEN (req->>'units')::bigint ELSE v_have END;
      IF v_req < 1 THEN RAISE EXCEPTION 'units'; END IF;
      v_units := least(v_req, v_have, o.qty - o.delivered, v_share - v_mine, floor(v_left / o.reward)::bigint);
      v_tide := floor(v_units * o.reward)::bigint;
      IF v_units < 1 OR v_tide < 1 THEN RAISE EXCEPTION 'too_little'; END IF;
      UPDATE aquaterra_farm_barn SET units = units - v_units WHERE email = me AND crop = o.good;
      UPDATE aquaterra_city_orders SET delivered = delivered + v_units WHERE id = o.id;
      INSERT INTO aquaterra_city_deliveries (order_id, email, units, tide) VALUES (o.id, me, v_units, v_tide);
      PERFORM aquaterra_arc_pay('treasury', me, v_tide, 'income', NULL, 'City order: ' || v_units || ' ' || o.good || ' for the ' || o.project, me,
        'city:order:' || o.id || ':' || me || ':' || extract(epoch FROM clock_timestamp()));
      INSERT INTO aquaterra_farm_log (email, kind, crop, units, tide) VALUES (me, 'city', o.good, v_units, v_tide);
      res := jsonb_build_object('delivered', v_units, 'good', o.good, 'tide', v_tide,
        'taxPct', aquaterra_city_law('income_tax_pct'));
    ELSIF act <> 'city' THEN
      RAISE EXCEPTION 'action';
    END IF;

    res := res || jsonb_build_object(
      'day', today, 'endsAt', day0 + interval '1 day',
      'orders', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'good', c.good, 'project', c.project, 'qty', c.qty,
          'delivered', c.delivered, 'reward', c.reward, 'price', aquaterra_farm_price(c.good),
          'suppliers', (SELECT count(DISTINCT d.email) FROM aquaterra_city_deliveries d WHERE d.order_id = c.id),
          'mine', CASE WHEN me IS NOT NULL THEN COALESCE((SELECT sum(d.units) FROM aquaterra_city_deliveries d WHERE d.order_id = c.id AND d.email = me), 0) END,
          'have', CASE WHEN me IS NOT NULL THEN COALESCE((SELECT b.units FROM aquaterra_farm_barn b WHERE b.email = me AND b.crop = c.good), 0) END)
        ORDER BY c.slot) FROM aquaterra_city_orders c WHERE c.day = today), '[]'::jsonb),
      'past', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', x.day, 'orders', x.n, 'filled', x.filled, 'units', x.units, 'tide', x.tide) ORDER BY x.day DESC)
        FROM (SELECT c.day, count(*) AS n, count(*) FILTER (WHERE c.delivered >= c.qty) AS filled, sum(c.delivered) AS units,
            COALESCE((SELECT sum(d.tide) FROM aquaterra_city_deliveries d JOIN aquaterra_city_orders c2 ON c2.id = d.order_id WHERE c2.day = c.day), 0) AS tide
          FROM aquaterra_city_orders c WHERE c.day < today AND c.day >= today - 7 GROUP BY c.day) x), '[]'::jsonb),
      'laws', jsonb_build_object('bonusPct', aquaterra_city_law('city_order_bonus_pct'), 'sharePct', aquaterra_city_law('city_order_share_pct'),
        'cap', aquaterra_city_law('city_order_cap'), 'pot', aquaterra_city_law('city_orders_pot'),
        'basePct', aquaterra_city_law('workforce_base_pct'), 'incomeTaxPct', aquaterra_city_law('income_tax_pct'),
        'homes', jsonb_build_object('starter', aquaterra_city_law('workforce_starter'), 'cottage', aquaterra_city_law('workforce_cottage'),
          'tower1', aquaterra_city_law('workforce_tower_1'), 'tower2', aquaterra_city_law('workforce_tower_2'), 'tower3', aquaterra_city_law('workforce_tower_3'))),
      'jobs', (SELECT jsonb_object_agg(kind, workers) FROM aquaterra_city_jobs),
      'city', (SELECT jsonb_build_object('people', COALESCE(sum(aquaterra_city_people(e.owner)), 0), 'jobs', COALESCE(sum(aquaterra_city_jobs_total(e.owner)), 0))
        FROM (SELECT DISTINCT owner FROM aquaterra_plot_owners) e));
    IF me IS NOT NULL THEN
      res := res || jsonb_build_object('me', jsonb_build_object(
        'people', aquaterra_city_people(me), 'jobs', aquaterra_city_jobs_total(me), 'output', aquaterra_city_staff(me),
        'homes', COALESCE((SELECT jsonb_agg(jsonb_build_object('plotId', h.plot_id, 'address', p.address, 'kind', h.kind, 'level', h.level, 'people', h.people)
          ORDER BY h.people DESC, h.plot_id) FROM aquaterra_city_homes(me) h JOIN aquaterra_plots p ON p.id = h.plot_id), '[]'::jsonb),
        'works', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', x.k, 'count', x.n, 'jobs', x.n * aquaterra_city_jobs_of(x.k)) ORDER BY x.k)
          FROM (SELECT w.kind AS k, count(*) AS n FROM aquaterra_works w WHERE w.owner = me GROUP BY w.kind
            UNION ALL SELECT CASE WHEN aquaterra_farm_water(f.plot_id) THEN 'seafarm' ELSE 'farm' END, count(*) FROM aquaterra_farm_fields f
              WHERE f.owner = me GROUP BY 1) x), '[]'::jsonb),
        'earnedToday', COALESCE((SELECT sum(tide) FROM aquaterra_city_deliveries WHERE email = me AND at >= day0), 0)));
    END IF;
    RETURN jsonb_build_object('ok', true) || res;
  EXCEPTION WHEN raise_exception OR check_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM,
      'status', CASE SQLERRM WHEN 'not_found' THEN 404 ELSE 400 END);
  END;
END $fn$;
