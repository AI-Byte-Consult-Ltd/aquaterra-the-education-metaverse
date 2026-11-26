-- AquaTerra World: residents' avatars and who else is in the city right now.
-- One-off migration (run once, never per request). Safe to run again.
-- Needs the tables of the account and travel workflows (aquaterra_players,
-- aquaterra_sessions, aquaterra_locations, aquaterra_districts).
-- n8n runs this text: no double dollar quotes (use $fn$), no positional parameters.
--
-- Rules:
--  * Each resident picks an avatar (one of the styles below) and a colour (hue 0..359).
--    A resident who has not picked one is shown as the classic glowing drop.
--  * A resident may hide from the map ("visible" off): then nobody else sees them.
--  * The map shows real residents only: those who opened the world in the last
--    7 days, where they really stand (aquaterra_locations). Online = seen in the last 5 minutes.
--  * Emails never leave the server: other residents get the citizen name and a short
--    stable key (a hash) so the site can place people who stand at the same spot side by side.

ALTER TABLE aquaterra_players ADD COLUMN IF NOT EXISTS avatar text;
ALTER TABLE aquaterra_players ADD COLUMN IF NOT EXISTS avatar_hue int;
ALTER TABLE aquaterra_players ADD COLUMN IF NOT EXISTS on_map boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS aquaterra_presence (
  email text PRIMARY KEY REFERENCES aquaterra_players(email) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aquaterra_presence_seen ON aquaterra_presence (seen_at);

CREATE OR REPLACE FUNCTION aquaterra_avatar_styles() RETURNS text[] LANGUAGE sql IMMUTABLE AS
$fn$ SELECT ARRAY['drop','explorer','builder','sailor','scholar','pilot','diver','robot','astronaut','wisp'] $fn$;

CREATE OR REPLACE FUNCTION aquaterra_avatar_json(who text) RETURNS jsonb LANGUAGE sql STABLE AS
$fn$ SELECT jsonb_build_object('style', p.avatar, 'hue', p.avatar_hue, 'visible', p.on_map) FROM aquaterra_players p WHERE p.email = who $fn$;

-- The first AI companion of a resident (NICS AI Agents swapped in at the Heritage Port), shown
-- next to their avatar: its name, or null. Safe before the heritage migration.
CREATE OR REPLACE FUNCTION aquaterra_companion_of(who text) RETURNS text LANGUAGE plpgsql STABLE AS $fn$
DECLARE v text;
BEGIN
  IF to_regclass('aquaterra_companions') IS NULL THEN RETURN NULL; END IF;
  EXECUTE format('SELECT name FROM aquaterra_companions WHERE email = %L ORDER BY since, token_id LIMIT 1', who) INTO v;
  RETURN v;
END $fn$;

-- The residents API. req: {action, session, style?, hue?, visible?}. Returns {ok, ...} or {ok:false, error, status}.
CREATE OR REPLACE FUNCTION aquaterra_residents(req jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  act text := req->>'action';
  me text;
  res jsonb := '{}'::jsonb;
  v_style text; v_hue int;
BEGIN
  IF COALESCE(req->>'session', '') <> '' THEN
    SELECT p.email INTO me
    FROM aquaterra_sessions s JOIN aquaterra_players p ON p.email = s.email
    WHERE s.token_hash = encode(sha256(convert_to(req->>'session', 'UTF8')), 'hex') AND s.expires_at > now();
  END IF;
  IF me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401);
  END IF;

  BEGIN
    IF act = 'me' THEN
      res := jsonb_build_object('avatar', aquaterra_avatar_json(me));

    ELSIF act = 'set_avatar' THEN
      v_style := req->>'style';
      IF v_style IS NULL OR NOT (v_style = ANY (aquaterra_avatar_styles())) THEN RAISE EXCEPTION 'style'; END IF;
      v_hue := (req->>'hue')::int;
      IF v_hue IS NULL OR v_hue < 0 OR v_hue > 359 THEN RAISE EXCEPTION 'hue'; END IF;
      UPDATE aquaterra_players SET avatar = v_style, avatar_hue = v_hue,
        on_map = COALESCE((req->>'visible')::boolean, on_map) WHERE email = me;
      res := jsonb_build_object('avatar', aquaterra_avatar_json(me));

    ELSIF act = 'map' THEN
      -- I am here: one write a minute at most
      INSERT INTO aquaterra_presence (email, seen_at) VALUES (me, now())
      ON CONFLICT (email) DO UPDATE SET seen_at = now() WHERE aquaterra_presence.seen_at < now() - interval '1 minute';
      WITH r AS (
        SELECT p.email, p.display_name, p.role, p.avatar, p.avatar_hue, l.x, l.y, l.district_id,
               greatest(pr.seen_at, p.last_login_at) AS seen
        FROM aquaterra_players p
        JOIN aquaterra_locations l ON l.email = p.email
        LEFT JOIN aquaterra_presence pr ON pr.email = p.email
        WHERE p.on_map AND p.email <> me
          AND greatest(pr.seen_at, p.last_login_at) > now() - interval '7 days'
        ORDER BY greatest(pr.seen_at, p.last_login_at) DESC
        LIMIT 500
      )
      SELECT jsonb_build_object(
        'residents', COALESCE(jsonb_agg(jsonb_build_object(
          'key', left(md5(r.email), 10),
          'name', COALESCE(r.display_name, 'Citizen'),
          'style', COALESCE(r.avatar, 'drop'),
          'hue', r.avatar_hue,
          'x', r.x, 'y', r.y, 'district', r.district_id,
          'online', r.seen > now() - interval '5 minutes',
          'council', EXISTS (SELECT 1 FROM aquaterra_council c WHERE c.email = r.email),
          'companion', aquaterra_companion_of(r.email))), '[]'::jsonb),
        'online', count(*) FILTER (WHERE r.seen > now() - interval '5 minutes'),
        'recent', count(*))
      INTO res FROM r;
      res := res || jsonb_build_object('avatar', aquaterra_avatar_json(me), 'companion', aquaterra_companion_of(me));
    ELSE
      RAISE EXCEPTION 'action';
    END IF;
  EXCEPTION
    WHEN raise_exception THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'status', 400);
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('ok', false, 'error', 'hue', 'status', 400);
  END;

  RETURN jsonb_build_object('ok', true, 'status', 200) || res;
END $fn$;
