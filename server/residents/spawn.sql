-- AquaTerra World: where a newcomer first appears (2026-11-27, decision of Alexander).
-- One-off migration, safe to run again. Run after travel.sql and boats.sql: it replaces
-- aquaterra_player_where() from travel.sql (the only other definition).
-- n8n runs this text: no double dollar quotes (use $fn$), no positional parameters.
--
--  * A newcomer appears on a random land plot of their home district, not all on one
--    tile at the town centre. No home district chosen: a random land plot of the capital
--    (First Light City), so they too are spread across it.
--  * Only land (isle >= 0, never water), and on the same piece of land as the town centre
--    when that is known, so nobody starts on an islet and needs a boat to reach town.
--  * They stand "on" the plot (spot 'plot'), like a resident who walked there; nothing is
--    bought and the owner of the plot, if any, keeps it.
--  * If the district has no such plot (registry not synced yet), the town centre as before.
--  * Residents already placed stay where they are.

CREATE OR REPLACE FUNCTION aquaterra_player_where(who text) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE l aquaterra_locations; home int; d aquaterra_districts; p aquaterra_plots;
BEGIN
  SELECT * INTO l FROM aquaterra_locations WHERE email = who;
  IF l.email IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM aquaterra_players WHERE email = who) THEN RETURN NULL; END IF;
    SELECT r.district_id INTO home FROM aquaterra_residents r WHERE r.email = who;
    home := COALESCE(home, (SELECT id FROM aquaterra_districts WHERE capital ORDER BY id LIMIT 1), 0);
    SELECT * INTO d FROM aquaterra_districts WHERE id = home;
    IF d.id IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO p FROM aquaterra_plots q
    WHERE q.district = d.name AND q.ax IS NOT NULL AND q.ay IS NOT NULL
      AND q.isle IS NOT NULL AND q.isle >= 0
      AND (d.isle IS NULL OR d.isle < 0 OR q.isle = d.isle)
    ORDER BY random() LIMIT 1;
    IF p.id IS NOT NULL THEN
      INSERT INTO aquaterra_locations (email, district_id, spot, plot_id, x, y)
      VALUES (who, d.id, 'plot', p.id, p.ax, p.ay)
      ON CONFLICT (email) DO NOTHING;
    ELSE
      INSERT INTO aquaterra_locations (email, district_id, spot, x, y)
      VALUES (who, d.id, 'centre', COALESCE(d.cx, 0), COALESCE(d.cy, 0))
      ON CONFLICT (email) DO NOTHING;
    END IF;
    SELECT * INTO l FROM aquaterra_locations WHERE email = who;
    IF l.email IS NULL THEN RETURN NULL; END IF;
  END IF;
  RETURN aquaterra_travel_location_json(l);
END $fn$;
