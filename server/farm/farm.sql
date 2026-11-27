-- AquaTerra: Farms and the Harvest Market.
-- One-off migration (never per request). Safe to run again.
-- Needs: economy, governance, treasury (income tax trigger on kind income), build (plots and buildings).
-- n8n quirks: no double-dollar quotes (use $fn$), no positional parameters in the text,
-- no dollar sign right before a quote, no apostrophes in comments.
--
--  * An owner plants one crop on a whole plot (works cannot be farmed; water plots take sea farms). The starter
--    house of the map stays as the farmhouse; a building put up by a resident blocks the field.
--  * Seeds are bought from the AquaTerra Reserve (a sink), with free Tide only (welcome Tide is for land).
--  * After the growing time the owner harvests: units go to the barn. A crop left more than
--    farm_wilt_hours after it is ripe gives half.
--  * The barn sells to the Reserve at the base price (kind income: income tax and loan repayments by
--    the treasury trigger), up to farm_reserve_cap Tide a day per resident, so Tide is not printed
--    without limit. Between residents there is no cap: they trade on the Harvest Market.
--  * Harvest Market: limit orders to buy and sell per crop, matched at the price of the resting order.
--    Buy orders hold their Tide in farm:escrow, sell orders hold their units. The seller pays
--    farm_market_tax_pct of every sale to the State Treasury. No trades with yourself.
--  * Balance: seed per tile = hours / 40 Tide and a harvest is worth twice the seed at the Reserve, so
--    a crop harvested on time earns about 0.6 Tide per tile per day before tax: close to the 1% a day
--    a plot pays its owner (median plot 12 tiles, 62 Tide per tile). Long crops suit those who come once a day.

CREATE TABLE IF NOT EXISTS aquaterra_crops (
  key text PRIMARY KEY,
  grp text NOT NULL,                  -- flowers | fruit | vegetables | grain | plantation
  hours int NOT NULL CHECK (hours > 0),
  seed_per_tile numeric NOT NULL,     -- Tide
  yield_per_tile numeric NOT NULL,    -- units
  price numeric NOT NULL,             -- Tide a unit at the Reserve
  sort int NOT NULL DEFAULT 0
);
INSERT INTO aquaterra_crops (key, grp, hours, seed_per_tile, yield_per_tile, price, sort) VALUES
  ('rose', 'flowers', 16, 0.40, 1, 0.80, 10),
  ('tulip', 'flowers', 8, 0.20, 2, 0.20, 11),
  ('sunflower', 'flowers', 6, 0.15, 1, 0.30, 12),
  ('lavender', 'flowers', 12, 0.30, 2, 0.30, 13),
  ('strawberry', 'fruit', 8, 0.20, 2, 0.20, 20),
  ('grape', 'fruit', 16, 0.40, 2, 0.40, 21),
  ('apple', 'fruit', 24, 0.60, 3, 0.40, 22),
  ('orange', 'fruit', 24, 0.60, 3, 0.40, 23),
  ('carrot', 'vegetables', 4, 0.10, 2, 0.10, 30),
  ('potato', 'vegetables', 6, 0.15, 3, 0.10, 31),
  ('tomato', 'vegetables', 6, 0.15, 2, 0.15, 32),
  ('pumpkin', 'vegetables', 12, 0.30, 1, 0.60, 33),
  ('wheat', 'grain', 4, 0.10, 4, 0.05, 40),
  ('tea', 'plantation', 24, 0.60, 2, 0.60, 50),
  ('coffee', 'plantation', 36, 0.90, 1, 1.80, 51)
ON CONFLICT (key) DO NOTHING;

-- Sea farms (2026-11-27): shrimp, mussels and fish grow only on water plots, land crops only on land.
-- Water plots cost 0.4 of land, so a sea farm earns about 0.25 Tide per tile a day (seed = hours / 96).
ALTER TABLE aquaterra_crops ADD COLUMN IF NOT EXISTS water boolean NOT NULL DEFAULT false;
INSERT INTO aquaterra_crops (key, grp, hours, seed_per_tile, yield_per_tile, price, sort, water) VALUES
  ('mussel', 'sea', 12, 0.125, 1, 0.25, 60, true),
  ('shrimp', 'sea', 16, 0.17, 2, 0.17, 61, true),
  ('fish', 'sea', 24, 0.25, 1, 0.50, 62, true)
ON CONFLICT (key) DO NOTHING;

-- Industry (2026-11-27): building materials, ores and Orbit goods share the storehouse (barn), the Reserve
-- and the market with crops. source: farm (can be planted) | industry | orbit. Rows live in server/industry/industry.sql.
ALTER TABLE aquaterra_crops ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'farm';

-- A water plot: its address is Water Plot x-y (the world generator names them so).
CREATE OR REPLACE FUNCTION aquaterra_farm_water(pid int) RETURNS boolean LANGUAGE sql STABLE AS
$fn$ SELECT COALESCE((SELECT address LIKE 'Water Plot %' FROM aquaterra_plots WHERE id = pid), false) $fn$;

CREATE TABLE IF NOT EXISTS aquaterra_farm_fields (
  plot_id int PRIMARY KEY REFERENCES aquaterra_plots (id),
  owner text NOT NULL,
  crop text NOT NULL REFERENCES aquaterra_crops (key),
  units bigint NOT NULL,
  seed_paid bigint NOT NULL,
  planted_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS aquaterra_farm_fields_owner ON aquaterra_farm_fields (owner);

CREATE TABLE IF NOT EXISTS aquaterra_farm_barn (
  email text NOT NULL REFERENCES aquaterra_players (email),
  crop text NOT NULL REFERENCES aquaterra_crops (key),
  units bigint NOT NULL DEFAULT 0 CHECK (units >= 0),
  PRIMARY KEY (email, crop)
);

CREATE TABLE IF NOT EXISTS aquaterra_farm_orders (
  id bigserial PRIMARY KEY,
  email text NOT NULL REFERENCES aquaterra_players (email),
  side text NOT NULL CHECK (side IN ('buy', 'sell')),
  crop text NOT NULL REFERENCES aquaterra_crops (key),
  price numeric(12, 2) NOT NULL CHECK (price > 0),
  qty bigint NOT NULL CHECK (qty > 0),
  qty_left bigint NOT NULL CHECK (qty_left >= 0),
  escrow bigint NOT NULL DEFAULT 0 CHECK (escrow >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS aquaterra_farm_orders_book ON aquaterra_farm_orders (crop, side, price) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS aquaterra_farm_orders_email ON aquaterra_farm_orders (email, status);

CREATE TABLE IF NOT EXISTS aquaterra_farm_trades (
  id bigserial PRIMARY KEY,
  crop text NOT NULL,
  price numeric(12, 2) NOT NULL,
  qty bigint NOT NULL,
  tide bigint NOT NULL,
  tax bigint NOT NULL,
  buyer text NOT NULL,
  seller text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aquaterra_farm_trades_crop ON aquaterra_farm_trades (crop, id DESC);

CREATE TABLE IF NOT EXISTS aquaterra_farm_log (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  kind text NOT NULL,                 -- plant | harvest | clear | reserve | buy | sell
  crop text,
  plot_id int,
  units bigint NOT NULL DEFAULT 0,
  tide bigint NOT NULL DEFAULT 0,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aquaterra_farm_log_email ON aquaterra_farm_log (email, at DESC);

INSERT INTO aquaterra_wallets (account, welcomed_at) VALUES ('farm:escrow', now()) ON CONFLICT DO NOTHING;

INSERT INTO aquaterra_gov_params (key, value, min_value, max_value, label) VALUES
  ('farm_price_pct', 100, 0, 1000, 'Farms: Reserve prices of crops, % of the base price'),
  ('farm_seed_pct', 100, 0, 1000, 'Farms: seed prices, % of the base price'),
  ('farm_reserve_cap', 300, 0, 100000, 'Farms: most Tide a resident may get from the Reserve for crops in a day'),
  ('farm_market_tax_pct', 10, 0, 50, 'Harvest Market: tax on every sale, paid by the seller to the State Treasury'),
  ('farm_wilt_hours', 48, 1, 720, 'Farms: hours a ripe crop waits before it wilts to half'),
  ('farm_max_orders', 20, 1, 200, 'Harvest Market: open orders per resident')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION aquaterra_farm_law(k text) RETURNS numeric LANGUAGE sql STABLE AS
$fn$ SELECT COALESCE((SELECT value FROM aquaterra_gov_params WHERE key = k), 0)::numeric $fn$;

CREATE OR REPLACE FUNCTION aquaterra_farm_price(c text) RETURNS numeric LANGUAGE sql STABLE AS
$fn$ SELECT round(price * aquaterra_farm_law('farm_price_pct') / 100.0, 3) FROM aquaterra_crops WHERE key = c $fn$;

CREATE OR REPLACE FUNCTION aquaterra_farm_seed(c text, tiles int) RETURNS bigint LANGUAGE sql STABLE AS
$fn$ SELECT greatest(1, ceil(seed_per_tile * tiles * aquaterra_farm_law('farm_seed_pct') / 100.0))::bigint FROM aquaterra_crops WHERE key = c $fn$;

CREATE OR REPLACE FUNCTION aquaterra_farm_yield(c text, tiles int) RETURNS bigint LANGUAGE sql STABLE AS
$fn$ SELECT greatest(1, floor(yield_per_tile * tiles))::bigint FROM aquaterra_crops WHERE key = c $fn$;

-- A company of server/industry/industry.sql stands on the plot (false while industry is not installed).
CREATE OR REPLACE FUNCTION aquaterra_farm_works(pid int) RETURNS boolean LANGUAGE plpgsql STABLE AS $fn$
BEGIN
  IF to_regclass('aquaterra_works') IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM aquaterra_works w WHERE w.plot_id = pid);
END $fn$;

-- Why a plot cannot be farmed now: null (it can), land (water or not buildable), building (something stands).
CREATE OR REPLACE FUNCTION aquaterra_farm_block(pid int) RETURNS text LANGUAGE plpgsql STABLE AS $fn$
DECLARE site record; b record;
BEGIN
  IF aquaterra_farm_water(pid) THEN
    IF aquaterra_farm_works(pid) THEN RETURN 'works'; END IF;
    RETURN NULL;   -- sea farm
  END IF;
  SELECT * INTO site FROM aquaterra_build_sites WHERE plot_id = pid;
  IF site.plot_id IS NULL OR NOT site.buildable THEN RETURN 'land'; END IF;
  SELECT * INTO b FROM aquaterra_buildings WHERE plot_id = pid;
  -- The starter house of the map stays as the farmhouse; only a building put up by a resident blocks a field.
  IF b.plot_id IS NOT NULL AND b.kind <> 'empty' THEN RETURN 'building'; END IF;
  -- a company of server/industry/industry.sql stands on the plot
  IF aquaterra_farm_works(pid) THEN RETURN 'works'; END IF;
  RETURN NULL;
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_farm_put(who text, c text, n bigint) RETURNS void LANGUAGE sql AS $fn$
  INSERT INTO aquaterra_farm_barn (email, crop, units) VALUES (who, c, n)
  ON CONFLICT (email, crop) DO UPDATE SET units = aquaterra_farm_barn.units + EXCLUDED.units
$fn$;

-- Close a finished or cancelled order: give back what it still holds.
CREATE OR REPLACE FUNCTION aquaterra_farm_close(oid bigint, st text) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE o record;
BEGIN
  SELECT * INTO o FROM aquaterra_farm_orders WHERE id = oid FOR UPDATE;
  IF o.status <> 'open' THEN RETURN; END IF;
  IF o.side = 'buy' AND o.escrow > 0 THEN
    PERFORM aquaterra_arc_pay('farm:escrow', o.email, o.escrow, 'farm_refund', NULL, 'Harvest Market: order ' || oid || ' returned', o.email, 'farm:refund:' || oid);
  ELSIF o.side = 'sell' AND o.qty_left > 0 THEN
    PERFORM aquaterra_farm_put(o.email, o.crop, o.qty_left);
  END IF;
  UPDATE aquaterra_farm_orders SET status = st, escrow = 0, closed_at = now(),
    qty_left = CASE WHEN st = 'cancelled' THEN qty_left ELSE 0 END WHERE id = oid;
END $fn$;

-- Match a new order against the book, best price first, at the price of the resting order.
CREATE OR REPLACE FUNCTION aquaterra_farm_match(oid bigint) RETURNS int LANGUAGE plpgsql AS $fn$
DECLARE o record; m record; q bigint; v_cost bigint; v_tax bigint; v_buy bigint; v_sell bigint;
  v_buyer text; v_seller text; v_esc bigint; tid bigint; fills int := 0;
BEGIN
  LOOP
    SELECT * INTO o FROM aquaterra_farm_orders WHERE id = oid FOR UPDATE;
    EXIT WHEN o.status <> 'open' OR o.qty_left < 1;
    IF o.side = 'buy' THEN
      SELECT * INTO m FROM aquaterra_farm_orders WHERE crop = o.crop AND side = 'sell' AND status = 'open'
        AND email <> o.email AND price <= o.price ORDER BY price, id LIMIT 1 FOR UPDATE;
    ELSE
      SELECT * INTO m FROM aquaterra_farm_orders WHERE crop = o.crop AND side = 'buy' AND status = 'open'
        AND email <> o.email AND price >= o.price ORDER BY price DESC, id LIMIT 1 FOR UPDATE;
    END IF;
    EXIT WHEN NOT FOUND;
    q := least(o.qty_left, m.qty_left);
    IF o.side = 'buy' THEN v_buy := o.id; v_sell := m.id; v_buyer := o.email; v_seller := m.email; v_esc := o.escrow;
    ELSE v_buy := m.id; v_sell := o.id; v_buyer := m.email; v_seller := o.email; v_esc := m.escrow; END IF;
    v_cost := least(ceil(q * m.price), v_esc)::bigint;
    v_tax := round(v_cost * greatest(0, least(aquaterra_farm_law('farm_market_tax_pct'), 50)) / 100.0)::bigint;
    INSERT INTO aquaterra_farm_trades (crop, price, qty, tide, tax, buyer, seller)
    VALUES (o.crop, m.price, q, v_cost, v_tax, v_buyer, v_seller) RETURNING id INTO tid;
    IF v_cost - v_tax > 0 THEN
      PERFORM aquaterra_arc_pay('farm:escrow', v_seller, v_cost - v_tax, 'farm_trade', NULL,
        'Harvest Market: sold ' || q || ' ' || o.crop || ' to ' || aquaterra_name(v_buyer), v_seller, 'farm:trade:' || tid);
    END IF;
    IF v_tax > 0 THEN
      PERFORM aquaterra_arc_pay('farm:escrow', 'state:treasury', v_tax, 'tax', NULL, 'Harvest Market tax', v_seller, 'farm:tax:' || tid);
    END IF;
    PERFORM aquaterra_farm_put(v_buyer, o.crop, q);
    UPDATE aquaterra_farm_orders SET qty_left = qty_left - q, escrow = escrow - v_cost WHERE id = v_buy;
    UPDATE aquaterra_farm_orders SET qty_left = qty_left - q WHERE id = v_sell;
    INSERT INTO aquaterra_farm_log (email, kind, crop, units, tide) VALUES (v_buyer, 'buy', o.crop, q, v_cost), (v_seller, 'sell', o.crop, q, v_cost - v_tax);
    IF (SELECT qty_left FROM aquaterra_farm_orders WHERE id = v_buy) = 0 THEN PERFORM aquaterra_farm_close(v_buy, 'done'); END IF;
    IF (SELECT qty_left FROM aquaterra_farm_orders WHERE id = v_sell) = 0 THEN PERFORM aquaterra_farm_close(v_sell, 'done'); END IF;
    fills := fills + 1;
    EXIT WHEN fills >= 200;
  END LOOP;
  RETURN fills;
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_farm_book(c text) RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('crop', c,
    'asks', COALESCE((SELECT jsonb_agg(jsonb_build_array(x.price, x.qty) ORDER BY x.price) FROM (SELECT price, sum(qty_left) AS qty FROM aquaterra_farm_orders
      WHERE crop = c AND side = 'sell' AND status = 'open' GROUP BY price ORDER BY price LIMIT 12) x), '[]'::jsonb),
    'bids', COALESCE((SELECT jsonb_agg(jsonb_build_array(x.price, x.qty) ORDER BY x.price DESC) FROM (SELECT price, sum(qty_left) AS qty FROM aquaterra_farm_orders
      WHERE crop = c AND side = 'buy' AND status = 'open' GROUP BY price ORDER BY price DESC LIMIT 12) x), '[]'::jsonb),
    'trades', COALESCE((SELECT jsonb_agg(jsonb_build_array(t.price, t.qty, t.at) ORDER BY t.id DESC) FROM (SELECT * FROM aquaterra_farm_trades
      WHERE crop = c ORDER BY id DESC LIMIT 20) t), '[]'::jsonb))
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_farm(req jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  act text := coalesce(req->>'action', '');
  me text; res jsonb := '{}'::jsonb;
  today date := (now() AT TIME ZONE 'utc')::date;
  pid int; v_plot record; f record; v_crop text; v_seed bigint; v_units bigint; v_n int; v_tide bigint;
  v_price numeric; v_have bigint; v_left bigint; v_qty bigint; v_side text; oid bigint; v_txt text;
BEGIN
  IF coalesce(req->>'session', '') <> '' THEN
    SELECT s.email INTO me FROM aquaterra_sessions s
    WHERE s.token_hash = encode(sha256(convert_to(req->>'session', 'UTF8')), 'hex') AND s.expires_at > now();
  END IF;
  -- Companies on plots, materials and Orbit shipments: server/industry/industry.sql, same webhook.
  IF act IN ('works', 'setup', 'produce', 'dismantle', 'ship') THEN RETURN aquaterra_industry(req); END IF;
  IF act NOT IN ('market', 'book', 'fields') AND me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401);
  END IF;
  v_crop := left(coalesce(req->>'crop', ''), 20);

  BEGIN
    IF act = 'market' THEN
      NULL;

    ELSIF act = 'book' THEN
      IF NOT EXISTS (SELECT 1 FROM aquaterra_crops WHERE key = v_crop) THEN RAISE EXCEPTION 'crop'; END IF;
      res := jsonb_build_object('book', aquaterra_farm_book(v_crop));

    ELSIF act = 'me' THEN
      NULL;

    ELSIF act = 'fields' THEN
      -- public: what grows where, for the world map (plot, crop, planted, ripe, in unix seconds)
      res := jsonb_build_object('wiltHours', aquaterra_farm_law('farm_wilt_hours'), 'now', floor(extract(epoch FROM now())),
        'fields', COALESCE((SELECT jsonb_agg(jsonb_build_array(ff.plot_id, ff.crop,
            floor(extract(epoch FROM ff.planted_at)), floor(extract(epoch FROM ff.ready_at))) ORDER BY ff.plot_id)
          FROM aquaterra_farm_fields ff), '[]'::jsonb));

    ELSIF act = 'plant' THEN
      pid := CASE WHEN coalesce(req->>'plotId', '') ~ '^[0-9]' AND length(req->>'plotId') <= 9 AND (req->>'plotId') !~ '[^0-9]' THEN (req->>'plotId')::int END;
      SELECT p.* INTO v_plot FROM aquaterra_plots p WHERE p.id = pid;
      IF v_plot.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      PERFORM 1 FROM aquaterra_plot_owners WHERE plot_id = pid AND owner = me FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'not_owner'; END IF;
      IF NOT EXISTS (SELECT 1 FROM aquaterra_crops WHERE key = v_crop AND source = 'farm') THEN RAISE EXCEPTION 'crop'; END IF;
      v_txt := aquaterra_farm_block(pid);
      IF v_txt IS NOT NULL THEN RAISE EXCEPTION '%', v_txt; END IF;
      IF (SELECT water FROM aquaterra_crops WHERE key = v_crop) IS DISTINCT FROM aquaterra_farm_water(pid) THEN RAISE EXCEPTION 'place'; END IF;
      SELECT * INTO f FROM aquaterra_farm_fields WHERE plot_id = pid FOR UPDATE;
      IF f.plot_id IS NOT NULL THEN
        IF f.owner = me THEN RAISE EXCEPTION 'planted'; END IF;
        DELETE FROM aquaterra_farm_fields WHERE plot_id = pid;   -- left by an earlier owner
      END IF;
      v_seed := aquaterra_farm_seed(v_crop, v_plot.tiles);
      IF aquaterra_arc_free(me) < v_seed THEN RAISE EXCEPTION 'insufficient'; END IF;
      PERFORM aquaterra_arc_pay(me, 'treasury', v_seed, 'farm_seed', pid, 'Farm: ' || v_crop || ' seeds for ' || v_plot.address, me,
        'farm:seed:' || pid || ':' || extract(epoch FROM clock_timestamp()));
      INSERT INTO aquaterra_farm_fields (plot_id, owner, crop, units, seed_paid, ready_at)
      SELECT pid, me, v_crop, aquaterra_farm_yield(v_crop, v_plot.tiles), v_seed, now() + make_interval(hours => c.hours)
      FROM aquaterra_crops c WHERE c.key = v_crop;
      INSERT INTO aquaterra_farm_log (email, kind, crop, plot_id, units, tide) VALUES (me, 'plant', v_crop, pid, 0, v_seed);
      res := jsonb_build_object('planted', pid, 'seed', v_seed);

    ELSIF act = 'harvest' THEN
      -- One plot, or every ripe field of mine.
      pid := CASE WHEN coalesce(req->>'plotId', '') ~ '^[0-9]' AND length(req->>'plotId') <= 9 AND (req->>'plotId') !~ '[^0-9]' THEN (req->>'plotId')::int END;
      v_n := 0; v_units := 0; v_left := 0;
      FOR f IN SELECT ff.* FROM aquaterra_farm_fields ff JOIN aquaterra_plot_owners o ON o.plot_id = ff.plot_id AND o.owner = me
          WHERE ff.ready_at <= now() AND (pid IS NULL OR ff.plot_id = pid) ORDER BY ff.plot_id FOR UPDATE OF ff LOOP
        DELETE FROM aquaterra_farm_fields WHERE plot_id = f.plot_id;
        -- a building put up on the field since planting destroyed it
        IF aquaterra_farm_block(f.plot_id) IS NOT NULL THEN v_left := v_left + 1; CONTINUE; END IF;
        v_qty := CASE WHEN now() > f.ready_at + make_interval(hours => aquaterra_farm_law('farm_wilt_hours')::int)
          THEN greatest(1, f.units / 2) ELSE f.units END;
        PERFORM aquaterra_farm_put(me, f.crop, v_qty);
        INSERT INTO aquaterra_farm_log (email, kind, crop, plot_id, units) VALUES (me, 'harvest', f.crop, f.plot_id, v_qty);
        v_n := v_n + 1; v_units := v_units + v_qty;
      END LOOP;
      IF v_n = 0 AND v_left = 0 THEN RAISE EXCEPTION 'not_ripe'; END IF;
      res := jsonb_build_object('harvested', v_n, 'units', v_units, 'destroyed', v_left);

    ELSIF act = 'clear' THEN
      -- Dig up a field before it is ripe: the seeds are lost.
      pid := CASE WHEN coalesce(req->>'plotId', '') ~ '^[0-9]' AND length(req->>'plotId') <= 9 AND (req->>'plotId') !~ '[^0-9]' THEN (req->>'plotId')::int END;
      DELETE FROM aquaterra_farm_fields ff USING aquaterra_plot_owners o
      WHERE ff.plot_id = pid AND o.plot_id = ff.plot_id AND o.owner = me RETURNING ff.crop INTO v_txt;
      IF v_txt IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      INSERT INTO aquaterra_farm_log (email, kind, crop, plot_id) VALUES (me, 'clear', v_txt, pid);
      res := jsonb_build_object('cleared', pid);

    ELSIF act = 'reserve' THEN
      -- Sell units of one crop to the AquaTerra Reserve (all when units is not given), within the daily cap.
      SELECT units INTO v_have FROM aquaterra_farm_barn WHERE email = me AND crop = v_crop FOR UPDATE;
      IF coalesce(v_have, 0) < 1 THEN RAISE EXCEPTION 'nothing'; END IF;
      v_units := CASE WHEN coalesce(req->>'units', '') ~ '^[0-9]' AND length(req->>'units') <= 12 AND (req->>'units') !~ '[^0-9]'
        THEN (req->>'units')::bigint ELSE v_have END;
      IF v_units < 1 OR v_units > v_have THEN RAISE EXCEPTION 'units'; END IF;
      v_price := aquaterra_farm_price(v_crop);
      IF v_price <= 0 THEN RAISE EXCEPTION 'too_little'; END IF;
      v_left := greatest(0, aquaterra_farm_law('farm_reserve_cap')::bigint - COALESCE((SELECT sum(tide) FROM aquaterra_farm_log
        WHERE email = me AND kind = 'reserve' AND at >= (today::timestamp AT TIME ZONE 'utc')), 0));
      IF v_left < 1 THEN RAISE EXCEPTION 'cap'; END IF;
      v_qty := v_units;
      v_units := least(v_units, floor(v_left / v_price)::bigint);
      v_tide := floor(v_units * v_price)::bigint;
      IF v_tide < 1 THEN RAISE EXCEPTION '%', CASE WHEN v_units < v_qty THEN 'cap' ELSE 'too_little' END; END IF;
      v_units := least(v_units, ceil(v_tide / v_price)::bigint);   -- only whole Tide is paid
      UPDATE aquaterra_farm_barn SET units = units - v_units WHERE email = me AND crop = v_crop;
      PERFORM aquaterra_arc_pay('treasury', me, v_tide, 'income', NULL, 'Farm: sold ' || v_units || ' ' || v_crop || ' to the Reserve', me,
        'farm:reserve:' || me || ':' || extract(epoch FROM clock_timestamp()));
      INSERT INTO aquaterra_farm_log (email, kind, crop, units, tide) VALUES (me, 'reserve', v_crop, v_units, v_tide);
      res := jsonb_build_object('sold', v_units, 'crop', v_crop, 'tide', v_tide,
        'taxPct', COALESCE((SELECT value FROM aquaterra_gov_params WHERE key = 'income_tax_pct'), 0));

    ELSIF act = 'order' THEN
      v_side := req->>'side';
      IF v_side IS NULL OR v_side NOT IN ('buy', 'sell') THEN RAISE EXCEPTION 'side'; END IF;
      IF NOT EXISTS (SELECT 1 FROM aquaterra_crops WHERE key = v_crop) THEN RAISE EXCEPTION 'crop'; END IF;
      v_txt := coalesce(req->>'price', '');
      IF v_txt !~ '^[0-9]' OR v_txt ~ '[^0-9.]' OR v_txt ~ '[.].*[.]' OR length(v_txt) > 9 THEN RAISE EXCEPTION 'price'; END IF;
      v_price := round(v_txt::numeric, 2);
      IF v_price < 0.01 OR v_price > 100000 THEN RAISE EXCEPTION 'price'; END IF;
      v_qty := CASE WHEN coalesce(req->>'qty', '') ~ '^[0-9]' AND length(req->>'qty') <= 9 AND (req->>'qty') !~ '[^0-9]' THEN (req->>'qty')::bigint END;
      IF v_qty IS NULL OR v_qty < 1 OR v_qty > 10000000 THEN RAISE EXCEPTION 'units'; END IF;
      IF (SELECT count(*) FROM aquaterra_farm_orders WHERE email = me AND status = 'open') >= aquaterra_farm_law('farm_max_orders') THEN
        RAISE EXCEPTION 'too_many';
      END IF;
      IF v_side = 'sell' THEN
        UPDATE aquaterra_farm_barn SET units = units - v_qty WHERE email = me AND crop = v_crop AND units >= v_qty;
        IF NOT FOUND THEN RAISE EXCEPTION 'nothing'; END IF;
        INSERT INTO aquaterra_farm_orders (email, side, crop, price, qty, qty_left) VALUES (me, 'sell', v_crop, v_price, v_qty, v_qty) RETURNING id INTO oid;
      ELSE
        v_tide := ceil(v_qty * v_price)::bigint;
        IF aquaterra_arc_free(me) < v_tide THEN RAISE EXCEPTION 'insufficient'; END IF;
        INSERT INTO aquaterra_farm_orders (email, side, crop, price, qty, qty_left, escrow) VALUES (me, 'buy', v_crop, v_price, v_qty, v_qty, v_tide) RETURNING id INTO oid;
        PERFORM aquaterra_arc_pay(me, 'farm:escrow', v_tide, 'farm_escrow', NULL, 'Harvest Market: buy order ' || oid, me, 'farm:escrow:' || oid);
      END IF;
      v_n := aquaterra_farm_match(oid);
      res := jsonb_build_object('orderId', oid, 'fills', v_n, 'book', aquaterra_farm_book(v_crop),
        'status', (SELECT status FROM aquaterra_farm_orders WHERE id = oid));

    ELSIF act = 'cancel' THEN
      oid := CASE WHEN coalesce(req->>'orderId', '') ~ '^[0-9]' AND length(req->>'orderId') <= 15 AND (req->>'orderId') !~ '[^0-9]' THEN (req->>'orderId')::bigint END;
      IF NOT EXISTS (SELECT 1 FROM aquaterra_farm_orders WHERE id = oid AND email = me AND status = 'open') THEN RAISE EXCEPTION 'not_found'; END IF;
      PERFORM aquaterra_farm_close(oid, 'cancelled');
      res := jsonb_build_object('cancelled', oid);

    ELSE
      RAISE EXCEPTION 'action';
    END IF;

    IF act IN ('market', 'me', 'plant', 'harvest', 'clear', 'reserve', 'order', 'cancel') THEN
      res := res || jsonb_build_object(
        'crops', (SELECT jsonb_agg(jsonb_build_object('key', c.key, 'group', c.grp, 'water', c.water, 'source', c.source, 'hours', c.hours,
            'seedPerTile', round(c.seed_per_tile * aquaterra_farm_law('farm_seed_pct') / 100.0, 4), 'yieldPerTile', c.yield_per_tile,
            'price', aquaterra_farm_price(c.key),
            'bid', (SELECT max(price) FROM aquaterra_farm_orders WHERE crop = c.key AND side = 'buy' AND status = 'open'),
            'ask', (SELECT min(price) FROM aquaterra_farm_orders WHERE crop = c.key AND side = 'sell' AND status = 'open'),
            'last', (SELECT price FROM aquaterra_farm_trades WHERE crop = c.key ORDER BY id DESC LIMIT 1),
            'volume', COALESCE((SELECT sum(qty) FROM aquaterra_farm_trades WHERE crop = c.key AND at > now() - interval '1 day'), 0))
          ORDER BY c.sort) FROM aquaterra_crops c),
        'laws', jsonb_build_object('marketTaxPct', aquaterra_farm_law('farm_market_tax_pct'), 'reserveCap', aquaterra_farm_law('farm_reserve_cap'),
          'wiltHours', aquaterra_farm_law('farm_wilt_hours'), 'maxOrders', aquaterra_farm_law('farm_max_orders'),
          'incomeTaxPct', aquaterra_farm_law('income_tax_pct')),
        'fields', (SELECT count(*) FROM aquaterra_farm_fields), 'farmers', (SELECT count(DISTINCT owner) FROM aquaterra_farm_fields));
    END IF;
    IF me IS NOT NULL AND act <> 'book' THEN
      res := res || jsonb_build_object(
        'plots', COALESCE((SELECT jsonb_agg(jsonb_build_object('plotId', p.id, 'address', p.address, 'district', p.district, 'tiles', p.tiles,
            'water', aquaterra_farm_water(p.id), 'block', aquaterra_farm_block(p.id),
            'field', CASE WHEN ff.plot_id IS NOT NULL AND ff.owner = me THEN jsonb_build_object('crop', ff.crop, 'units', ff.units, 'plantedAt', ff.planted_at,
              'readyAt', ff.ready_at, 'wiltsAt', ff.ready_at + make_interval(hours => aquaterra_farm_law('farm_wilt_hours')::int)) END)
            ORDER BY (ff.plot_id IS NULL), (aquaterra_farm_block(p.id) IS NOT NULL), ff.ready_at, p.id)
          FROM aquaterra_plot_owners o JOIN aquaterra_plots p ON p.id = o.plot_id LEFT JOIN aquaterra_farm_fields ff ON ff.plot_id = p.id
          WHERE o.owner = me), '[]'::jsonb),
        'barn', COALESCE((SELECT jsonb_agg(jsonb_build_object('crop', b.crop, 'units', b.units, 'price', aquaterra_farm_price(b.crop),
            'value', floor(b.units * aquaterra_farm_price(b.crop))) ORDER BY b.crop) FROM aquaterra_farm_barn b WHERE b.email = me AND b.units > 0), '[]'::jsonb),
        'orders', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'side', o.side, 'crop', o.crop, 'price', o.price, 'qty', o.qty,
            'left', o.qty_left, 'at', o.created_at) ORDER BY o.id DESC) FROM aquaterra_farm_orders o WHERE o.email = me AND o.status = 'open'), '[]'::jsonb),
        'log', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', l.kind, 'crop', l.crop, 'units', l.units, 'tide', l.tide, 'at', l.at) ORDER BY l.id DESC)
          FROM (SELECT * FROM aquaterra_farm_log WHERE email = me ORDER BY id DESC LIMIT 20) l), '[]'::jsonb),
        'reserveToday', COALESCE((SELECT sum(tide) FROM aquaterra_farm_log WHERE email = me AND kind = 'reserve' AND at >= (today::timestamp AT TIME ZONE 'utc')), 0),
        'balance', aquaterra_balance(me), 'free', aquaterra_arc_free(me));
    END IF;
    RETURN jsonb_build_object('ok', true) || res;
  EXCEPTION WHEN raise_exception OR check_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM,
      'status', CASE SQLERRM WHEN 'not_found' THEN 404 ELSE 400 END);
  END;
END $fn$;
