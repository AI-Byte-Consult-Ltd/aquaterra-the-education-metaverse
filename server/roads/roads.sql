-- AquaTerra World: roads for sale, their wear and repair, and First Light Transit.
-- One-off migration (run once, never per request). Safe to run again.
-- Needs the account, economy, governance, travel and treasury migrations.
-- n8n runs this text: no double dollar quotes (use $fn$), no positional parameters.
--
-- Rules (server-authoritative; the site only asks and shows):
--  * Every car link between two neighbouring districts (aquaterra_travel_routes, mode car)
--    is one road. Unsold roads belong to First Light Transit (wallet 'state:transport'),
--    the state transport company.
--  * Price = road_price_base + road_price_per_tile x length. A resident buys a road with
--    earned TIDE while standing in one of its two districts; road_max_per_citizen at most.
--    The price goes to First Light Transit.
--  * Each car trip: the travel tax goes to the State Treasury as before; the rest of the fare
--    goes to the road's owner (First Light Transit while unsold). Below road_full_income_pct
--    of condition the owner gets a share in proportion; the rest goes to First Light Transit.
--    Driving on your own road costs only the tax.
--  * Condition starts at 100%. It falls by road_decay_day_pct a day and road_wear_trip_pct a trip.
--    Repair: the owner pays road_repair_full_pct of the price for 0 -> 100%, in proportion,
--    to First Light Transit, which does the work.
--  * Below road_auto_repair_pct First Light Transit repairs the road at the owner's cost.
--    If the owner cannot pay, the road returns to First Light Transit; the owner gets
--    road_takeover_refund_pct of the price minus the cost of the repair.
--  * All numbers are laws (aquaterra_gov_params): the Council changes them by vote, the Founder in /admin.
--  * The travel function is not patched: a trigger on aquaterra_trips pays road owners
--    out of the car fares the State Treasury just received.

INSERT INTO aquaterra_gov_params (key, value, min_value, max_value, label) VALUES
  ('road_price_base', 2000, 0, 1000000, 'Roads: base price of a road, TIDE'),
  ('road_price_per_tile', 40, 0, 10000, 'Roads: price per tile of length, TIDE'),
  ('road_max_per_citizen', 3, 0, 50, 'Roads one resident may own'),
  ('road_decay_day_pct', 0.2, 0, 10, 'Roads: wear per day, percent of condition'),
  ('road_wear_trip_pct', 0.1, 0, 10, 'Roads: wear per car trip, percent of condition'),
  ('road_repair_full_pct', 30, 0, 200, 'Roads: cost of a full repair (0 to 100%), percent of the road price'),
  ('road_full_income_pct', 50, 0, 100, 'Roads: condition from which the owner gets the full fare'),
  ('road_auto_repair_pct', 20, 0, 90, 'Roads: condition at which First Light Transit repairs at the owner''s cost'),
  ('road_takeover_refund_pct', 50, 0, 100, 'Roads: share of the price paid back when a road returns to the state')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS aquaterra_roads (
  id text PRIMARY KEY,                 -- 'road:<a>-<b>', a < b (district ids)
  a int NOT NULL,
  b int NOT NULL,
  dist int NOT NULL,
  name text NOT NULL,
  price bigint NOT NULL,
  owner text REFERENCES aquaterra_players(email),
  bought_at timestamptz,
  cond numeric NOT NULL DEFAULT 100,   -- condition, percent, as of cond_at
  cond_at timestamptz NOT NULL DEFAULT now(),
  trips int NOT NULL DEFAULT 0,
  revenue bigint NOT NULL DEFAULT 0,   -- paid to the current owner since they bought it
  repairs bigint NOT NULL DEFAULT 0,   -- paid for repairs by the current owner
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aquaterra_roads_owner ON aquaterra_roads (owner);

INSERT INTO aquaterra_wallets (account, welcomed_at) VALUES ('state:transport', now()) ON CONFLICT DO NOTHING;

-- The company's name in every history (patches aquaterra_name once, like the bank does).
DO $do$
DECLARE src text; anchor text := 'WHEN acct IS NULL THEN NULL';
BEGIN
  src := pg_get_functiondef('aquaterra_name(text)'::regprocedure);
  IF position('state:transport' IN src) > 0 THEN RETURN; END IF;
  IF position(anchor IN src) = 0 THEN RAISE EXCEPTION 'name patch: anchor not found'; END IF;
  src := replace(src, anchor, anchor || E'\n    WHEN acct = ''state:transport'' THEN ''First Light Transit''');
  EXECUTE src;
END $do$;

CREATE OR REPLACE FUNCTION aquaterra_road_law(k text) RETURNS numeric
LANGUAGE sql STABLE AS $fn$ SELECT COALESCE((SELECT value FROM aquaterra_gov_params WHERE key = k), 0) $fn$;

-- Condition now, from the stored condition and the days since.
CREATE OR REPLACE FUNCTION aquaterra_road_cond(r aquaterra_roads) RETURNS numeric
LANGUAGE sql STABLE AS $fn$
  SELECT greatest(0, round(r.cond - extract(epoch FROM now() - r.cond_at) / 86400 * aquaterra_road_law('road_decay_day_pct'), 3))
$fn$;

-- What it costs to bring the road back to 100%.
CREATE OR REPLACE FUNCTION aquaterra_road_repair_cost(r aquaterra_roads) RETURNS bigint
LANGUAGE sql STABLE AS $fn$
  SELECT ceil((100 - aquaterra_road_cond(r)) / 100 * r.price * aquaterra_road_law('road_repair_full_pct') / 100)::bigint
$fn$;

-- Roads follow the car links of the map. Owned roads keep their owner, price and condition.
CREATE OR REPLACE FUNCTION aquaterra_roads_sync() RETURNS int
LANGUAGE plpgsql AS $fn$
DECLARE k int;
BEGIN
  INSERT INTO aquaterra_roads (id, a, b, dist, name, price)
  SELECT 'road:' || r.a || '-' || r.b, r.a, r.b, r.dist,
    left(COALESCE(da.name, '?') || ' – ' || COALESCE(db.name, '?') || ' Road', 120),
    (aquaterra_road_law('road_price_base') + aquaterra_road_law('road_price_per_tile') * r.dist)::bigint
  FROM aquaterra_travel_routes r
  LEFT JOIN aquaterra_districts da ON da.id = r.a
  LEFT JOIN aquaterra_districts db ON db.id = r.b
  WHERE r.mode = 'car'
  ON CONFLICT (id) DO UPDATE SET dist = EXCLUDED.dist, name = EXCLUDED.name, synced_at = now(),
    price = CASE WHEN aquaterra_roads.owner IS NULL THEN EXCLUDED.price ELSE aquaterra_roads.price END;
  GET DIAGNOSTICS k = ROW_COUNT;
  RETURN k;
END $fn$;

-- Store the condition as of now (call with the row locked).
CREATE OR REPLACE FUNCTION aquaterra_road_settle(rid text) RETURNS aquaterra_roads
LANGUAGE plpgsql AS $fn$
DECLARE r aquaterra_roads;
BEGIN
  SELECT * INTO r FROM aquaterra_roads WHERE id = rid FOR UPDATE;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  UPDATE aquaterra_roads SET cond = aquaterra_road_cond(r), cond_at = now() WHERE id = rid RETURNING * INTO r;
  RETURN r;
END $fn$;

-- Below the repair line: First Light Transit repairs. A private owner pays, or loses the road.
CREATE OR REPLACE FUNCTION aquaterra_road_check(rid text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE r aquaterra_roads; cost bigint; refund bigint; free bigint;
BEGIN
  r := aquaterra_road_settle(rid);
  IF r.id IS NULL OR r.cond >= aquaterra_road_law('road_auto_repair_pct') THEN RETURN; END IF;
  cost := aquaterra_road_repair_cost(r);
  IF r.owner IS NULL THEN
    UPDATE aquaterra_roads SET cond = 100, cond_at = now() WHERE id = rid;
    RETURN;
  END IF;
  free := greatest(0, aquaterra_balance(r.owner) - aquaterra_locked(r.owner));
  IF cost <= 0 OR free >= cost THEN
    PERFORM aquaterra_fisc_move(r.owner, 'state:transport', cost, 'road_repair', NULL, 'Repair of ' || r.name || ' by First Light Transit', r.owner, r.id || ':auto');
    UPDATE aquaterra_roads SET cond = 100, cond_at = now(), repairs = repairs + greatest(cost, 0) WHERE id = rid;
    PERFORM aquaterra_notice(r.owner, 'road', format('%s fell below %s%%. First Light Transit repaired it for %s TIDE from your wallet.',
      r.name, aquaterra_road_law('road_auto_repair_pct'), cost));
  ELSE
    refund := greatest(0, floor(r.price * aquaterra_road_law('road_takeover_refund_pct') / 100) - cost)::bigint;
    refund := least(refund, aquaterra_balance('state:transport'));
    PERFORM aquaterra_fisc_move('state:transport', r.owner, refund, 'road_refund', NULL, 'Return of ' || r.name || ' to First Light Transit', NULL, r.id || ':return');
    UPDATE aquaterra_roads SET owner = NULL, bought_at = NULL, revenue = 0, repairs = 0, cond = 100, cond_at = now() WHERE id = rid;
    PERFORM aquaterra_notice(r.owner, 'road', format('%s was not repaired and you had too little TIDE for the repair (%s). It returned to First Light Transit; you received %s TIDE.',
      r.name, cost, refund));
    PERFORM aquaterra_gov_log_add('road', NULL, format('%s returned to First Light Transit: it fell below %s%% and its owner could not pay for the repair.',
      r.name, aquaterra_road_law('road_auto_repair_pct')));
  END IF;
END $fn$;

-- Every tick: roads that have fallen below the repair line.
CREATE OR REPLACE FUNCTION aquaterra_roads_tick() RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE rid text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('aquaterra_roads_tick'));
  IF NOT EXISTS (SELECT 1 FROM aquaterra_roads) OR (SELECT max(synced_at) FROM aquaterra_roads) < now() - interval '1 day' THEN
    PERFORM aquaterra_roads_sync();
  END IF;
  FOR rid IN SELECT id FROM aquaterra_roads x WHERE aquaterra_road_cond(x) < aquaterra_road_law('road_auto_repair_pct') ORDER BY id LOOP
    PERFORM aquaterra_road_check(rid);
  END LOOP;
END $fn$;

-- The Commonwealth tick (every 5 minutes) runs public finance and the roads.
CREATE OR REPLACE FUNCTION aquaterra_gov_collect_land_tax() RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF to_regprocedure('aquaterra_fisc_tick()') IS NOT NULL THEN PERFORM aquaterra_fisc_tick(); END IF;
  IF to_regprocedure('aquaterra_roads_tick()') IS NOT NULL THEN PERFORM aquaterra_roads_tick(); END IF;
END $fn$;

-- After a trip: pay the owners of the roads driven on, and wear the roads.
CREATE OR REPLACE FUNCTION aquaterra_roads_on_trip() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE leg jsonb; r aquaterra_roads; share bigint; pay bigint; full_at numeric;
BEGIN
  FOR leg IN SELECT value FROM jsonb_array_elements(NEW.legs) WHERE value->>'mode' = 'car' LOOP
    r := aquaterra_road_settle('road:' || least((leg->>'from')::int, (leg->>'to')::int) || '-' || greatest((leg->>'from')::int, (leg->>'to')::int));
    IF r.id IS NULL THEN CONTINUE; END IF;
    share := greatest(0, COALESCE((leg->>'fare')::bigint, 0) - COALESCE((leg->>'tax')::bigint, 0));
    pay := 0;
    IF share > 0 THEN
      IF r.owner = NEW.email THEN
        -- your own road: only the tax
        PERFORM aquaterra_fisc_move('state:treasury', NEW.email, share, 'fare', NULL, 'Own road: ' || r.name, NULL, r.id || ':own');
      ELSE
        full_at := aquaterra_road_law('road_full_income_pct');
        pay := CASE WHEN r.owner IS NULL OR full_at <= 0 OR r.cond >= full_at THEN share ELSE floor(share * r.cond / full_at)::bigint END;
        PERFORM aquaterra_fisc_move('state:treasury', COALESCE(r.owner, 'state:transport'), pay, 'fare', NULL, 'Road toll: ' || r.name, NULL, r.id);
        PERFORM aquaterra_fisc_move('state:treasury', 'state:transport', share - pay, 'fare', NULL, 'Road toll (worn road): ' || r.name, NULL, r.id || ':worn');
      END IF;
    END IF;
    UPDATE aquaterra_roads SET trips = trips + 1, revenue = revenue + CASE WHEN owner IS NULL THEN 0 ELSE pay END,
      cond = greatest(0, cond - aquaterra_road_law('road_wear_trip_pct')) WHERE id = r.id;
    PERFORM aquaterra_road_check(r.id);
  END LOOP;
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS aquaterra_roads_on_trip ON aquaterra_trips;
CREATE TRIGGER aquaterra_roads_on_trip AFTER INSERT ON aquaterra_trips FOR EACH ROW EXECUTE FUNCTION aquaterra_roads_on_trip();

CREATE OR REPLACE FUNCTION aquaterra_road_json(r aquaterra_roads, me text) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('id', r.id, 'a', r.a, 'b', r.b, 'dist', r.dist, 'name', r.name, 'price', r.price,
    'owner', CASE WHEN r.owner IS NULL THEN NULL ELSE aquaterra_name(r.owner) END, 'mine', r.owner IS NOT NULL AND r.owner = me,
    'cond', round(aquaterra_road_cond(r), 1), 'repairCost', aquaterra_road_repair_cost(r),
    'trips', r.trips, 'revenue', r.revenue, 'repairs', r.repairs, 'boughtAt', r.bought_at)
$fn$;

-- The roads API. req: {action, session?, road?, pct?}. Returns {ok, ...} or {ok:false, error, status}.
--  list (public): all roads, the laws, First Light Transit; with a session also where I stand.
--  buy {road}, repair {road, pct?: target condition, default 100}.
CREATE OR REPLACE FUNCTION aquaterra_roads(req jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  act text := COALESCE(req->>'action', 'list');
  me text; r aquaterra_roads; here int; cost bigint; target numeric; res jsonb := '{}'::jsonb;
BEGIN
  me := CASE WHEN req ? 'session' THEN aquaterra_gov_session(req->>'session') END;
  BEGIN
    IF act = 'list' THEN
      NULL;
    ELSIF act IN ('buy', 'repair') THEN
      IF me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401); END IF;
      r := aquaterra_road_settle(req->>'road');
      IF r.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      INSERT INTO aquaterra_wallets (account) VALUES (me) ON CONFLICT DO NOTHING;
      PERFORM 1 FROM aquaterra_wallets WHERE account = me FOR UPDATE;
      IF act = 'buy' THEN
        IF r.owner IS NOT NULL THEN RAISE EXCEPTION 'taken'; END IF;
        here := ((aquaterra_player_where(me))->>'districtId')::int;
        IF here IS DISTINCT FROM r.a AND here IS DISTINCT FROM r.b THEN RAISE EXCEPTION 'not_here'; END IF;
        IF (SELECT count(*) FROM aquaterra_roads WHERE owner = me) >= aquaterra_road_law('road_max_per_citizen') THEN RAISE EXCEPTION 'road_limit'; END IF;
        -- welcome coins are for land and travel; roads are bought with earned TIDE
        IF aquaterra_balance(me) - aquaterra_locked(me) < r.price THEN RAISE EXCEPTION 'insufficient'; END IF;
        PERFORM aquaterra_fisc_move(me, 'state:transport', r.price, 'road_purchase', NULL, left('Purchase of ' || r.name, 120), me, r.id || ':buy');
        UPDATE aquaterra_roads SET owner = me, bought_at = now(), revenue = 0, repairs = 0 WHERE id = r.id;
        PERFORM aquaterra_gov_log_add('road', NULL, format('%s bought %s from First Light Transit for %s TIDE.', aquaterra_name(me), r.name, r.price));
        res := jsonb_build_object('road', r.id, 'price', r.price);
      ELSE
        IF r.owner IS DISTINCT FROM me THEN RAISE EXCEPTION 'not_owner'; END IF;
        target := least(100, greatest(0, COALESCE((req->>'pct')::numeric, 100)));
        IF target <= r.cond THEN RAISE EXCEPTION 'repaired'; END IF;
        cost := ceil((target - r.cond) / 100 * r.price * aquaterra_road_law('road_repair_full_pct') / 100)::bigint;
        IF aquaterra_balance(me) - aquaterra_locked(me) < cost THEN RAISE EXCEPTION 'insufficient'; END IF;
        PERFORM aquaterra_fisc_move(me, 'state:transport', cost, 'road_repair', NULL, left('Repair of ' || r.name, 120), me, r.id || ':repair');
        UPDATE aquaterra_roads SET cond = target, cond_at = now(), repairs = repairs + cost WHERE id = r.id;
        res := jsonb_build_object('road', r.id, 'cost', cost, 'cond', target);
      END IF;
    ELSE
      RAISE EXCEPTION 'action';
    END IF;
    RETURN jsonb_build_object('ok', true) || res || jsonb_build_object(
      'roads', COALESCE((SELECT jsonb_agg(aquaterra_road_json(x, me) ORDER BY x.a, x.b) FROM aquaterra_roads x), '[]'::jsonb),
      'laws', (SELECT jsonb_object_agg(key, value) FROM aquaterra_gov_params WHERE key LIKE 'road\_%' OR key = 'travel_tax_pct'),
      'company', jsonb_build_object(
        'balance', aquaterra_balance('state:transport'),
        'roads', (SELECT count(*) FROM aquaterra_roads WHERE owner IS NULL),
        'sold', (SELECT count(*) FROM aquaterra_roads WHERE owner IS NOT NULL),
        'tolls', COALESCE((SELECT sum(amount) FROM aquaterra_ledger WHERE to_account = 'state:transport' AND kind = 'fare'), 0),
        'repairs', COALESCE((SELECT sum(amount) FROM aquaterra_ledger WHERE to_account = 'state:transport' AND kind = 'road_repair'), 0),
        'sales', COALESCE((SELECT sum(amount) FROM aquaterra_ledger WHERE to_account = 'state:transport' AND kind = 'road_purchase'), 0)),
      'here', CASE WHEN me IS NULL THEN NULL ELSE ((aquaterra_player_where(me))->>'districtId')::int END,
      'balance', CASE WHEN me IS NULL THEN NULL ELSE aquaterra_balance(me) - aquaterra_locked(me) END);
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('ok', false, 'error', 'amount', 'status', 400);
    WHEN raise_exception THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM,
        'status', CASE SQLERRM WHEN 'not_found' THEN 404 ELSE 400 END);
  END;
END $fn$;

SELECT aquaterra_roads_sync();
DO $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM aquaterra_gov_log WHERE kind = 'road') THEN
    PERFORM aquaterra_gov_log_add('road', NULL, format('First Light Transit, the state transport company, took charge of %s roads. Residents can now buy a road, earn its tolls and keep it in repair.',
      (SELECT count(*) FROM aquaterra_roads)));
  END IF;
END $fn$;
