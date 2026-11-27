-- AquaTerra World: piers, jetties and harbours on plots by the water (2026-11-27).
-- One-off migration (run once, never per request). Safe to run again.
-- Run after build.sql, travel.sql, boats.sql and water.sql (and industry.sql, when installed).
-- n8n runs this text: no double dollar quotes (use $fn$), no positional parameters.
--
-- Rules (server-authoritative; the site only shows and asks):
--  * A land plot that touches the water (sea, lagoon, lake or river; build-sites.json
--    flag 8) can have one pier next to whatever stands on the plot. It reaches from the
--    shore into the water: jetty (level 1), pier (2), harbour (3). Each level is paid,
--    with the building permit (permit_pct of build.sql) to the State Treasury, and takes
--    hours to build. Materials from the owner's storehouse are used first (industry),
--    and their depot value is not charged.
--  * The pier may not reach over water another resident owns (build-sites.json lists
--    the water plots a harbour would cover).
--  * Private: only the owner moors there. A boat ride of the owner that starts or ends
--    at their own pier costs pier_own_discount_pct less (your own boat).
--  * Public: anyone may moor. A visitor's boat that starts or ends there pays the
--    mooring fee the owner sets (up to the cap of the level); the owner gets it less
--    the travel tax, which goes to the State Treasury. Same rule as private roads and water.
--  * The pier goes with the plot: whoever owns the plot owns the pier. Removing it costs
--    pier_remove_cost and gives back industry_salvage_pct of its materials.

CREATE TABLE IF NOT EXISTS aquaterra_pier_params (
  key text PRIMARY KEY,
  value bigint NOT NULL,
  note text
);
INSERT INTO aquaterra_pier_params (key, value, note) VALUES
  ('pier_cost_1', 300, 'Jetty: construction cost, TIDE'),
  ('pier_cost_2', 800, 'Pier (from a jetty): construction cost, TIDE'),
  ('pier_cost_3', 2000, 'Harbour (from a pier): construction cost, TIDE'),
  ('pier_hours_1', 1, 'Hours to build a jetty'),
  ('pier_hours_2', 3, 'Hours to build a pier'),
  ('pier_hours_3', 6, 'Hours to build a harbour'),
  ('pier_fee_cap_1', 2, 'Jetty: highest mooring fee, TIDE'),
  ('pier_fee_cap_2', 5, 'Pier: highest mooring fee, TIDE'),
  ('pier_fee_cap_3', 10, 'Harbour: highest mooring fee, TIDE'),
  ('pier_own_discount_pct', 50, 'Boat rides from or to your own pier cost this percent less'),
  ('pier_remove_cost', 20, 'Removing a pier, TIDE')
ON CONFLICT (key) DO NOTHING;

-- Materials per 100 TIDE of cost (only goods the storehouse knows; without industry none).
CREATE TABLE IF NOT EXISTS aquaterra_pier_recipe (
  resource text PRIMARY KEY,
  per100 numeric NOT NULL CHECK (per100 > 0)
);
DO $do$
BEGIN
  IF to_regclass('aquaterra_crops') IS NOT NULL THEN
    INSERT INTO aquaterra_pier_recipe (resource, per100)
    SELECT v.r, v.q FROM (VALUES ('wood', 10::numeric), ('concrete', 5), ('steel', 2), ('materials', 3)) v(r, q)
    WHERE EXISTS (SELECT 1 FROM aquaterra_crops c WHERE c.key = v.r)
    ON CONFLICT (resource) DO NOTHING;
  END IF;
END $do$;

CREATE TABLE IF NOT EXISTS aquaterra_piers (
  plot_id int PRIMARY KEY REFERENCES aquaterra_plots (id),
  level int NOT NULL CHECK (level BETWEEN 1 AND 3),
  access text NOT NULL DEFAULT 'private' CHECK (access IN ('private', 'public')),
  fee bigint NOT NULL DEFAULT 0 CHECK (fee >= 0),
  invested bigint NOT NULL DEFAULT 0,
  materials jsonb NOT NULL DEFAULT '{}'::jsonb,
  ready_at timestamptz NOT NULL DEFAULT now(),
  trips bigint NOT NULL DEFAULT 0,
  revenue bigint NOT NULL DEFAULT 0,
  built_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION aquaterra_pier_param(k text) RETURNS bigint LANGUAGE sql STABLE AS
$fn$ SELECT value FROM aquaterra_pier_params WHERE key = k $fn$;

CREATE OR REPLACE FUNCTION aquaterra_pier_public(p aquaterra_piers) RETURNS jsonb LANGUAGE sql STABLE AS
$fn$ SELECT jsonb_build_array(p.plot_id, p.level, p.access, least(p.fee, aquaterra_pier_param('pier_fee_cap_' || p.level)), floor(extract(epoch FROM p.ready_at))::bigint) $fn$;

CREATE OR REPLACE FUNCTION aquaterra_pier_rules() RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('params', (SELECT jsonb_object_agg(key, value) FROM aquaterra_pier_params),
    'permitPct', aquaterra_build_param('permit_pct'),
    'recipe', COALESCE((SELECT jsonb_object_agg(resource, per100) FROM aquaterra_pier_recipe), '{}'::jsonb))
$fn$;

-- Own materials first. Returns {save: TIDE not charged, used: {resource: units the pier holds}}.
CREATE OR REPLACE FUNCTION aquaterra_pier_materials(who text, cost bigint) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE r record; q bigint; take bigint; save numeric := 0; used jsonb := '{}'::jsonb;
BEGIN
  IF to_regprocedure('aquaterra_ind_depot(text)') IS NULL OR to_regclass('aquaterra_farm_barn') IS NULL THEN
    RETURN jsonb_build_object('save', 0, 'used', used);
  END IF;
  FOR r IN SELECT resource, per100 FROM aquaterra_pier_recipe ORDER BY resource LOOP
    q := ceil(r.per100 * cost / 100.0)::bigint;
    IF q <= 0 THEN CONTINUE; END IF;
    used := used || jsonb_build_object(r.resource, q);
    SELECT least(q, COALESCE((SELECT units FROM aquaterra_farm_barn WHERE email = who AND crop = r.resource), 0)) INTO take;
    IF take > 0 THEN
      UPDATE aquaterra_farm_barn SET units = units - take WHERE email = who AND crop = r.resource;
      save := save + take * aquaterra_ind_depot(r.resource);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('save', least(cost, floor(save))::bigint, 'used', used);
END $fn$;

-- Called by aquaterra_travel_boat() (water.sql) for every paid boat between (x1,y1) and (x2,y2):
-- your own pier at either end makes your boat cheaper; a public pier of someone else takes its
-- mooring fee (less the travel tax). Returns the boat fare after the discount and the fees paid.
CREATE OR REPLACE FUNCTION aquaterra_pier_boat(me text, x1 int, y1 int, x2 int, y2 int, f bigint)
RETURNS TABLE (fare bigint, fees bigint) LANGUAGE plpgsql AS $fn$
DECLARE own boolean := false; p record; mf bigint; tx bigint; total bigint := 0; lid bigint;
BEGIN
  FOR p IN SELECT pr.plot_id, pr.level, pr.access, pr.fee, o.owner AS pown, pl.address
           FROM aquaterra_piers pr JOIN aquaterra_plots pl ON pl.id = pr.plot_id
           LEFT JOIN aquaterra_plot_owners o ON o.plot_id = pr.plot_id
           WHERE pr.ready_at <= now() AND ((pl.ax = x1 AND pl.ay = y1) OR (pl.ax = x2 AND pl.ay = y2))
           ORDER BY pr.plot_id LOOP
    IF p.pown = me THEN
      own := true;
      UPDATE aquaterra_piers SET trips = trips + 1 WHERE plot_id = p.plot_id;
    ELSIF p.access = 'public' AND p.pown IS NOT NULL THEN
      mf := least(p.fee, aquaterra_pier_param('pier_fee_cap_' || p.level));
      UPDATE aquaterra_piers SET trips = trips + 1 WHERE plot_id = p.plot_id;
      IF mf > 0 THEN
        tx := aquaterra_travel_tax(mf);
        IF mf - tx > 0 THEN
          lid := aquaterra_move(me, p.pown, mf - tx, 'fare', p.plot_id, left('Mooring, ' || p.address, 120), me);
          UPDATE aquaterra_ledger SET ref = 'travel:pier' WHERE id = lid;
        END IF;
        IF tx > 0 THEN
          lid := aquaterra_move(me, 'state:treasury', tx, 'tax', p.plot_id, 'Travel tax', me);
          UPDATE aquaterra_ledger SET ref = 'tax:travel' WHERE id = lid;
        END IF;
        UPDATE aquaterra_piers SET revenue = revenue + mf - tx WHERE plot_id = p.plot_id;
        total := total + mf;
      END IF;
    END IF;
  END LOOP;
  IF own THEN f := ceil(f * (100 - least(100, aquaterra_pier_param('pier_own_discount_pct'))) / 100.0)::bigint; END IF;
  RETURN QUERY SELECT f, total;
END $fn$;

-- The pier API (reached through the build webhook, actions starting with "pier").
-- req: {action, session, plotId, access, fee}. piers: public list; pier_me: my piers;
-- pier_build | pier_upgrade | pier_set | pier_remove.
CREATE OR REPLACE FUNCTION aquaterra_pier(req jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  act text := COALESCE(req->>'action', '');
  me text; res jsonb := '{}'::jsonb;
  pid int; v_plot aquaterra_plots; site aquaterra_build_sites; p aquaterra_piers; v_owner text;
  v_level int; v_cost bigint; v_fee bigint; v_hours bigint; v_free bigint; v_mat jsonb; v_save bigint;
  v_access text; v_mfee bigint; r record; n bigint; got jsonb := '{}'::jsonb;
BEGIN
  IF COALESCE(req->>'session', '') <> '' THEN
    SELECT p2.email INTO me
    FROM aquaterra_sessions s JOIN aquaterra_players p2 ON p2.email = s.email
    WHERE s.token_hash = encode(sha256(convert_to(req->>'session', 'UTF8')), 'hex') AND s.expires_at > now();
  END IF;
  IF act <> 'piers' AND me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401);
  END IF;

  BEGIN
    IF act = 'piers' THEN
      res := jsonb_build_object('piers', COALESCE((SELECT jsonb_agg(aquaterra_pier_public(p2) ORDER BY p2.plot_id) FROM aquaterra_piers p2), '[]'::jsonb),
        'rules', aquaterra_pier_rules());

    ELSIF act = 'pier_me' THEN
      res := jsonb_build_object('mine', COALESCE((SELECT jsonb_agg(jsonb_build_object('plotId', p2.plot_id, 'level', p2.level, 'access', p2.access,
          'fee', p2.fee, 'trips', p2.trips, 'revenue', p2.revenue, 'invested', p2.invested, 'readyAt', p2.ready_at) ORDER BY p2.plot_id)
        FROM aquaterra_piers p2 JOIN aquaterra_plot_owners o ON o.plot_id = p2.plot_id WHERE o.owner = me), '[]'::jsonb),
        'rules', aquaterra_pier_rules());

    ELSIF act IN ('pier_build', 'pier_upgrade', 'pier_set', 'pier_remove') THEN
      pid := (req->>'plotId')::int;
      SELECT * INTO v_plot FROM aquaterra_plots WHERE id = pid;
      IF v_plot.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      SELECT owner INTO v_owner FROM aquaterra_plot_owners WHERE plot_id = pid FOR UPDATE;
      IF v_owner IS DISTINCT FROM me THEN RAISE EXCEPTION 'not_owner'; END IF;
      SELECT * INTO site FROM aquaterra_build_sites WHERE plot_id = pid;
      SELECT * INTO p FROM aquaterra_piers WHERE plot_id = pid FOR UPDATE;
      v_free := greatest(0, COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = me), 0) - aquaterra_locked(me));
      v_access := COALESCE(req->>'access', p.access, 'private');
      IF v_access NOT IN ('private', 'public') THEN RAISE EXCEPTION 'param'; END IF;
      v_mfee := COALESCE((req->>'fee')::bigint, p.fee, 0);
      IF v_mfee < 0 THEN RAISE EXCEPTION 'amount'; END IF;

      IF act IN ('pier_build', 'pier_upgrade') THEN
        IF site.plot_id IS NULL OR NOT COALESCE(site.coastal, false) THEN RAISE EXCEPTION 'not_coastal'; END IF;
        IF act = 'pier_build' AND p.plot_id IS NOT NULL THEN RAISE EXCEPTION 'occupied'; END IF;
        IF act = 'pier_upgrade' AND p.plot_id IS NULL THEN RAISE EXCEPTION 'nothing_here'; END IF;
        IF act = 'pier_upgrade' AND p.level >= 3 THEN RAISE EXCEPTION 'max_level'; END IF;
        IF act = 'pier_upgrade' AND p.ready_at > now() THEN RAISE EXCEPTION 'building'; END IF;
        IF EXISTS (SELECT 1 FROM aquaterra_plot_owners o WHERE o.plot_id = ANY (COALESCE(site.waters, '{}'::int[])) AND o.owner <> me) THEN
          RAISE EXCEPTION 'water_owned';
        END IF;
        v_level := CASE WHEN p.plot_id IS NULL THEN 1 ELSE p.level + 1 END;
        v_cost := aquaterra_pier_param('pier_cost_' || v_level);
        v_hours := aquaterra_pier_param('pier_hours_' || v_level);
        v_fee := round(v_cost * aquaterra_build_param('permit_pct') / 100.0);
        v_mat := aquaterra_pier_materials(me, v_cost);
        v_save := (v_mat->>'save')::bigint;
        IF v_free < v_cost - v_save + v_fee THEN RAISE EXCEPTION 'insufficient'; END IF;
        PERFORM aquaterra_build_pay(me, 'treasury', v_cost - v_save, 'build', pid,
          (ARRAY['Jetty', 'Pier', 'Harbour'])[v_level] || ', ' || v_plot.address, me);
        PERFORM aquaterra_build_pay(me, 'state:treasury', v_fee, 'permit', pid, 'Building permit, ' || v_plot.address, me);
        INSERT INTO aquaterra_piers (plot_id, level, access, fee, invested, materials, ready_at, built_by)
        VALUES (pid, v_level, v_access, least(v_mfee, aquaterra_pier_param('pier_fee_cap_' || v_level)), v_cost, v_mat->'used',
          now() + v_hours * interval '1 hour', me)
        ON CONFLICT (plot_id) DO UPDATE SET level = EXCLUDED.level, access = EXCLUDED.access, fee = EXCLUDED.fee,
          invested = aquaterra_piers.invested + EXCLUDED.invested,
          materials = (SELECT COALESCE(jsonb_object_agg(k, s), '{}'::jsonb) FROM (
            SELECT k, sum(v::bigint) AS s FROM (SELECT * FROM jsonb_each_text(aquaterra_piers.materials) UNION ALL SELECT * FROM jsonb_each_text(EXCLUDED.materials)) a(k, v) GROUP BY k) b),
          ready_at = EXCLUDED.ready_at, built_by = me, updated_at = now();
        INSERT INTO aquaterra_build_log (plot_id, actor, action, kind, level, cost, fee) VALUES (pid, me, act, 'pier', v_level, v_cost, v_fee);
        res := jsonb_build_object('cost', v_cost, 'permit', v_fee, 'materialsSaved', v_save, 'paid', v_cost - v_save);

      ELSIF act = 'pier_set' THEN
        IF p.plot_id IS NULL THEN RAISE EXCEPTION 'nothing_here'; END IF;
        IF v_mfee > aquaterra_pier_param('pier_fee_cap_' || p.level) THEN RAISE EXCEPTION 'amount'; END IF;
        UPDATE aquaterra_piers SET access = v_access, fee = v_mfee, updated_at = now() WHERE plot_id = pid;

      ELSE -- pier_remove
        IF p.plot_id IS NULL THEN RAISE EXCEPTION 'nothing_here'; END IF;
        v_fee := aquaterra_pier_param('pier_remove_cost');
        IF v_free < v_fee THEN RAISE EXCEPTION 'insufficient'; END IF;
        PERFORM aquaterra_build_pay(me, 'treasury', v_fee, 'build', pid, 'Pier removed, ' || v_plot.address, me);
        IF to_regprocedure('aquaterra_farm_put(text,text,bigint)') IS NOT NULL THEN
          FOR r IN SELECT key, value::bigint AS q FROM jsonb_each_text(p.materials) LOOP
            n := floor(r.q * COALESCE((SELECT value FROM aquaterra_gov_params WHERE key = 'industry_salvage_pct'), 50) / 100.0);
            IF n > 0 THEN PERFORM aquaterra_farm_put(me, r.key, n); got := got || jsonb_build_object(r.key, n); END IF;
          END LOOP;
        END IF;
        DELETE FROM aquaterra_piers WHERE plot_id = pid;
        INSERT INTO aquaterra_build_log (plot_id, actor, action, kind, level, cost, fee) VALUES (pid, me, act, 'pier', p.level, 0, v_fee);
        res := jsonb_build_object('fee', v_fee, 'salvage', got);
      END IF;
      SELECT * INTO p FROM aquaterra_piers WHERE plot_id = pid;
      res := res || jsonb_build_object('pier', CASE WHEN p.plot_id IS NULL THEN NULL ELSE aquaterra_pier_public(p) END);
    ELSE
      RAISE EXCEPTION 'action';
    END IF;
  EXCEPTION
    WHEN raise_exception THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM,
        'status', CASE SQLERRM WHEN 'not_owner' THEN 403 WHEN 'occupied' THEN 409 WHEN 'not_found' THEN 404 ELSE 400 END);
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('ok', false, 'error', 'param', 'status', 400);
  END;

  RETURN jsonb_build_object('ok', true, 'status', 200) || res;
END $fn$;
