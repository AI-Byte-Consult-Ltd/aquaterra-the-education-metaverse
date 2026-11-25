-- AquaTerra World: residents build on their own plots for Tide.
-- One-off migration (run once, never per request). Safe to run again.
-- Needs the tables of the account, economy and governance workflows.
-- n8n runs this text: no double dollar quotes (use $fn$), no positional parameters.
--
-- Rules (server-authoritative; the site only shows and asks):
--  * Only the owner of a plot builds on it. Water and mountain plots take no building.
--  * A cottage (1-2 floors) can stand on any buildable plot. A skyscraper needs a
--    plot of 2,000 m2 or more (5 tiles) and grows by levels:
--    foundation -> 10 -> 30 -> 60 floors. Each level is paid, takes hours to build,
--    and the next level starts only when the last one is finished.
--  * Every construction pays its cost to the AquaTerra Reserve and a building permit
--    fee (permit_pct of the cost) to the State Treasury.
--  * Finished buildings earn Tide every day from the Reserve; unclaimed income stops
--    growing after income_cap_days. Of every payout, the income tax (a law of the
--    Commonwealth, income_tax_pct) plus tower_tax_step_pct per tower level above 10
--    floors goes to the State Treasury: taller pays more and earns more.
--  * In the city centre no building may be taller than centre_height_floors, a law
--    of the Commonwealth changed by vote (/state).
--  * The owner can demolish (small fee), sell the building back to the Reserve
--    (sell_back_pct of what was invested on it), or replace it with another.
--  * Plots without a row here show the starter building of the map (a cottage,
--    a works building, or nothing). 'empty' means it was cleared.

CREATE TABLE IF NOT EXISTS aquaterra_build_params (
  key text PRIMARY KEY,
  value bigint NOT NULL,
  note text
);
INSERT INTO aquaterra_build_params (key, value, note) VALUES
  ('cottage_cost', 400, 'Cottage (1-2 floors): construction cost, TIDE'),
  ('tower_cost_0', 1500, 'Skyscraper foundation: construction cost, TIDE'),
  ('tower_cost_1', 3000, 'Skyscraper to 10 floors: construction cost, TIDE'),
  ('tower_cost_2', 8000, 'Skyscraper to 30 floors: construction cost, TIDE'),
  ('tower_cost_3', 20000, 'Skyscraper to 60 floors: construction cost, TIDE'),
  ('permit_pct', 10, 'Building permit fee, percent of the construction cost, to the State Treasury'),
  ('demolish_cost', 20, 'Demolition fee, TIDE'),
  ('sell_back_pct', 50, 'The Reserve buys a building back for this percent of what was invested'),
  ('cottage_income', 4, 'Cottage: income, TIDE a day'),
  ('tower_income_1', 30, 'Skyscraper of 10 floors: income, TIDE a day'),
  ('tower_income_2', 100, 'Skyscraper of 30 floors: income, TIDE a day'),
  ('tower_income_3', 260, 'Skyscraper of 60 floors: income, TIDE a day'),
  ('income_cap_days', 7, 'Unclaimed building income stops growing after this many days'),
  ('tower_tax_step_pct', 2, 'Extra income tax per skyscraper level above 10 floors, percent'),
  ('hours_cottage', 1, 'Hours to build a cottage'),
  ('hours_0', 2, 'Hours to lay a foundation'),
  ('hours_1', 6, 'Hours to build up to 10 floors'),
  ('hours_2', 12, 'Hours to build up to 30 floors'),
  ('hours_3', 24, 'Hours to build up to 60 floors'),
  ('max_towers_per_citizen', 5, 'Skyscrapers one resident may own')
ON CONFLICT (key) DO NOTHING;

-- Laws of the Commonwealth: they live with the other state numbers and change by vote.
INSERT INTO aquaterra_gov_params (key, value, min_value, max_value, label) VALUES
  ('centre_height_floors', 60, 0, 60, 'Highest building allowed in the city centre, floors'),
  ('income_tax_pct', 10, 0, 50, 'Income tax, percent of every building payout, to the State Treasury')
ON CONFLICT (key) DO NOTHING;

-- What the map allows on each plot (from world/build-sites.json, synced hourly).
CREATE TABLE IF NOT EXISTS aquaterra_build_sites (
  plot_id int PRIMARY KEY,
  buildable boolean NOT NULL,
  tower_ok boolean NOT NULL,
  centre boolean NOT NULL,
  starter text NOT NULL DEFAULT 'none',   -- none | cottage | works
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aquaterra_buildings (
  plot_id int PRIMARY KEY REFERENCES aquaterra_plots (id),
  kind text NOT NULL CHECK (kind IN ('cottage', 'tower', 'empty')),
  level int NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 3),
  design int NOT NULL DEFAULT 0,
  invested bigint NOT NULL DEFAULT 0,
  ready_at timestamptz NOT NULL DEFAULT now(),
  income_from timestamptz NOT NULL DEFAULT now(),
  built_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aquaterra_build_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  plot_id int NOT NULL,
  actor text,
  action text NOT NULL,        -- build | upgrade | demolish | sell | collect
  kind text,
  level int,
  cost bigint NOT NULL DEFAULT 0,
  fee bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS aquaterra_build_log_plot ON aquaterra_build_log (plot_id, id DESC);

CREATE OR REPLACE FUNCTION aquaterra_build_param(k text) RETURNS bigint LANGUAGE sql STABLE AS
$fn$ SELECT value FROM aquaterra_build_params WHERE key = k $fn$;

CREATE OR REPLACE FUNCTION aquaterra_build_law(k text, dflt numeric) RETURNS numeric LANGUAGE sql STABLE AS
$fn$ SELECT COALESCE((SELECT value FROM aquaterra_gov_params WHERE key = k), dflt) $fn$;

CREATE OR REPLACE FUNCTION aquaterra_build_floors(kind text, level int) RETURNS int LANGUAGE sql IMMUTABLE AS
$fn$ SELECT CASE WHEN kind = 'cottage' THEN 2 WHEN kind = 'tower' THEN (ARRAY[0, 10, 30, 60])[level + 1] ELSE 0 END $fn$;

-- TIDE a day a finished building earns.
CREATE OR REPLACE FUNCTION aquaterra_build_rate(kind text, level int) RETURNS bigint LANGUAGE sql STABLE AS
$fn$ SELECT CASE WHEN kind = 'cottage' THEN aquaterra_build_param('cottage_income')
  WHEN kind = 'tower' AND level >= 1 THEN aquaterra_build_param('tower_income_' || level) ELSE 0 END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_build_tax_pct(kind text, level int) RETURNS numeric LANGUAGE sql STABLE AS
$fn$ SELECT greatest(0, least(50, aquaterra_build_law('income_tax_pct', 10)
  + CASE WHEN kind = 'tower' AND level > 1 THEN (level - 1) * aquaterra_build_param('tower_tax_step_pct') ELSE 0 END)) $fn$;

CREATE OR REPLACE FUNCTION aquaterra_build_pending(b aquaterra_buildings) RETURNS bigint LANGUAGE sql STABLE AS
$fn$ SELECT CASE WHEN b.kind = 'empty' OR b.ready_at > now() THEN 0 ELSE
  floor(aquaterra_build_rate(b.kind, b.level) * least(extract(epoch FROM now() - greatest(b.income_from, b.ready_at)) / 86400.0,
    aquaterra_build_param('income_cap_days')::numeric))::bigint END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_build_public(b aquaterra_buildings) RETURNS jsonb LANGUAGE sql STABLE AS
$fn$ SELECT jsonb_build_array(b.plot_id, b.kind, b.level, b.design, floor(extract(epoch FROM b.ready_at))::bigint) $fn$;

-- Pay and tag the ledger row. Raises 'insufficient' and friends.
CREATE OR REPLACE FUNCTION aquaterra_build_pay(src text, dst text, amt bigint, k text, plot int, note text, who text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE lid bigint;
BEGIN
  IF amt IS NULL OR amt <= 0 THEN RETURN; END IF;
  INSERT INTO aquaterra_wallets (account, welcomed_at) VALUES (dst, now()) ON CONFLICT DO NOTHING;
  lid := aquaterra_move(src, dst, amt, k, plot, left(note, 120), who);
  UPDATE aquaterra_ledger SET ref = 'build:' || plot WHERE id = lid;
END $fn$;

-- Pay out what one building has earned, with the tax to the State Treasury. Returns the net amount.
CREATE OR REPLACE FUNCTION aquaterra_build_collect(pid int, who text) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE b aquaterra_buildings; gross bigint; tax bigint; addr text;
BEGIN
  SELECT * INTO b FROM aquaterra_buildings WHERE plot_id = pid FOR UPDATE;
  IF b.plot_id IS NULL THEN RETURN jsonb_build_object('gross', 0, 'tax', 0, 'net', 0); END IF;
  gross := aquaterra_build_pending(b);
  IF gross < 1 THEN RETURN jsonb_build_object('gross', 0, 'tax', 0, 'net', 0); END IF;
  tax := round(gross * aquaterra_build_tax_pct(b.kind, b.level) / 100.0);
  SELECT address INTO addr FROM aquaterra_plots WHERE id = pid;
  PERFORM aquaterra_build_pay('treasury', who, gross - tax, 'building_income', pid, 'Building income, ' || COALESCE(addr, ''), who);
  PERFORM aquaterra_build_pay('treasury', 'state:treasury', tax, 'tax', pid, 'Income tax, ' || COALESCE(addr, ''), who);
  UPDATE aquaterra_buildings SET income_from = now() WHERE plot_id = pid;
  INSERT INTO aquaterra_build_log (plot_id, actor, action, kind, level, cost, fee) VALUES (pid, who, 'collect', b.kind, b.level, gross - tax, tax);
  RETURN jsonb_build_object('gross', gross, 'tax', tax, 'net', gross - tax);
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_build_rules() RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object(
    'params', (SELECT jsonb_object_agg(key, value) FROM aquaterra_build_params),
    'centreHeight', aquaterra_build_law('centre_height_floors', 60),
    'incomeTaxPct', aquaterra_build_law('income_tax_pct', 10),
    'floors', jsonb_build_array(0, 10, 30, 60))
$fn$;

-- world/build-sites.json from the live site: {version, sites: [[plotId, flags, starter]]}.
-- flags: 1 buildable, 2 skyscraper allowed, 4 city centre. Run by the hourly sync only.
CREATE OR REPLACE FUNCTION aquaterra_build_sync(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE n int;
BEGIN
  IF j IS NULL OR jsonb_typeof(j->'sites') <> 'array' OR jsonb_array_length(j->'sites') < 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'file');
  END IF;
  WITH src AS (
    SELECT (e->>0)::int AS id, (e->>1)::int AS f, COALESCE(NULLIF(e->>2, ''), 'none') AS st FROM jsonb_array_elements(j->'sites') e
  ), up AS (
    INSERT INTO aquaterra_build_sites (plot_id, buildable, tower_ok, centre, starter)
    SELECT id, f & 1 = 1, f & 2 = 2, f & 4 = 4, CASE WHEN st IN ('cottage', 'works') THEN st ELSE 'none' END FROM src
    ON CONFLICT (plot_id) DO UPDATE SET buildable = EXCLUDED.buildable, tower_ok = EXCLUDED.tower_ok, centre = EXCLUDED.centre,
      starter = EXCLUDED.starter, synced_at = now()
    WHERE (aquaterra_build_sites.buildable, aquaterra_build_sites.tower_ok, aquaterra_build_sites.centre, aquaterra_build_sites.starter)
      IS DISTINCT FROM (EXCLUDED.buildable, EXCLUDED.tower_ok, EXCLUDED.centre, EXCLUDED.starter)
    RETURNING 1
  ) SELECT count(*) INTO n FROM up;
  RETURN jsonb_build_object('ok', true, 'changed', n, 'total', (SELECT count(*) FROM aquaterra_build_sites));
END $fn$;

-- The build API. req: {action, session, plotId, kind, design, replace, key, value}.
CREATE OR REPLACE FUNCTION aquaterra_build(req jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  act text := COALESCE(req->>'action', '');
  me text; my_role text; res jsonb := '{}'::jsonb;
  pid int; v_plot aquaterra_plots; site aquaterra_build_sites; b aquaterra_buildings; v_owner text;
  v_kind text; v_level int; v_cost bigint; v_fee bigint; v_hours bigint; v_free bigint; v_floors int; v_got jsonb;
  v_total bigint := 0; v_tax bigint := 0; v_refund bigint; v bigint; r record; v_has boolean;
BEGIN
  IF COALESCE(req->>'session', '') <> '' THEN
    SELECT p.email, p.role INTO me, my_role
    FROM aquaterra_sessions s JOIN aquaterra_players p ON p.email = s.email
    WHERE s.token_hash = encode(sha256(convert_to(req->>'session', 'UTF8')), 'hex') AND s.expires_at > now();
  END IF;
  IF act <> 'map' AND me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401);
  END IF;
  IF me IS NOT NULL THEN INSERT INTO aquaterra_wallets (account) VALUES (me) ON CONFLICT DO NOTHING; END IF;

  BEGIN
    IF act = 'map' THEN
      res := jsonb_build_object('buildings', COALESCE((SELECT jsonb_agg(aquaterra_build_public(b2) ORDER BY b2.plot_id) FROM aquaterra_buildings b2), '[]'::jsonb),
        'rules', aquaterra_build_rules());

    ELSIF act = 'me' THEN
      res := jsonb_build_object('mine', COALESCE((SELECT jsonb_agg(jsonb_build_object('plotId', b2.plot_id, 'kind', b2.kind, 'level', b2.level,
          'floors', aquaterra_build_floors(b2.kind, b2.level), 'readyAt', b2.ready_at, 'invested', b2.invested,
          'rate', aquaterra_build_rate(b2.kind, b2.level), 'taxPct', aquaterra_build_tax_pct(b2.kind, b2.level),
          'pending', aquaterra_build_pending(b2)) ORDER BY b2.plot_id)
        FROM aquaterra_buildings b2 JOIN aquaterra_plot_owners o ON o.plot_id = b2.plot_id WHERE o.owner = me AND b2.kind <> 'empty'), '[]'::jsonb),
        'free', greatest(0, COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = me), 0) - aquaterra_locked(me)),
        'rules', aquaterra_build_rules());

    ELSIF act = 'collect' THEN
      FOR r IN SELECT b2.plot_id FROM aquaterra_buildings b2 JOIN aquaterra_plot_owners o ON o.plot_id = b2.plot_id WHERE o.owner = me ORDER BY b2.plot_id LOOP
        v_got := aquaterra_build_collect(r.plot_id, me);
        v_total := v_total + (v_got->>'net')::bigint; v_tax := v_tax + (v_got->>'tax')::bigint;
      END LOOP;
      IF v_total < 1 THEN RAISE EXCEPTION 'nothing_to_claim'; END IF;
      res := jsonb_build_object('amount', v_total, 'tax', v_tax);

    ELSIF act IN ('build', 'upgrade', 'demolish', 'sell') THEN
      pid := (req->>'plotId')::int;
      SELECT * INTO v_plot FROM aquaterra_plots WHERE id = pid;
      IF v_plot.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      SELECT owner INTO v_owner FROM aquaterra_plot_owners WHERE plot_id = pid FOR UPDATE;
      IF v_owner IS DISTINCT FROM me THEN RAISE EXCEPTION 'not_owner'; END IF;
      SELECT * INTO site FROM aquaterra_build_sites WHERE plot_id = pid;
      SELECT * INTO b FROM aquaterra_buildings WHERE plot_id = pid FOR UPDATE;
      -- does something stand there now: a built building, or the starter building of the map
      v_has := CASE WHEN b.plot_id IS NOT NULL THEN b.kind <> 'empty' ELSE COALESCE(site.starter, 'none') <> 'none' END;
      v_free := greatest(0, COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = me), 0) - aquaterra_locked(me));

      IF act IN ('demolish', 'sell') OR (act = 'build' AND v_has) THEN
        IF NOT v_has THEN RAISE EXCEPTION 'nothing_here'; END IF;
        IF act = 'build' AND NOT COALESCE((req->>'replace')::boolean, false) THEN RAISE EXCEPTION 'occupied'; END IF;
        PERFORM aquaterra_build_collect(pid, me);
        v_refund := CASE WHEN act = 'sell' THEN floor(COALESCE(b.invested, 0) * aquaterra_build_param('sell_back_pct') / 100.0)::bigint ELSE 0 END;
        IF act = 'sell' THEN
          PERFORM aquaterra_build_pay('treasury', me, v_refund, 'building_sale', pid, 'Building sold to the Reserve, ' || v_plot.address, me);
        ELSE
          v_fee := aquaterra_build_param('demolish_cost');
          IF v_free < v_fee THEN RAISE EXCEPTION 'insufficient'; END IF;
          PERFORM aquaterra_build_pay(me, 'treasury', v_fee, 'build', pid, 'Demolition, ' || v_plot.address, me);
          v_free := v_free - v_fee;
        END IF;
        INSERT INTO aquaterra_buildings (plot_id, kind, level, built_by) VALUES (pid, 'empty', 0, me)
        ON CONFLICT (plot_id) DO UPDATE SET kind = 'empty', level = 0, design = 0, invested = 0, ready_at = now(), income_from = now(), built_by = me, updated_at = now();
        INSERT INTO aquaterra_build_log (plot_id, actor, action, kind, level, cost, fee) VALUES (pid, me, act, b.kind, b.level, COALESCE(v_refund, 0), COALESCE(v_fee, 0));
        SELECT * INTO b FROM aquaterra_buildings WHERE plot_id = pid;
        res := jsonb_build_object('refund', COALESCE(v_refund, 0), 'fee', COALESCE(v_fee, 0));
      END IF;

      IF act IN ('build', 'upgrade') THEN
        IF site.plot_id IS NULL OR NOT site.buildable THEN RAISE EXCEPTION 'not_buildable'; END IF;
        IF act = 'build' THEN
          v_kind := req->>'kind';
          IF v_kind NOT IN ('cottage', 'tower') THEN RAISE EXCEPTION 'kind'; END IF;
          IF v_kind = 'tower' AND NOT site.tower_ok THEN RAISE EXCEPTION 'tower_site'; END IF;
          IF v_kind = 'tower' AND (SELECT count(*) FROM aquaterra_buildings b2 JOIN aquaterra_plot_owners o ON o.plot_id = b2.plot_id
              WHERE o.owner = me AND b2.kind = 'tower' AND b2.plot_id <> pid) >= aquaterra_build_param('max_towers_per_citizen') THEN
            RAISE EXCEPTION 'tower_limit';
          END IF;
          v_level := 0;
          v_cost := CASE WHEN v_kind = 'cottage' THEN aquaterra_build_param('cottage_cost') ELSE aquaterra_build_param('tower_cost_0') END;
          v_hours := CASE WHEN v_kind = 'cottage' THEN aquaterra_build_param('hours_cottage') ELSE aquaterra_build_param('hours_0') END;
        ELSE
          IF b.plot_id IS NULL OR b.kind <> 'tower' THEN RAISE EXCEPTION 'kind'; END IF;
          IF b.level >= 3 THEN RAISE EXCEPTION 'max_level'; END IF;
          IF b.ready_at > now() THEN RAISE EXCEPTION 'building'; END IF;
          v_kind := 'tower'; v_level := b.level + 1;
          v_cost := aquaterra_build_param('tower_cost_' || v_level);
          v_hours := aquaterra_build_param('hours_' || v_level);
        END IF;
        v_floors := aquaterra_build_floors(v_kind, v_level);
        IF site.centre AND v_floors > aquaterra_build_law('centre_height_floors', 60) THEN RAISE EXCEPTION 'height_limit'; END IF;
        v_fee := round(v_cost * aquaterra_build_param('permit_pct') / 100.0);
        IF v_free < v_cost + v_fee THEN RAISE EXCEPTION 'insufficient'; END IF;
        PERFORM aquaterra_build_collect(pid, me);
        PERFORM aquaterra_build_pay(me, 'treasury', v_cost, 'build', pid,
          CASE WHEN v_kind = 'cottage' THEN 'Cottage' WHEN v_level = 0 THEN 'Skyscraper foundation' ELSE format('Skyscraper to %s floors', v_floors) END || ', ' || v_plot.address, me);
        PERFORM aquaterra_build_pay(me, 'state:treasury', v_fee, 'permit', pid, 'Building permit, ' || v_plot.address, me);
        INSERT INTO aquaterra_buildings (plot_id, kind, level, design, invested, ready_at, income_from, built_by)
        VALUES (pid, v_kind, v_level, greatest(0, least(1000000, COALESCE((req->>'design')::int, 0))), v_cost,
          now() + v_hours * interval '1 hour', now() + v_hours * interval '1 hour', me)
        ON CONFLICT (plot_id) DO UPDATE SET kind = EXCLUDED.kind, level = EXCLUDED.level,
          design = CASE WHEN act = 'upgrade' THEN aquaterra_buildings.design ELSE EXCLUDED.design END,
          invested = CASE WHEN act = 'upgrade' THEN aquaterra_buildings.invested + v_cost ELSE v_cost END,
          ready_at = EXCLUDED.ready_at, income_from = EXCLUDED.income_from, built_by = me, updated_at = now();
        INSERT INTO aquaterra_build_log (plot_id, actor, action, kind, level, cost, fee) VALUES (pid, me, act, v_kind, v_level, v_cost, v_fee);
        SELECT * INTO b FROM aquaterra_buildings WHERE plot_id = pid;
        res := res || jsonb_build_object('cost', v_cost, 'permit', v_fee);
      END IF;
      res := res || jsonb_build_object('building', aquaterra_build_public(b), 'floors', aquaterra_build_floors(b.kind, b.level));

    ELSIF act IN ('admin', 'admin_param') THEN
      IF my_role NOT IN ('founder', 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
      IF act = 'admin_param' THEN
        IF my_role <> 'founder' THEN RAISE EXCEPTION 'forbidden'; END IF;
        IF NOT EXISTS (SELECT 1 FROM aquaterra_build_params WHERE key = req->>'key') THEN RAISE EXCEPTION 'param'; END IF;
        v := (req->>'value')::bigint;
        IF v IS NULL OR v < 0 OR v > 10000000 OR (req->>'key' LIKE '%\_pct' AND v > 100) THEN RAISE EXCEPTION 'amount'; END IF;
        UPDATE aquaterra_build_params SET value = v WHERE key = req->>'key';
      END IF;
      res := jsonb_build_object('rules', aquaterra_build_rules(),
        'notes', (SELECT jsonb_object_agg(key, note) FROM aquaterra_build_params),
        'counts', jsonb_build_object(
          'cottages', (SELECT count(*) FROM aquaterra_buildings WHERE kind = 'cottage'),
          'towers', (SELECT count(*) FROM aquaterra_buildings WHERE kind = 'tower'),
          'cleared', (SELECT count(*) FROM aquaterra_buildings WHERE kind = 'empty'),
          'sites', (SELECT count(*) FROM aquaterra_build_sites)),
        'spent', (SELECT COALESCE(sum(cost), 0) FROM aquaterra_build_log WHERE action IN ('build', 'upgrade')),
        'permits', (SELECT COALESCE(sum(fee), 0) FROM aquaterra_build_log WHERE action IN ('build', 'upgrade')),
        'incomeTax', (SELECT COALESCE(sum(fee), 0) FROM aquaterra_build_log WHERE action = 'collect'),
        'recent', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', l.at, 'plotId', l.plot_id, 'who', aquaterra_name(l.actor), 'action', l.action,
            'kind', l.kind, 'level', l.level, 'cost', l.cost, 'fee', l.fee) ORDER BY l.id DESC)
          FROM (SELECT * FROM aquaterra_build_log ORDER BY id DESC LIMIT 30) l), '[]'::jsonb));
    ELSE
      RAISE EXCEPTION 'action';
    END IF;
  EXCEPTION
    WHEN raise_exception THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM,
        'status', CASE SQLERRM WHEN 'forbidden' THEN 403 WHEN 'not_owner' THEN 403 WHEN 'occupied' THEN 409 WHEN 'not_found' THEN 404 ELSE 400 END);
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('ok', false, 'error', 'param', 'status', 400);
  END;

  RETURN jsonb_build_object('ok', true, 'status', 200) || res;
END $fn$;
