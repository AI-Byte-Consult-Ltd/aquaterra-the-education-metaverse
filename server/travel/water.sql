-- AquaTerra World: a boat pays the owners of the water it crosses (2026-11-26).
-- Run after boats.sql; safe to run again (it only replaces functions).
--
-- Same rule as roads: water nobody has bought is the state's, so its share of
-- a boat fare goes to the State Treasury. A bought water plot earns its owner
-- the share of every boat that crosses it, less the travel tax (to the
-- treasury). Crossing your own water you pay only the tax for that share.
--
-- The boat sails straight from where the resident stands to where they go.
-- A water plot is crossed when that line passes within its radius
-- (sqrt(tiles)/2 + 0.5 tiles of its anchor). The fare less the tax is split
-- in equal parts between the water plots crossed: owned parts to their
-- owners, the rest to the treasury.

-- Water plots a straight boat line crosses: plot id and owner (NULL: the state's).
CREATE OR REPLACE FUNCTION aquaterra_boat_waters(x1 int, y1 int, x2 int, y2 int)
RETURNS TABLE (plot_id int, owner text) LANGUAGE sql STABLE AS $fn$
  WITH c AS (
    SELECT p.id, o.owner, p.ax::float8 AS px, p.ay::float8 AS py, sqrt(greatest(1, p.tiles)) / 2.0 + 0.5 AS r,
           (x2 - x1)::float8 AS dx, (y2 - y1)::float8 AS dy
    FROM aquaterra_plots p LEFT JOIN aquaterra_plot_owners o ON o.plot_id = p.id
    WHERE p.isle < 0 AND p.ax IS NOT NULL
      AND p.ax BETWEEN least(x1, x2) - 12 AND greatest(x1, x2) + 12
      AND p.ay BETWEEN least(y1, y2) - 12 AND greatest(y1, y2) + 12
  ), t AS (
    SELECT *, CASE WHEN dx * dx + dy * dy = 0 THEN 0
                   ELSE greatest(0, least(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy))) END AS k
    FROM c
  )
  SELECT id, owner FROM t WHERE sqrt((px - (x1 + k * dx)) ^ 2 + (py - (y1 + k * dy)) ^ 2) <= r ORDER BY id
$fn$;

-- Moving on foot from isle a (x1,y1) to isle b (x2,y2). m: 'walk' (free; error 'boat' across
-- water), 'boat' (asked for: paid) or 'auto' (paid only across water). Returns what the resident paid.
CREATE OR REPLACE FUNCTION aquaterra_travel_boat(me text, m text, a int, b int, x1 int, y1 int, x2 int, y2 int)
RETURNS bigint LANGUAGE plpgsql AS $fn$
DECLARE wet boolean := a IS NOT NULL AND b IS NOT NULL AND (a <> b OR a < 0);
  f bigint; tx bigint; rest bigint; k int; part bigint; own bigint := 0; paid_owners bigint := 0; lid bigint; w record;
BEGIN
  IF m = 'walk' THEN
    IF wet THEN RAISE EXCEPTION 'boat'; END IF;
    RETURN 0;
  END IF;
  IF m = 'auto' AND NOT wet THEN RETURN 0; END IF;
  f := aquaterra_travel_fare('boat', greatest(1, round(sqrt(((x1 - x2)::float8) ^ 2 + ((y1 - y2)::float8) ^ 2)))::int);
  tx := aquaterra_travel_tax(f);
  rest := f - tx;
  SELECT count(*) INTO k FROM aquaterra_boat_waters(x1, y1, x2, y2);
  IF k > 0 AND rest > 0 THEN
    FOR w IN SELECT owner, count(*) AS n, min(plot_id) AS plot FROM aquaterra_boat_waters(x1, y1, x2, y2)
             WHERE owner IS NOT NULL GROUP BY owner ORDER BY owner LOOP
      part := floor(rest * w.n / k)::bigint;
      IF part <= 0 THEN CONTINUE; END IF;
      IF w.owner = me THEN
        own := own + part; -- your own water: only the tax for it
      ELSE
        lid := aquaterra_move(me, w.owner, part, 'fare', w.plot, 'Boat over your water', me);
        UPDATE aquaterra_ledger SET ref = 'travel:water' WHERE id = lid;
        paid_owners := paid_owners + part;
      END IF;
    END LOOP;
  END IF;
  IF rest - own - paid_owners > 0 THEN
    lid := aquaterra_move(me, 'state:treasury', rest - own - paid_owners, 'fare', NULL, 'Boat across the water', me);
    UPDATE aquaterra_ledger SET ref = 'travel:boat' WHERE id = lid;
  END IF;
  IF tx > 0 THEN
    lid := aquaterra_move(me, 'state:treasury', tx, 'tax', NULL, 'Travel tax', me);
    UPDATE aquaterra_ledger SET ref = 'tax:travel' WHERE id = lid;
  END IF;
  RETURN f - own;
END $fn$;
