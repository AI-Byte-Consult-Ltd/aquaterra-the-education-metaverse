-- NICS AI conversations with residents: consent, the anonymised dialog log
-- that NICS Language learns from, and the switch for live model answers.
-- n8n "[66 PUBLIC] AquaTerra NICS Dialog" passes each request body to
-- aquaterra_nics(req) and returns the result as it is.
--
-- Safe to run again: tables use IF NOT EXISTS, functions are replaced.
-- One-off migration only, never per request.
-- n8n quirks: write $fn$ (never two dollars), \Z instead of dollar-quote ends.

CREATE TABLE IF NOT EXISTS aquaterra_nics_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- salt: makes the resident number one-way. export_key: what the training
-- machine sends to fetch new dialog lines. Both stay in the database only.
INSERT INTO aquaterra_nics_settings (key, value) VALUES
  ('queue_enabled', '0'),
  ('terms_version', '2026-11-24'),
  ('salt', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)),
  ('export_key', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text))
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS aquaterra_nics_consent (
  email text PRIMARY KEY REFERENCES aquaterra_players(email) ON DELETE CASCADE,
  consent boolean NOT NULL,
  terms_version text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aquaterra_nics_dialogs (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  lang text NOT NULL,
  resident text NOT NULL,
  qtype text NOT NULL,
  question text NOT NULL,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  answer text NOT NULL,
  source text NOT NULL CHECK (source IN ('phrase', 'model')),
  rating smallint CHECK (rating IN (-1, 1)),
  rated_at timestamptz
);
CREATE INDEX IF NOT EXISTS aquaterra_nics_dialogs_resident ON aquaterra_nics_dialogs (resident, at);

CREATE OR REPLACE FUNCTION aquaterra_nics_setting(k text) RETURNS text
LANGUAGE sql STABLE AS $fn$ SELECT value FROM aquaterra_nics_settings WHERE key = k $fn$;

-- The anonymised resident number: the same for one resident, never reversible to the email.
CREATE OR REPLACE FUNCTION aquaterra_nics_resident(e text) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT 'r_' || left(encode(sha256(convert_to(aquaterra_nics_setting('salt') || lower(e), 'UTF8')), 'hex'), 16)
$fn$;

-- Remove what looks like personal data from free text before it is stored.
CREATE OR REPLACE FUNCTION aquaterra_nics_scrub(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    COALESCE(t, ''),
    '[[:cntrl:]]+', ' ', 'g'),
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g'),
    'https?://[^[:space:]]+', '[link]', 'g'),
    '\+?[0-9][0-9 ()-]{6,}[0-9]', '[number]', 'g'))
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_nics_err(code text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$ SELECT jsonb_build_object('ok', false, 'error', code) $fn$;

CREATE OR REPLACE FUNCTION aquaterra_nics_line(d aquaterra_nics_dialogs) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('id', d.id, 'ts', to_char(d.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'lang', d.lang,
    'resident', d.resident, 'qtype', d.qtype, 'question', d.question, 'facts', d.facts, 'answer', d.answer,
    'source', d.source, 'rating', d.rating)
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_nics(req jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  act text := COALESCE(req->>'action', '');
  me text;
  who text;
  c aquaterra_nics_consent;
  facts jsonb := '{}'::jsonb;
  k text;
  v jsonb;
  n int;
  new_id bigint;
  qtypes text[] := ARRAY['greeting', 'about_nics', 'wallet', 'my_plots', 'buy_land', 'earn', 'treasury', 'laws',
    'council', 'elections', 'vote', 'home', 'tower', 'travel', 'help', 'unknown'];
  langs text[] := ARRAY['en', 'fr', 'it', 'de', 'id', 'ar', 'bg', 'ru'];
BEGIN
  -- public: is the live model switched on?
  IF act = 'status' THEN
    RETURN jsonb_build_object('ok', true, 'queue', aquaterra_nics_setting('queue_enabled') = '1',
      'termsVersion', aquaterra_nics_setting('terms_version'));
  END IF;

  -- the training machine fetches new lines, oldest first
  IF act = 'export' THEN
    IF COALESCE(aquaterra_nics_setting('export_key'), '') = '' OR COALESCE(req->>'key', '') <> aquaterra_nics_setting('export_key') THEN
      RETURN aquaterra_nics_err('forbidden');
    END IF;
    n := LEAST(GREATEST(COALESCE(NULLIF(req->>'limit', '')::int, 500), 1), 2000);
    RETURN jsonb_build_object('ok', true, 'lines', COALESCE((SELECT jsonb_agg(aquaterra_nics_line(d) ORDER BY d.id) FROM (
      SELECT * FROM aquaterra_nics_dialogs WHERE id > COALESCE(NULLIF(req->>'after', '')::bigint, 0) ORDER BY id LIMIT n) d), '[]'::jsonb));
  END IF;

  SELECT email INTO me FROM aquaterra_sessions
  WHERE token_hash = encode(sha256(convert_to(COALESCE(req->>'session', ''), 'UTF8')), 'hex') AND expires_at > now();
  IF me IS NULL THEN RETURN aquaterra_nics_err('session'); END IF;
  who := aquaterra_nics_resident(me);
  SELECT * INTO c FROM aquaterra_nics_consent WHERE email = me;

  IF act = 'consent' THEN
    RETURN jsonb_build_object('ok', true, 'consent', c.consent, 'termsVersion', aquaterra_nics_setting('terms_version'),
      'queue', aquaterra_nics_setting('queue_enabled') = '1');
  END IF;

  IF act = 'set_consent' THEN
    IF jsonb_typeof(req->'consent') <> 'boolean' THEN RETURN aquaterra_nics_err('consent'); END IF;
    INSERT INTO aquaterra_nics_consent (email, consent, terms_version) VALUES (me, (req->>'consent')::boolean, aquaterra_nics_setting('terms_version'))
    ON CONFLICT (email) DO UPDATE SET consent = EXCLUDED.consent, terms_version = EXCLUDED.terms_version, at = now();
    RETURN jsonb_build_object('ok', true, 'consent', (req->>'consent')::boolean);
  END IF;

  -- withdraw consent and delete every line this resident gave
  IF act = 'forget' THEN
    DELETE FROM aquaterra_nics_dialogs WHERE resident = who;
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO aquaterra_nics_consent (email, consent, terms_version) VALUES (me, false, aquaterra_nics_setting('terms_version'))
    ON CONFLICT (email) DO UPDATE SET consent = false, at = now();
    RETURN jsonb_build_object('ok', true, 'deleted', n);
  END IF;

  IF act = 'log' THEN
    -- only with consent; without it nothing is stored
    IF c.consent IS NOT TRUE THEN RETURN jsonb_build_object('ok', true, 'logged', false); END IF;
    IF NOT (COALESCE(req->>'qtype', '') = ANY (qtypes)) THEN RETURN aquaterra_nics_err('qtype'); END IF;
    IF NOT (COALESCE(req->>'source', '') IN ('phrase', 'model')) THEN RETURN aquaterra_nics_err('source'); END IF;
    IF length(COALESCE(req->>'answer', '')) NOT BETWEEN 1 AND 800 OR length(COALESCE(req->>'question', '')) > 500 THEN
      RETURN aquaterra_nics_err('length');
    END IF;
    SELECT count(*) INTO n FROM aquaterra_nics_dialogs WHERE resident = who AND at > now() - interval '1 hour';
    IF n >= 120 THEN RETURN jsonb_build_object('ok', true, 'logged', false); END IF;
    IF jsonb_typeof(req->'facts') = 'object' THEN
      FOR k, v IN SELECT * FROM jsonb_each(req->'facts') LIMIT 30 LOOP
        IF k ~ '^[a-z_]{1,32}\Z' AND jsonb_typeof(v) IN ('string', 'number', 'boolean') THEN
          facts := facts || jsonb_build_object(k, CASE WHEN jsonb_typeof(v) = 'string' THEN to_jsonb(left(aquaterra_nics_scrub(v #>> '{}'), 120)) ELSE v END);
        END IF;
      END LOOP;
    END IF;
    INSERT INTO aquaterra_nics_dialogs (lang, resident, qtype, question, facts, answer, source)
    VALUES (CASE WHEN req->>'lang' = ANY (langs) THEN req->>'lang' ELSE 'en' END, who, req->>'qtype',
      aquaterra_nics_scrub(req->>'question'), facts, aquaterra_nics_scrub(req->>'answer'), req->>'source')
    RETURNING id INTO new_id;
    RETURN jsonb_build_object('ok', true, 'logged', true, 'id', new_id);
  END IF;

  IF act = 'rate' THEN
    IF NOT COALESCE(req->>'rating', '') IN ('1', '-1') OR NOT COALESCE(req->>'id', '') ~ '^\d{1,18}\Z' THEN RETURN aquaterra_nics_err('rating'); END IF;
    UPDATE aquaterra_nics_dialogs SET rating = (req->>'rating')::smallint, rated_at = now()
    WHERE id = (req->>'id')::bigint AND resident = who;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN CASE WHEN n = 1 THEN jsonb_build_object('ok', true) ELSE aquaterra_nics_err('not_found') END;
  END IF;

  -- live model answers: off until the NICS Language queue exists
  IF act = 'ask' THEN
    RETURN jsonb_build_object('ok', true, 'queued', false);
  END IF;
  IF act = 'answer' THEN
    RETURN jsonb_build_object('ok', true, 'ready', false);
  END IF;

  RETURN aquaterra_nics_err('action');
END
$fn$;
