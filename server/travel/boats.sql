-- AquaTerra World: nobody walks on water (2026-11-26).
-- One-off migration, safe to run again; run after travel.sql.
--
--  * Every land tile belongs to a piece of land ("isle": the smallest tile index
--    of it, from travel.json; -1 open water). Hubs, town centres and plot anchors
--    carry their isle; the hourly sync keeps them.
--  * A walk is allowed only within one piece of land. Across water (another islet,
--    a river with no bridge, a water plot) the resident calls a boat: leg mode
--    'boat' to a plot or the town square, and before a ride from a station,
--    harbour, airport or the town square on other land a boat is called by itself.
--  * Boat fare = boat_base + boat_per100 x straight tiles / 100, of it travel_tax_pct
--    to the State Treasury as the travel tax, the rest to the state too (boats, like
--    roads, belong to the state). Unknown isle (NULL, off this map) never needs a boat.
-- Patches aquaterra_travel_sync() and aquaterra_travel() in place (text replace),
-- so other changes to them stay.

ALTER TABLE aquaterra_plots ADD COLUMN IF NOT EXISTS isle int;
ALTER TABLE aquaterra_travel_hubs ADD COLUMN IF NOT EXISTS isle int;
ALTER TABLE aquaterra_districts ADD COLUMN IF NOT EXISTS isle int;

INSERT INTO aquaterra_travel_params (key, value, note) VALUES
  ('boat_base', 3, 'Boat across water: TIDE per ride'),
  ('boat_per100', 15, 'Boat across water: TIDE per 100 tiles')
ON CONFLICT (key) DO NOTHING;

-- isles from travel.json: hubs [.., x, y, isle], centres [id, x, y, isle], anchors [id, x, y, isle]
CREATE OR REPLACE FUNCTION aquaterra_travel_isles(j jsonb) RETURNS void LANGUAGE sql AS $fn$
  UPDATE aquaterra_travel_hubs h SET isle = (e->>6)::int
  FROM jsonb_array_elements(COALESCE(j->'hubs', '[]'::jsonb)) e
  WHERE h.id = e->>0 AND h.isle IS DISTINCT FROM (e->>6)::int;
  UPDATE aquaterra_districts d SET isle = (e->>3)::int
  FROM jsonb_array_elements(COALESCE(j->'centres', '[]'::jsonb)) e
  WHERE d.id = (e->>0)::int AND d.isle IS DISTINCT FROM (e->>3)::int;
  UPDATE aquaterra_plots p SET isle = (e->>3)::int
  FROM jsonb_array_elements(COALESCE(j->'anchors', '[]'::jsonb)) e
  WHERE p.id = (e->>0)::int AND p.isle IS DISTINCT FROM (e->>3)::int;
$fn$;

-- The piece of land a resident stands on now (NULL: not known).
CREATE OR REPLACE FUNCTION aquaterra_travel_isle_of(l aquaterra_locations) RETURNS int LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN l.spot = 'plot' THEN (SELECT isle FROM aquaterra_plots WHERE id = l.plot_id)
    WHEN l.spot LIKE 'hub:%' THEN (SELECT isle FROM aquaterra_travel_hubs WHERE id = substr(l.spot, 5))
    ELSE (SELECT isle FROM aquaterra_districts WHERE id = l.district_id) END
$fn$;

-- Moving on foot from isle a (x1,y1) to isle b (x2,y2). m: 'walk' (free; error 'boat' across
-- water), 'boat' (asked for: paid) or 'auto' (paid only across water). Returns the fare charged.
CREATE OR REPLACE FUNCTION aquaterra_travel_boat(me text, m text, a int, b int, x1 int, y1 int, x2 int, y2 int)
RETURNS bigint LANGUAGE plpgsql AS $fn$
DECLARE wet boolean := a IS NOT NULL AND b IS NOT NULL AND (a <> b OR a < 0); f bigint; tx bigint; lid bigint;
BEGIN
  IF m = 'walk' THEN
    IF wet THEN RAISE EXCEPTION 'boat'; END IF;
    RETURN 0;
  END IF;
  IF m = 'auto' AND NOT wet THEN RETURN 0; END IF;
  f := aquaterra_travel_fare('boat', greatest(1, round(sqrt(((x1 - x2)::float8) ^ 2 + ((y1 - y2)::float8) ^ 2)))::int);
  tx := aquaterra_travel_tax(f);
  IF f - tx > 0 THEN
    lid := aquaterra_move(me, 'state:treasury', f - tx, 'fare', NULL, 'Boat across the water', me);
    UPDATE aquaterra_ledger SET ref = 'travel:boat' WHERE id = lid;
  END IF;
  IF tx > 0 THEN
    lid := aquaterra_move(me, 'state:treasury', tx, 'tax', NULL, 'Travel tax', me);
    UPDATE aquaterra_ledger SET ref = 'tax:travel' WHERE id = lid;
  END IF;
  RETURN f;
END $fn$;

DO $do$
DECLARE src text;
  -- every anchor must be found exactly as travel.sql wrote it, or nothing changes
  a_sync text := E'  GET DIAGNOSTICS np = ROW_COUNT;\n  RETURN jsonb_build_object(''ok'', true';
  a_decl text := 'new_spot text; new_plot int; nx int; ny int; v bigint; lid bigint;';
  a_start text := 'new_spot := loc.spot; new_plot := loc.plot_id; nx := loc.x; ny := loc.y;';
  a_walk text := 'IF m = ''walk'' THEN';
  a_plot text := 'new_spot := ''plot''; new_plot := v_plot.id; nx := v_plot.ax; ny := v_plot.ay;';
  a_centre text := E'            new_spot := ''centre''; new_plot := NULL;\n            SELECT COALESCE(cx, 0), COALESCE(cy, 0) INTO nx, ny FROM aquaterra_districts WHERE id = cur;\n          END IF;\n          out_legs := out_legs || jsonb_build_object(''mode'', ''walk'', ''to'', cur, ''plot'', new_plot, ''fare'', 0, ''tax'', 0);';
  a_board text := E'          IF d IS NULL THEN RAISE EXCEPTION ''route''; END IF;\n          f := aquaterra_travel_fare(m, d);';
  a_arrive text := E'          new_plot := NULL;\n        ELSE\n          RAISE EXCEPTION ''route'';';
BEGIN
  src := pg_get_functiondef('aquaterra_travel_sync(jsonb)'::regprocedure);
  IF position('aquaterra_travel_isles' IN src) = 0 THEN
    IF position(a_sync IN src) = 0 THEN RAISE EXCEPTION 'boats patch: sync anchor not found'; END IF;
    src := replace(src, a_sync, E'  GET DIAGNOSTICS np = ROW_COUNT;\n  PERFORM aquaterra_travel_isles(j);\n  RETURN jsonb_build_object(''ok'', true');
    EXECUTE src;
  END IF;

  src := pg_get_functiondef('aquaterra_travel(jsonb)'::regprocedure);
  IF position('aquaterra_travel_boat' IN src) > 0 THEN RETURN; END IF;
  IF position(a_decl IN src) = 0 THEN RAISE EXCEPTION 'boats patch: declare anchor not found'; END IF;
  IF position(a_start IN src) = 0 THEN RAISE EXCEPTION 'boats patch: start anchor not found'; END IF;
  IF position(a_walk IN src) = 0 THEN RAISE EXCEPTION 'boats patch: walk anchor not found'; END IF;
  IF position(a_plot IN src) = 0 THEN RAISE EXCEPTION 'boats patch: plot anchor not found'; END IF;
  IF position(a_centre IN src) = 0 THEN RAISE EXCEPTION 'boats patch: centre anchor not found'; END IF;
  IF position(a_board IN src) = 0 THEN RAISE EXCEPTION 'boats patch: board anchor not found'; END IF;
  IF position(a_arrive IN src) = 0 THEN RAISE EXCEPTION 'boats patch: arrive anchor not found'; END IF;

  src := replace(src, a_decl, a_decl || ' isl int; bisl int; bx int; by_ int; bf bigint;');
  src := replace(src, a_start, a_start || E'\n      isl := aquaterra_travel_isle_of(loc);');
  -- the last leg: on foot, or by boat, to a plot or the town square
  src := replace(src, a_walk, 'IF m IN (''walk'', ''boat'') THEN');
  src := replace(src, a_plot,
    E'bf := aquaterra_travel_boat(me, m, isl, v_plot.isle, nx, ny, v_plot.ax, v_plot.ay);\n            '
    || a_plot);
  src := replace(src, a_centre,
    E'            SELECT COALESCE(cx, 0), COALESCE(cy, 0), isle INTO bx, by_, bisl FROM aquaterra_districts WHERE id = cur;\n'
    || E'            bf := aquaterra_travel_boat(me, m, isl, bisl, nx, ny, bx, by_);\n'
    || E'            new_spot := ''centre''; new_plot := NULL; nx := bx; ny := by_;\n'
    || E'          END IF;\n'
    || E'          bf := COALESCE(bf, 0);\n'
    || E'          total := total + bf; taxes := taxes + aquaterra_travel_tax(bf);\n'
    || E'          out_legs := out_legs || jsonb_build_object(''mode'', m, ''to'', cur, ''plot'', new_plot, ''fare'', bf, ''tax'', aquaterra_travel_tax(bf));');
  -- before a ride: from other land to the town square or the hub, by boat
  src := replace(src, a_board,
    E'          IF d IS NULL THEN RAISE EXCEPTION ''route''; END IF;\n'
    || E'          IF m = ''car'' THEN\n'
    || E'            SELECT COALESCE(cx, 0), COALESCE(cy, 0), isle INTO bx, by_, bisl FROM aquaterra_districts WHERE id = cur;\n'
    || E'          ELSE\n'
    || E'            SELECT x, y, isle INTO bx, by_, bisl FROM aquaterra_travel_hubs WHERE id = (CASE m WHEN ''train'' THEN ''station'' WHEN ''ferry'' THEN ''port'' ELSE ''airport'' END) || '':'' || cur;\n'
    || E'          END IF;\n'
    || E'          bf := CASE WHEN bx IS NULL THEN 0 ELSE aquaterra_travel_boat(me, ''auto'', isl, bisl, nx, ny, bx, by_) END;\n'
    || E'          IF bf > 0 THEN\n'
    || E'            total := total + bf; taxes := taxes + aquaterra_travel_tax(bf);\n'
    || E'            out_legs := out_legs || jsonb_build_object(''mode'', ''boat'', ''to'', cur, ''fare'', bf, ''tax'', aquaterra_travel_tax(bf), ''operator'', ''State boats'');\n'
    || E'          END IF;\n'
    || E'          f := aquaterra_travel_fare(m, d);');
  -- where the ride ends: that piece of land
  src := replace(src, a_arrive,
    E'          new_plot := NULL;\n'
    || E'          isl := CASE WHEN new_spot LIKE ''hub:%'' THEN (SELECT isle FROM aquaterra_travel_hubs WHERE id = substr(new_spot, 5))\n'
    || E'                      ELSE (SELECT isle FROM aquaterra_districts WHERE id = cur) END;\n'
    || E'        ELSE\n'
    || E'          RAISE EXCEPTION ''route'';');
  EXECUTE src;
END $do$;
