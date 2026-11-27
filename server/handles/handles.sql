-- AquaTerra handles: every resident has a unique Latin @handle (a-z, 0-9, _; 3-20 chars).
-- One-off migration, safe to run twice. Tide transfers, the map, the rich list and the
-- markets use it. API: aquaterra_handles(req) behind n8n "[72 PUBLIC] AquaTerra Handles".

ALTER TABLE aquaterra_players ADD COLUMN IF NOT EXISTS handle text;
-- true while the handle was made by the server from the name: the first own pick is free
ALTER TABLE aquaterra_players ADD COLUMN IF NOT EXISTS handle_auto boolean NOT NULL DEFAULT true;
ALTER TABLE aquaterra_players ADD COLUMN IF NOT EXISTS handle_changed_at timestamptz;

CREATE OR REPLACE FUNCTION aquaterra_handle_reserved(h text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $q$
  SELECT h = ANY (ARRAY['admin', 'administrator', 'founder', 'nics', 'nics_ai', 'nicsai', 'nics_world', 'city_mind',
    'aquaterra', 'aquaterra_world', 'treasury', 'reserve', 'state', 'state_treasury', 'council', 'directorate',
    'assembly', 'system', 'support', 'help', 'official', 'moderator', 'mod', 'staff', 'bank', 'market', 'tide',
    'citizen', 'resident', 'everyone', 'all', 'null', 'undefined', 'first_light', 'firstlight', 'mayor', 'heritage'])
    OR h LIKE 'nics%' OR h LIKE 'aquaterra%'
$q$;

-- "Mary Ann.Lee" -> "mary_ann_lee"
CREATE OR REPLACE FUNCTION aquaterra_handle_base(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $q$
  SELECT CASE WHEN length(b) >= 3 THEN b ELSE 'resident' END
  FROM (SELECT btrim(left(btrim(regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', '_', 'g'), '_'), 16), '_') AS b) s
$q$;

CREATE OR REPLACE FUNCTION aquaterra_handle_ok(h text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $q$
  SELECT coalesce(h ~ '^[a-z0-9_]{3,20}\Z' AND h !~ '^_|_\Z|__' AND NOT aquaterra_handle_reserved(h), false)
$q$;

-- First free handle for this base: base, base2, base3 ...
CREATE OR REPLACE FUNCTION aquaterra_handle_free(base text, who text) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE cand text; n int := 1;
BEGIN
  LOOP
    cand := CASE WHEN n = 1 THEN base ELSE left(base, 20 - length(n::text)) || n END;
    IF NOT aquaterra_handle_reserved(cand)
       AND NOT EXISTS (SELECT 1 FROM aquaterra_players WHERE handle = cand AND email IS DISTINCT FROM who) THEN
      RETURN cand;
    END IF;
    n := n + 1;
    IF n > 9999 THEN RETURN 'r' || substr(md5(random()::text), 1, 12); END IF;
  END LOOP;
END $fn$;

-- New residents get a temporary handle; while it is still automatic it follows the first name they choose.
CREATE OR REPLACE FUNCTION aquaterra_handle_trg() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.handle IS NULL THEN
    NEW.handle := CASE WHEN NEW.display_name IS NULL THEN 'resident_' || lpad((floor(random() * 100000000))::bigint::text, 8, '0')
                       ELSE aquaterra_handle_free(aquaterra_handle_base(NEW.display_name), NEW.email) END;
    NEW.handle_auto := true;
  ELSIF TG_OP = 'UPDATE' AND NEW.handle_auto AND NEW.handle = OLD.handle AND NEW.display_name IS NOT NULL
        AND NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    NEW.handle := aquaterra_handle_free(aquaterra_handle_base(NEW.display_name), NEW.email);
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS aquaterra_players_handle ON aquaterra_players;
CREATE TRIGGER aquaterra_players_handle BEFORE INSERT OR UPDATE OF display_name, handle ON aquaterra_players
  FOR EACH ROW EXECUTE FUNCTION aquaterra_handle_trg();

-- Existing residents: the oldest account gets the clean name.
DO $do$
DECLARE r record;
BEGIN
  FOR r IN SELECT email, display_name FROM aquaterra_players WHERE handle IS NULL ORDER BY created_at, email LOOP
    UPDATE aquaterra_players SET handle = aquaterra_handle_free(aquaterra_handle_base(r.display_name), r.email), handle_auto = true
    WHERE email = r.email;
  END LOOP;
END $do$;

CREATE UNIQUE INDEX IF NOT EXISTS aquaterra_players_handle_uq ON aquaterra_players (handle);
ALTER TABLE aquaterra_players ALTER COLUMN handle SET NOT NULL;

CREATE OR REPLACE FUNCTION aquaterra_handles(req jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  act text := req->>'action';
  me text; p aquaterra_players%ROWTYPE;
  h text; q text; res jsonb;
  wait interval := interval '30 days';
BEGIN
  IF coalesce(req->>'session', '') <> '' THEN
    SELECT s.email INTO me FROM aquaterra_sessions s
    WHERE s.token_hash = encode(sha256(convert_to(req->>'session', 'UTF8')), 'hex') AND s.expires_at > now();
  END IF;
  IF me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401); END IF;
  SELECT * INTO p FROM aquaterra_players WHERE email = me;

  IF act IN ('check', 'set') THEN
    h := lower(ltrim(btrim(coalesce(req->>'handle', '')), '@'));
    IF h = p.handle THEN RETURN jsonb_build_object('ok', true, 'handle', h, 'free', true, 'mine', true); END IF;
    IF h !~ '^[a-z0-9_]{3,20}\Z' OR h ~ '^_|_\Z|__' THEN RETURN jsonb_build_object('ok', false, 'error', 'format', 'status', 400); END IF;
    IF aquaterra_handle_reserved(h) THEN RETURN jsonb_build_object('ok', false, 'error', 'reserved', 'status', 409); END IF;
    IF EXISTS (SELECT 1 FROM aquaterra_players WHERE handle = h) THEN RETURN jsonb_build_object('ok', false, 'error', 'taken', 'status', 409); END IF;
    IF act = 'check' THEN RETURN jsonb_build_object('ok', true, 'handle', h, 'free', true); END IF;
    IF NOT p.handle_auto AND p.handle_changed_at > now() - wait THEN
      RETURN jsonb_build_object('ok', false, 'error', 'too_soon', 'next', p.handle_changed_at + wait, 'status', 429);
    END IF;
    BEGIN
      UPDATE aquaterra_players SET handle = h, handle_auto = false, handle_changed_at = now() WHERE email = me;
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'error', 'taken', 'status', 409);
    END;
    SELECT * INTO p FROM aquaterra_players WHERE email = me;
  END IF;

  IF act IN ('me', 'set') THEN
    RETURN jsonb_build_object('ok', true, 'handle', p.handle, 'auto', p.handle_auto,
      'next', CASE WHEN p.handle_auto OR p.handle_changed_at IS NULL THEN NULL ELSE p.handle_changed_at + wait END);
  END IF;

  IF act = 'search' THEN
    q := lower(ltrim(btrim(coalesce(req->>'q', '')), '@'));
    IF length(q) < 1 OR length(q) > 24 THEN RETURN jsonb_build_object('ok', true, 'results', '[]'::jsonb); END IF;
    q := regexp_replace(q, '[^a-z0-9_ ]', '', 'g');
    IF q = '' THEN RETURN jsonb_build_object('ok', true, 'results', '[]'::jsonb); END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('handle', x.handle, 'name', COALESCE(x.display_name, 'Citizen'))), '[]'::jsonb) INTO res
    FROM (SELECT handle, display_name FROM aquaterra_players
          WHERE email <> me AND (left(handle, length(q)) = q OR lower(display_name) ~ ('(^|[^a-z0-9])' || q))
          ORDER BY (handle = q) DESC, (left(handle, length(q)) = q) DESC, length(handle), handle
          LIMIT 8) x;
    RETURN jsonb_build_object('ok', true, 'results', res);
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'action', 'status', 400);
END $fn$;

-- Patches of existing functions: each checks its anchor and is skipped once applied.
DO $do$
DECLARE src text;
BEGIN
  -- 1. Names everywhere (markets, plot owners, histories): "Name @handle"
  src := pg_get_functiondef('aquaterra_name(text)'::regprocedure);
  IF position('@'' || handle' IN src) = 0 THEN
    IF position('COALESCE((SELECT display_name FROM aquaterra_players WHERE email = acct), ''Citizen'')' IN src) = 0 THEN
      RAISE EXCEPTION 'handles: aquaterra_name anchor not found'; END IF;
    src := replace(src, 'COALESCE((SELECT display_name FROM aquaterra_players WHERE email = acct), ''Citizen'')',
      'COALESCE((SELECT COALESCE(display_name, ''Citizen'') || '' @'' || handle FROM aquaterra_players WHERE email = acct), ''Citizen'')');
    EXECUTE src;
  END IF;

  -- 2. Transfers by @handle (a bare word is tried as a handle first, then as a name)
  src := pg_get_functiondef('aquaterra_economy(jsonb)'::regprocedure);
  IF position('handle = lower(ltrim(btrim(req->>''to''), ''@''))' IN src) = 0 THEN
    IF (length(src) - length(replace(src, 'WHERE lower(display_name) = lower(btrim(req->>''to''));', '')))
       <> length('WHERE lower(display_name) = lower(btrim(req->>''to''));') THEN
      RAISE EXCEPTION 'handles: transfer anchor not found exactly once'; END IF;
    IF position('WHERE email = lower(btrim(req->>''to'')) OR lower(display_name) = lower(btrim(req->>''to''));' IN src) = 0 THEN
      RAISE EXCEPTION 'handles: grant anchor not found'; END IF;
    src := replace(src, 'WHERE lower(display_name) = lower(btrim(req->>''to''));',
      'WHERE handle = lower(ltrim(btrim(req->>''to''), ''@''))
         OR (left(btrim(req->>''to''), 1) <> ''@'' AND lower(display_name) = lower(btrim(req->>''to''))
             AND NOT EXISTS (SELECT 1 FROM aquaterra_players h2 WHERE h2.handle = lower(btrim(req->>''to''))));');
    src := replace(src, 'WHERE email = lower(btrim(req->>''to'')) OR lower(display_name) = lower(btrim(req->>''to''));',
      'WHERE email = lower(btrim(req->>''to'')) OR handle = lower(ltrim(btrim(req->>''to''), ''@''))
         OR (left(btrim(req->>''to''), 1) <> ''@'' AND lower(display_name) = lower(btrim(req->>''to''))
             AND NOT EXISTS (SELECT 1 FROM aquaterra_players h2 WHERE h2.handle = lower(btrim(req->>''to''))));');
    EXECUTE src;
  END IF;

  -- 3. Residents on the map carry their handle
  IF to_regprocedure('aquaterra_residents(jsonb)') IS NOT NULL THEN
    src := pg_get_functiondef('aquaterra_residents(jsonb)'::regprocedure);
    IF position('''handle'', r.handle' IN src) = 0 THEN
      IF position('SELECT p.email, p.display_name, p.role,' IN src) = 0 OR position('''name'', COALESCE(r.display_name, ''Citizen''),' IN src) = 0 THEN
        RAISE EXCEPTION 'handles: residents anchor not found'; END IF;
      src := replace(src, 'SELECT p.email, p.display_name, p.role,', 'SELECT p.email, p.display_name, p.handle, p.role,');
      src := replace(src, '''name'', COALESCE(r.display_name, ''Citizen''),', '''name'', COALESCE(r.display_name, ''Citizen''), ''handle'', r.handle,');
      EXECUTE src;
    END IF;
  END IF;

  -- 4. Rich list rows carry the handle
  IF to_regprocedure('aquaterra_richlist(integer)') IS NOT NULL THEN
    src := pg_get_functiondef('aquaterra_richlist(integer)'::regprocedure);
    IF position('''handle'', handle' IN src) = 0 THEN
      IF position('AS name, pl.role,' IN src) = 0 OR position('SELECT p.name, p.role,' IN src) = 0 OR position('''rank'', rk, ''name'', name,' IN src) = 0 THEN
        RAISE EXCEPTION 'handles: richlist anchor not found'; END IF;
      src := replace(src, 'AS name, pl.role,', 'AS name, pl.handle, pl.role,');
      src := replace(src, 'SELECT p.name, p.role,', 'SELECT p.name, p.handle, p.role,');
      src := replace(src, '''rank'', rk, ''name'', name,', '''rank'', rk, ''name'', name, ''handle'', handle,');
      EXECUTE src;
    END IF;
  END IF;
END $do$;
