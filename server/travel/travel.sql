-- AquaTerra World: where each resident is, and travel between districts.
-- One-off migration (run once, never per request). Safe to run again.
-- Needs the tables of the account, economy and governance workflows.
-- n8n runs this text: no double dollar quotes (use $fn$), no positional parameters.
--
-- Rules (server-authoritative; the site only plans and animates):
--  * A resident always stands somewhere. A newcomer appears in their home
--    district (aquaterra_residents) or in First Light City.
--  * walk: inside the district, free. car: to a neighbouring district joined by road.
--    train / ferry / plane: between stations / harbours / airports (routes from travel.json).
--  * Fare = base + per100 x tiles / 100. Of every fare, travel_tax_pct (a law of the
--    Commonwealth, changed by vote) goes to the State Treasury; the rest goes to the
--    operator: the owner of the departure station, harbour or airport, or the State
--    Treasury while the state owns it. Roads belong to the state.
--  * Residents can buy a station, harbour or airport from the state, while standing in its district.
--  * Land can only be bought in the district where the resident stands (economy patch at the end).

ALTER TABLE aquaterra_plots ADD COLUMN IF NOT EXISTS ax int;
ALTER TABLE aquaterra_plots ADD COLUMN IF NOT EXISTS ay int;
ALTER TABLE aquaterra_districts ADD COLUMN IF NOT EXISTS cx int;
ALTER TABLE aquaterra_districts ADD COLUMN IF NOT EXISTS cy int;

CREATE TABLE IF NOT EXISTS aquaterra_travel_params (
  key text PRIMARY KEY,
  value bigint NOT NULL,
  note text
);
INSERT INTO aquaterra_travel_params (key, value, note) VALUES
  ('car_base', 2, 'Car: TIDE per trip'),
  ('car_per100', 8, 'Car: TIDE per 100 tiles of road'),
  ('train_base', 5, 'Train: TIDE per trip'),
  ('train_per100', 6, 'Train: TIDE per 100 tiles of rail'),
  ('ferry_base', 8, 'Ferry: TIDE per trip'),
  ('ferry_per100', 10, 'Ferry: TIDE per 100 tiles of sea'),
  ('plane_base', 30, 'Plane: TIDE per flight'),
  ('plane_per100', 15, 'Plane: TIDE per 100 tiles flown'),
  ('price_station', 25000, 'Price of a railway station, TIDE'),
  ('price_port', 8000, 'Price of a harbour, TIDE'),
  ('price_airport', 60000, 'Price of an airport, TIDE'),
  ('max_hubs_per_citizen', 3, 'Stations, harbours and airports one resident may own')
ON CONFLICT (key) DO NOTHING;

-- The travel tax is a law of the Commonwealth: it lives with the other state numbers.
INSERT INTO aquaterra_gov_params (key, value, min_value, max_value, label) VALUES
  ('travel_tax_pct', 10, 0, 50, 'Travel tax, percent of every fare, to the State Treasury')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS aquaterra_travel_hubs (
  id text PRIMARY KEY,                 -- 'station:16', 'port:30', 'airport:3'
  kind text NOT NULL,                  -- station | port | airport
  district_id int NOT NULL,
  name text NOT NULL,
  x int NOT NULL,
  y int NOT NULL,
  price bigint NOT NULL,
  owner text REFERENCES aquaterra_players(email),
  bought_at timestamptz,
  trips int NOT NULL DEFAULT 0,
  revenue bigint NOT NULL DEFAULT 0,   -- operator share earned since the hub opened
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aquaterra_travel_hubs_owner ON aquaterra_travel_hubs (owner);

CREATE TABLE IF NOT EXISTS aquaterra_travel_routes (
  mode text NOT NULL,                  -- car | train | ferry | plane
  a int NOT NULL,
  b int NOT NULL,
  dist int NOT NULL CHECK (dist > 0),
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mode, a, b),
  CHECK (a < b)
);

CREATE TABLE IF NOT EXISTS aquaterra_locations (
  email text PRIMARY KEY REFERENCES aquaterra_players(email),
  district_id int NOT NULL REFERENCES aquaterra_districts(id),
  spot text NOT NULL DEFAULT 'centre', -- centre | plot | hub:<hub id>
  plot_id int,
  x int NOT NULL DEFAULT 0,
  y int NOT NULL DEFAULT 0,
  trips int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aquaterra_locations_district ON aquaterra_locations (district_id);

CREATE TABLE IF NOT EXISTS aquaterra_trips (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  email text NOT NULL,
  from_district int NOT NULL,
  to_district int NOT NULL,
  legs jsonb NOT NULL,
  fare bigint NOT NULL,
  tax bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS aquaterra_trips_email ON aquaterra_trips (email, id DESC);

CREATE OR REPLACE FUNCTION aquaterra_travel_param(k text) RETURNS bigint LANGUAGE sql STABLE AS
$fn$ SELECT value FROM aquaterra_travel_params WHERE key = k $fn$;

CREATE OR REPLACE FUNCTION aquaterra_travel_tax_pct() RETURNS numeric LANGUAGE sql STABLE AS
$fn$ SELECT greatest(0, least(COALESCE((SELECT value::numeric FROM aquaterra_gov_params WHERE key = 'travel_tax_pct'), 10), 50)) $fn$;

CREATE OR REPLACE FUNCTION aquaterra_travel_fare(m text, dist int) RETURNS bigint LANGUAGE sql STABLE AS
$fn$ SELECT CASE WHEN m = 'walk' THEN 0 ELSE
  aquaterra_travel_param(m || '_base') + floor(dist * aquaterra_travel_param(m || '_per100') / 100.0 + 0.5)::bigint END $fn$;

-- Share of a fare for the State Treasury: at least 1 TIDE while the rate is above zero.
CREATE OR REPLACE FUNCTION aquaterra_travel_tax(amount bigint) RETURNS bigint LANGUAGE sql STABLE AS
$fn$ SELECT CASE WHEN aquaterra_travel_tax_pct() > 0 AND amount > 0
  THEN least(amount, greatest(1, round(amount * aquaterra_travel_tax_pct() / 100)))::bigint ELSE 0 END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_travel_location_json(l aquaterra_locations) RETURNS jsonb LANGUAGE sql STABLE AS
$fn$ SELECT jsonb_build_object('districtId', l.district_id, 'district', (SELECT name FROM aquaterra_districts WHERE id = l.district_id),
  'spot', l.spot, 'plotId', l.plot_id, 'x', l.x, 'y', l.y, 'trips', l.trips, 'since', l.updated_at) $fn$;

-- Where a resident stands. A newcomer is placed in their home district, or in First Light City.
-- For other workflows too (mini-games on plots): aquaterra_player_where(email) -> {districtId, district, spot, plotId, x, y}.
CREATE OR REPLACE FUNCTION aquaterra_player_where(who text) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE l aquaterra_locations; home int;
BEGIN
  SELECT * INTO l FROM aquaterra_locations WHERE email = who;
  IF l.email IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM aquaterra_players WHERE email = who) THEN RETURN NULL; END IF;
    SELECT r.district_id INTO home FROM aquaterra_residents r WHERE r.email = who;
    home := COALESCE(home, (SELECT id FROM aquaterra_districts WHERE capital ORDER BY id LIMIT 1), 0);
    INSERT INTO aquaterra_locations (email, district_id, spot, x, y)
    SELECT who, d.id, 'centre', COALESCE(d.cx, 0), COALESCE(d.cy, 0) FROM aquaterra_districts d WHERE d.id = home
    ON CONFLICT (email) DO NOTHING;
    SELECT * INTO l FROM aquaterra_locations WHERE email = who;
    IF l.email IS NULL THEN RETURN NULL; END IF;
  END IF;
  RETURN aquaterra_travel_location_json(l);
END $fn$;

-- May this resident buy a plot of this district (by name) where they stand now?
-- Open water belongs to no district: it is bought from a district with a harbour.
CREATE OR REPLACE FUNCTION aquaterra_travel_may_buy(who text, plot_district text) RETURNS boolean LANGUAGE plpgsql AS $fn$
DECLARE here int;
BEGIN
  here := (aquaterra_player_where(who)->>'districtId')::int;
  IF here IS NULL THEN RETURN false; END IF;
  IF plot_district = (SELECT name FROM aquaterra_districts WHERE id = here) THEN RETURN true; END IF;
  IF plot_district = 'Open water' OR NOT EXISTS (SELECT 1 FROM aquaterra_districts WHERE name = plot_district) THEN
    RETURN EXISTS (SELECT 1 FROM aquaterra_travel_hubs WHERE kind = 'port' AND district_id = here);
  END IF;
  RETURN false;
END $fn$;

-- travel.json from the live site: hubs, routes, town centres, plot anchors. Run by the hourly sync only.
-- Hubs keep their owner and price; routes and coordinates follow the map. Nothing is deleted unless
-- the file is complete (the world only grows).
CREATE OR REPLACE FUNCTION aquaterra_travel_sync(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE nh int := 0; nr int := 0; nd int := 0; np int := 0;
BEGIN
  IF j IS NULL OR jsonb_typeof(j->'hubs') <> 'array' OR jsonb_array_length(j->'hubs') < 3 OR jsonb_array_length(j->'routes') < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'file');
  END IF;
  WITH src AS (
    SELECT left(e->>0, 40) AS id, e->>1 AS kind, (e->>2)::int AS district_id, left(e->>3, 80) AS name, (e->>4)::int AS x, (e->>5)::int AS y
    FROM jsonb_array_elements(j->'hubs') e WHERE e->>1 IN ('station', 'port', 'airport')
  ), up AS (
    INSERT INTO aquaterra_travel_hubs (id, kind, district_id, name, x, y, price)
    SELECT id, kind, district_id, name, x, y, aquaterra_travel_param('price_' || kind) FROM src
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, x = EXCLUDED.x, y = EXCLUDED.y, synced_at = now()
    WHERE (aquaterra_travel_hubs.name, aquaterra_travel_hubs.x, aquaterra_travel_hubs.y) IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.x, EXCLUDED.y)
    RETURNING 1
  ) SELECT count(*) INTO nh FROM up;
  CREATE TEMP TABLE IF NOT EXISTS aquaterra_travel_src (mode text, a int, b int, dist int) ON COMMIT DROP;
  TRUNCATE aquaterra_travel_src;
  INSERT INTO aquaterra_travel_src
  SELECT e->>0, least((e->>1)::int, (e->>2)::int), greatest((e->>1)::int, (e->>2)::int), greatest(1, (e->>3)::int)
  FROM jsonb_array_elements(j->'routes') e WHERE e->>0 IN ('car', 'train', 'ferry', 'plane') AND (e->>1)::int <> (e->>2)::int;
  WITH up AS (
    INSERT INTO aquaterra_travel_routes (mode, a, b, dist) SELECT DISTINCT ON (mode, a, b) mode, a, b, dist FROM aquaterra_travel_src
    ON CONFLICT (mode, a, b) DO UPDATE SET dist = EXCLUDED.dist, synced_at = now() WHERE aquaterra_travel_routes.dist <> EXCLUDED.dist
    RETURNING 1
  ) SELECT count(*) INTO nr FROM up;
  DELETE FROM aquaterra_travel_routes r WHERE NOT EXISTS (SELECT 1 FROM aquaterra_travel_src s WHERE (s.mode, s.a, s.b) = (r.mode, r.a, r.b));
  UPDATE aquaterra_districts d SET cx = (e->>1)::int, cy = (e->>2)::int
  FROM jsonb_array_elements(COALESCE(j->'centres', '[]'::jsonb)) e
  WHERE d.id = (e->>0)::int AND (d.cx, d.cy) IS DISTINCT FROM ((e->>1)::int, (e->>2)::int);
  GET DIAGNOSTICS nd = ROW_COUNT;
  -- residents who appeared before the centres were known stand at 0,0: move them to their town square
  UPDATE aquaterra_locations l SET x = d.cx, y = d.cy FROM aquaterra_districts d
  WHERE d.id = l.district_id AND l.spot = 'centre' AND d.cx IS NOT NULL AND (l.x, l.y) IS DISTINCT FROM (d.cx, d.cy);
  UPDATE aquaterra_plots p SET ax = (e->>1)::int, ay = (e->>2)::int
  FROM jsonb_array_elements(COALESCE(j->'anchors', '[]'::jsonb)) e
  WHERE p.id = (e->>0)::int AND (p.ax, p.ay) IS DISTINCT FROM ((e->>1)::int, (e->>2)::int);
  GET DIAGNOSTICS np = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'hubs', nh, 'routes', nr, 'centres', nd, 'anchors', np,
    'totalHubs', (SELECT count(*) FROM aquaterra_travel_hubs), 'totalRoutes', (SELECT count(*) FROM aquaterra_travel_routes));
END $fn$;

-- The travel API. req: {action, session, ...}. Returns {ok, ...} or {ok:false, error, status}.
CREATE OR REPLACE FUNCTION aquaterra_travel(req jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  act text := req->>'action';
  me text; my_role text;
  res jsonb := '{}'::jsonb;
  loc aquaterra_locations;
  start_d int; cur int; nxt int; leg jsonb; m text; d int; f bigint; tx bigint; op text; hub aquaterra_travel_hubs;
  total bigint := 0; taxes bigint := 0; out_legs jsonb := '[]'::jsonb; n int := 0; v_plot aquaterra_plots;
  new_spot text; new_plot int; nx int; ny int; v bigint; lid bigint;
BEGIN
  IF COALESCE(req->>'session', '') <> '' THEN
    SELECT p.email, p.role INTO me, my_role
    FROM aquaterra_sessions s JOIN aquaterra_players p ON p.email = s.email
    WHERE s.token_hash = encode(sha256(convert_to(req->>'session', 'UTF8')), 'hex') AND s.expires_at > now();
  END IF;
  IF act <> 'network' AND me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401);
  END IF;

  BEGIN
    IF act = 'network' THEN
      res := jsonb_build_object(
        'fares', (SELECT jsonb_object_agg(key, value) FROM aquaterra_travel_params WHERE key LIKE '%\_base' OR key LIKE '%\_per100'),
        'prices', (SELECT jsonb_object_agg(key, value) FROM aquaterra_travel_params WHERE key LIKE 'price\_%' OR key = 'max_hubs_per_citizen'),
        'taxPct', aquaterra_travel_tax_pct(),
        'hubs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', h.id, 'kind', h.kind, 'district', h.district_id, 'name', h.name, 'x', h.x, 'y', h.y,
                   'price', h.price, 'owner', CASE WHEN h.owner IS NULL THEN NULL ELSE aquaterra_name(h.owner) END, 'mine', h.owner = me,
                   'trips', h.trips, 'revenue', h.revenue) ORDER BY h.id) FROM aquaterra_travel_hubs h), '[]'::jsonb),
        'routes', COALESCE((SELECT jsonb_agg(jsonb_build_array(r.mode, r.a, r.b, r.dist) ORDER BY r.mode, r.a, r.b) FROM aquaterra_travel_routes r), '[]'::jsonb),
        -- how many residents stand in each district (counts only, no names)
        'here', COALESCE((SELECT jsonb_object_agg(district_id::text, c) FROM (SELECT district_id, count(*) AS c FROM aquaterra_locations
                   WHERE updated_at > now() - interval '30 days' GROUP BY district_id) q), '{}'::jsonb));
      IF me IS NOT NULL THEN res := res || jsonb_build_object('me', aquaterra_player_where(me)); END IF;

    ELSIF act = 'where' THEN
      res := jsonb_build_object('me', aquaterra_player_where(me),
        'balance', COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = me), 0),
        'trips', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', t.at, 'from', (SELECT name FROM aquaterra_districts WHERE id = t.from_district),
                   'to', (SELECT name FROM aquaterra_districts WHERE id = t.to_district), 'fare', t.fare, 'tax', t.tax,
                   'modes', (SELECT jsonb_agg(l->>'mode') FROM jsonb_array_elements(t.legs) l)) ORDER BY t.id DESC)
                 FROM (SELECT * FROM aquaterra_trips WHERE email = me ORDER BY id DESC LIMIT 10) t), '[]'::jsonb));

    ELSIF act = 'go' THEN
      PERFORM aquaterra_player_where(me);
      SELECT * INTO loc FROM aquaterra_locations WHERE email = me FOR UPDATE;
      IF jsonb_typeof(req->'legs') <> 'array' OR jsonb_array_length(req->'legs') < 1 OR jsonb_array_length(req->'legs') > 12 THEN RAISE EXCEPTION 'route'; END IF;
      INSERT INTO aquaterra_wallets (account) VALUES (me) ON CONFLICT DO NOTHING;
      start_d := loc.district_id; cur := loc.district_id;
      new_spot := loc.spot; new_plot := loc.plot_id; nx := loc.x; ny := loc.y;
      FOR leg IN SELECT value FROM jsonb_array_elements(req->'legs') LOOP
        n := n + 1;
        m := leg->>'mode';
        IF m = 'walk' THEN
          -- a walk ends the trip: to a plot of this district, or back to the town square
          IF n <> jsonb_array_length(req->'legs') THEN RAISE EXCEPTION 'route'; END IF;
          IF leg ? 'plot' AND leg->>'plot' IS NOT NULL THEN
            SELECT * INTO v_plot FROM aquaterra_plots WHERE id = (leg->>'plot')::int;
            IF v_plot.id IS NULL OR v_plot.ax IS NULL THEN RAISE EXCEPTION 'route'; END IF;
            IF v_plot.district <> (SELECT name FROM aquaterra_districts WHERE id = cur)
               AND NOT (v_plot.district = 'Open water' AND EXISTS (SELECT 1 FROM aquaterra_travel_hubs WHERE kind = 'port' AND district_id = cur)) THEN
              RAISE EXCEPTION 'not_here';
            END IF;
            new_spot := 'plot'; new_plot := v_plot.id; nx := v_plot.ax; ny := v_plot.ay;
          ELSE
            new_spot := 'centre'; new_plot := NULL;
            SELECT COALESCE(cx, 0), COALESCE(cy, 0) INTO nx, ny FROM aquaterra_districts WHERE id = cur;
          END IF;
          out_legs := out_legs || jsonb_build_object('mode', 'walk', 'to', cur, 'plot', new_plot, 'fare', 0, 'tax', 0);
        ELSIF m IN ('car', 'train', 'ferry', 'plane') THEN
          nxt := (leg->>'to')::int;
          SELECT dist INTO d FROM aquaterra_travel_routes WHERE mode = m AND a = least(cur, nxt) AND b = greatest(cur, nxt);
          IF d IS NULL THEN RAISE EXCEPTION 'route'; END IF;
          f := aquaterra_travel_fare(m, d);
          tx := aquaterra_travel_tax(f);
          op := 'state:treasury';
          hub := NULL;
          IF m <> 'car' THEN
            SELECT * INTO hub FROM aquaterra_travel_hubs WHERE id = (CASE m WHEN 'train' THEN 'station' WHEN 'ferry' THEN 'port' ELSE 'airport' END) || ':' || cur;
            IF hub.id IS NULL THEN RAISE EXCEPTION 'route'; END IF;
            op := COALESCE(hub.owner, 'state:treasury');
          END IF;
          IF f - tx > 0 THEN
            IF op = me THEN
              NULL; -- riding from your own station: you pay only the tax
            ELSE
              INSERT INTO aquaterra_wallets (account, welcomed_at) VALUES (op, now()) ON CONFLICT DO NOTHING;
              lid := aquaterra_move(me, op, f - tx, 'fare', NULL,
                left(initcap(m) || ': ' || (SELECT name FROM aquaterra_districts WHERE id = cur) || ' → ' || COALESCE((SELECT name FROM aquaterra_districts WHERE id = nxt), '?'), 120), me);
              UPDATE aquaterra_ledger SET ref = 'travel:' || COALESCE(hub.id, 'road') WHERE id = lid;
            END IF;
          END IF;
          IF tx > 0 THEN
            lid := aquaterra_move(me, 'state:treasury', tx, 'tax', NULL, 'Travel tax', me);
            UPDATE aquaterra_ledger SET ref = 'tax:travel' WHERE id = lid;
          END IF;
          IF hub.id IS NOT NULL THEN
            UPDATE aquaterra_travel_hubs SET trips = trips + 1, revenue = revenue + CASE WHEN op = me THEN 0 ELSE f - tx END WHERE id = hub.id;
          END IF;
          total := total + CASE WHEN op = me THEN tx ELSE f END;
          taxes := taxes + tx;
          out_legs := out_legs || jsonb_build_object('mode', m, 'from', cur, 'to', nxt, 'dist', d, 'fare', CASE WHEN op = me THEN tx ELSE f END, 'tax', tx,
            'operator', CASE WHEN m = 'car' THEN 'State roads' WHEN hub.owner IS NULL THEN 'State Treasury' ELSE aquaterra_name(hub.owner) END);
          cur := nxt;
          IF m = 'car' THEN
            new_spot := 'centre';
            SELECT COALESCE(cx, 0), COALESCE(cy, 0) INTO nx, ny FROM aquaterra_districts WHERE id = cur;
          ELSE
            SELECT 'hub:' || id, x, y INTO new_spot, nx, ny FROM aquaterra_travel_hubs
            WHERE id = (CASE m WHEN 'train' THEN 'station' WHEN 'ferry' THEN 'port' ELSE 'airport' END) || ':' || cur;
            IF new_spot IS NULL THEN
              new_spot := 'centre';
              SELECT COALESCE(cx, 0), COALESCE(cy, 0) INTO nx, ny FROM aquaterra_districts WHERE id = cur;
            END IF;
          END IF;
          new_plot := NULL;
        ELSE
          RAISE EXCEPTION 'route';
        END IF;
      END LOOP;
      UPDATE aquaterra_locations SET district_id = cur, spot = new_spot, plot_id = new_plot, x = nx, y = ny,
        trips = trips + CASE WHEN cur <> start_d THEN 1 ELSE 0 END, updated_at = now()
      WHERE email = me RETURNING * INTO loc;
      IF cur <> start_d OR total > 0 THEN
        INSERT INTO aquaterra_trips (email, from_district, to_district, legs, fare, tax) VALUES (me, start_d, cur, out_legs, total, taxes);
      END IF;
      res := jsonb_build_object('me', aquaterra_travel_location_json(loc), 'legs', out_legs, 'fare', total, 'tax', taxes,
        'balance', (SELECT balance FROM aquaterra_wallets WHERE account = me));

    ELSIF act = 'buy_hub' THEN
      PERFORM aquaterra_player_where(me);
      SELECT * INTO hub FROM aquaterra_travel_hubs WHERE id = req->>'hub' FOR UPDATE;
      IF hub.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      IF hub.owner IS NOT NULL THEN RAISE EXCEPTION 'taken'; END IF;
      IF (SELECT district_id FROM aquaterra_locations WHERE email = me) <> hub.district_id THEN RAISE EXCEPTION 'not_here'; END IF;
      IF (SELECT count(*) FROM aquaterra_travel_hubs WHERE owner = me) >= aquaterra_travel_param('max_hubs_per_citizen') THEN RAISE EXCEPTION 'hub_limit'; END IF;
      INSERT INTO aquaterra_wallets (account) VALUES (me) ON CONFLICT DO NOTHING;
      PERFORM 1 FROM aquaterra_wallets WHERE account = me FOR UPDATE;
      -- welcome coins are for land and travel; transport is bought with earned TIDE
      IF (SELECT balance FROM aquaterra_wallets WHERE account = me) - aquaterra_locked(me) < hub.price THEN RAISE EXCEPTION 'insufficient'; END IF;
      lid := aquaterra_move(me, 'state:treasury', hub.price, 'hub_purchase', NULL, left(hub.name, 120), me);
      UPDATE aquaterra_ledger SET ref = 'hub:' || hub.id WHERE id = lid;
      UPDATE aquaterra_travel_hubs SET owner = me, bought_at = now() WHERE id = hub.id;
      res := jsonb_build_object('hub', hub.id, 'price', hub.price);

    ELSIF act IN ('admin', 'admin_param') THEN
      IF my_role NOT IN ('founder', 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
      IF act = 'admin_param' THEN
        IF my_role <> 'founder' THEN RAISE EXCEPTION 'forbidden'; END IF;
        IF NOT EXISTS (SELECT 1 FROM aquaterra_travel_params WHERE key = req->>'key') THEN RAISE EXCEPTION 'param'; END IF;
        v := (req->>'value')::bigint;
        IF v IS NULL OR v < 0 OR v > 10000000 THEN RAISE EXCEPTION 'amount'; END IF;
        UPDATE aquaterra_travel_params SET value = v WHERE key = req->>'key';
        -- unsold hubs follow the new price
        IF req->>'key' LIKE 'price\_%' THEN
          UPDATE aquaterra_travel_hubs SET price = v WHERE owner IS NULL AND 'price_' || kind = req->>'key';
        END IF;
      END IF;
      res := jsonb_build_object(
        'params', (SELECT jsonb_object_agg(key, value) FROM aquaterra_travel_params),
        'taxPct', aquaterra_travel_tax_pct(),
        'trips', (SELECT count(*) FROM aquaterra_trips),
        'trips24h', (SELECT count(*) FROM aquaterra_trips WHERE at > now() - interval '1 day'),
        'fares', (SELECT COALESCE(sum(fare), 0) FROM aquaterra_trips),
        'taxes', (SELECT COALESCE(sum(tax), 0) FROM aquaterra_trips),
        'travellers', (SELECT count(*) FROM aquaterra_locations),
        'hubs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name, 'kind', h.kind, 'price', h.price,
                   'owner', CASE WHEN h.owner IS NULL THEN NULL ELSE aquaterra_name(h.owner) END, 'trips', h.trips, 'revenue', h.revenue) ORDER BY h.trips DESC, h.id)
                 FROM aquaterra_travel_hubs h), '[]'::jsonb));
    ELSE
      RAISE EXCEPTION 'action';
    END IF;
  EXCEPTION
    WHEN raise_exception THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM,
        'status', CASE SQLERRM WHEN 'forbidden' THEN 403 WHEN 'taken' THEN 409 WHEN 'not_found' THEN 404 ELSE 400 END);
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('ok', false, 'error', 'route', 'status', 400);
  END;

  RETURN jsonb_build_object('ok', true, 'status', 200) || res;
END $fn$;

-- Economy patch: land is bought only where the resident stands.
-- Adds one check to aquaterra_economy() right after the plot is found; does nothing if it is already there.
DO $do$
DECLARE src text; anchor text := 'IF v_plot.id IS NULL THEN RAISE EXCEPTION ''not_for_sale''; END IF;';
BEGIN
  src := pg_get_functiondef('aquaterra_economy(jsonb)'::regprocedure);
  IF position('aquaterra_travel_may_buy' IN src) > 0 THEN RETURN; END IF;
  IF position(anchor IN src) = 0 THEN RAISE EXCEPTION 'economy patch: anchor not found'; END IF;
  src := replace(src, anchor, anchor || E'\n      IF NOT aquaterra_travel_may_buy(me, v_plot.district) THEN RAISE EXCEPTION ''not_here''; END IF;');
  EXECUTE src;
END $do$;
