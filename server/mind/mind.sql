-- AquaTerra City Mind: the bridge between the game and the NICS lab.
-- ONE model: NICS Language lives and trains in the NICS lab. The game keeps a register of
-- the lab's numbered releases (the files stay where the lab publishes them), says which one
-- is live, and hands consented game data back to the lab's training.
-- n8n "[74 PUBLIC] AquaTerra City Mind" passes each request body to aquaterra_mind(req).
--
-- One-off migration (never per request). Safe to run again. Needs nics.sql, governance, quests.
-- n8n quirks: write $fn$ (never two dollars), no dollar sign right before a quote.

CREATE TABLE IF NOT EXISTS aquaterra_mind_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- release_key: what the lab sends to register or promote a release. Stays in the database only.
INSERT INTO aquaterra_mind_settings (key, value) VALUES
  ('release_key', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)),
  ('exam_min_pass', '0.9'),         -- share of exam answers that must pass the game's checks
  ('lines_per_resident_day', '40')  -- anti-poisoning: one resident cannot flood the training data
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS aquaterra_mind_releases (
  version int PRIMARY KEY,
  model_id text NOT NULL,
  step int NOT NULL,
  base_url text NOT NULL,           -- folder with manifest.json, weights.bin, tokenizer.json
  manifest jsonb NOT NULL,
  params bigint NOT NULL,
  status text NOT NULL DEFAULT 'shadow' CHECK (status IN ('shadow', 'live', 'retired')),
  exam jsonb,
  registered_at timestamptz NOT NULL DEFAULT now(),
  live_at timestamptz
);

-- residents whose lines are kept out of training (set by hand after abuse)
CREATE TABLE IF NOT EXISTS aquaterra_mind_muted (
  resident text PRIMARY KEY,
  reason text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aquaterra_mind_exports (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  after_id bigint NOT NULL,
  lines int NOT NULL,
  dropped int NOT NULL
);

CREATE OR REPLACE FUNCTION aquaterra_mind_setting(k text) RETURNS text
LANGUAGE sql STABLE AS $fn$ SELECT value FROM aquaterra_mind_settings WHERE key = k $fn$;

CREATE OR REPLACE FUNCTION aquaterra_mind_err(code text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$ SELECT jsonb_build_object('ok', false, 'error', code) $fn$;

CREATE OR REPLACE FUNCTION aquaterra_mind_pub(r aquaterra_mind_releases) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('version', r.version, 'modelId', r.model_id, 'step', r.step, 'params', r.params,
    'status', r.status, 'baseUrl', r.base_url, 'weightsBytes', r.params * CASE WHEN r.manifest->>'dtype' = 'f32' THEN 4 ELSE 2 END,
    'eval', COALESCE(r.manifest->'eval', '{}'::jsonb), 'exam', r.exam,
    'registeredAt', r.registered_at, 'liveAt', r.live_at)
$fn$;

-- The lines the lab may learn from, after the anti-poisoning rules:
-- consent still given, not muted, not rated 👎, the same question from one resident once,
-- at most lines_per_resident_day lines per resident per UTC day.
CREATE OR REPLACE FUNCTION aquaterra_mind_params(m jsonb) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE t jsonb; s jsonb; p bigint; total bigint := 0;
BEGIN
  FOR t IN SELECT * FROM jsonb_array_elements(m->'tensors') LOOP
    p := 1;
    FOR s IN SELECT * FROM jsonb_array_elements(t->'shape') LOOP p := p * (s #>> '{}')::bigint; END LOOP;
    total := total + p;
  END LOOP;
  RETURN total;
END $fn$;

DROP FUNCTION IF EXISTS aquaterra_mind_clean(bigint);
CREATE FUNCTION aquaterra_mind_clean(after_id bigint) RETURNS SETOF aquaterra_nics_dialogs
LANGUAGE sql STABLE AS $fn$
  WITH ok AS (
    SELECT x.*, row_number() OVER (PARTITION BY x.resident, (x.at AT TIME ZONE 'UTC')::date ORDER BY x.id) AS nth,
      row_number() OVER (PARTITION BY x.resident, lower(btrim(x.question)) ORDER BY x.id) AS dup
    FROM aquaterra_nics_dialogs x
    WHERE x.id > after_id
      AND COALESCE(x.rating, 0) <> -1
      AND NOT EXISTS (SELECT 1 FROM aquaterra_mind_muted m WHERE m.resident = x.resident)
      AND EXISTS (SELECT 1 FROM aquaterra_nics_consent c WHERE c.consent AND aquaterra_nics_resident(c.email) = x.resident)
  )
  SELECT o.id, o.at, o.lang, o.resident, o.qtype, o.question, o.facts, o.answer, o.source, o.rating, o.rated_at
  FROM ok o
  WHERE o.nth <= COALESCE(aquaterra_mind_setting('lines_per_resident_day'), '40')::int AND (o.dup = 1 OR btrim(o.question) = '')
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_mind(req jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  act text := COALESCE(req->>'action', '');
  m jsonb := req->'manifest';
  v int;
  n int;
  total int;
  after_id bigint;
  last_id bigint;
  got jsonb;
  r aquaterra_mind_releases;
  rate numeric;
  arch_ok boolean;
BEGIN
  IF act = 'status' THEN
    RETURN jsonb_build_object('ok', true,
      'live', (SELECT aquaterra_mind_pub(x) FROM aquaterra_mind_releases x WHERE status = 'live'),
      'releases', COALESCE((SELECT jsonb_agg(aquaterra_mind_pub(x) ORDER BY x.version DESC)
        FROM (SELECT * FROM aquaterra_mind_releases ORDER BY version DESC LIMIT 12) x), '[]'::jsonb),
      'data', jsonb_build_object(
        'consenting', (SELECT count(*) FROM aquaterra_nics_consent WHERE consent),
        'lines', (SELECT count(*) FROM aquaterra_nics_dialogs),
        'week', (SELECT count(*) FROM aquaterra_nics_dialogs WHERE at > now() - interval '7 days'),
        'sent', COALESCE((SELECT sum(e.lines) FROM aquaterra_mind_exports e), 0),
        'dropped', COALESCE((SELECT sum(e.dropped) FROM aquaterra_mind_exports e), 0),
        'lastFetch', (SELECT max(e.at) FROM aquaterra_mind_exports e)),
      'examMin', aquaterra_mind_setting('exam_min_pass')::numeric);
  END IF;

  -- everything below is for the lab only
  IF act IN ('release', 'promote', 'retire') THEN
    IF COALESCE(req->>'key', '') = '' OR req->>'key' <> COALESCE(aquaterra_mind_setting('release_key'), '') THEN
      RETURN aquaterra_mind_err('forbidden');
    END IF;
  ELSIF act = 'corpus' THEN
    IF COALESCE(req->>'key', '') = '' OR req->>'key' <> COALESCE(aquaterra_nics_setting('export_key'), '') THEN
      RETURN aquaterra_mind_err('forbidden');
    END IF;
  ELSE
    RETURN aquaterra_mind_err('action');
  END IF;

  IF act = 'release' THEN
    IF jsonb_typeof(m) <> 'object' OR m->>'format' IS DISTINCT FROM 'nics-release-v1' THEN RETURN aquaterra_mind_err('format'); END IF;
    IF COALESCE(m->>'version', '') !~ '^[0-9]{1,6}\Z' OR COALESCE(m->>'step', '') !~ '^[0-9]{1,9}\Z' THEN RETURN aquaterra_mind_err('version'); END IF;
    IF COALESCE(req->>'baseUrl', '') !~ '^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._~/-]*)?\Z' THEN RETURN aquaterra_mind_err('url'); END IF;
    IF COALESCE(m->>'weights_sha256', '') !~ '^[0-9a-f]{64}\Z' OR COALESCE(m->>'tokenizer_sha256', '') !~ '^[0-9a-f]{64}\Z' THEN
      RETURN aquaterra_mind_err('checksum');
    END IF;
    arch_ok := m->>'dtype' IN ('f16', 'f32') AND jsonb_typeof(m->'tensors') = 'array'
      AND (m#>>'{config,pos_encoding}') IN ('rope', 'learned')
      AND (m#>>'{config,d_model}')::int % (m#>>'{config,n_heads}')::int = 0;
    IF NOT COALESCE(arch_ok, false) THEN RETURN aquaterra_mind_err('config'); END IF;
    v := (m->>'version')::int;
    IF EXISTS (SELECT 1 FROM aquaterra_mind_releases WHERE version = v) THEN RETURN aquaterra_mind_err('exists'); END IF;
    IF v <= COALESCE((SELECT max(version) FROM aquaterra_mind_releases), 0) THEN RETURN aquaterra_mind_err('older'); END IF;
    INSERT INTO aquaterra_mind_releases (version, model_id, step, base_url, manifest, params)
    VALUES (v, left(COALESCE(m->>'model_id', 'nics'), 60), (m->>'step')::int, rtrim(req->>'baseUrl', '/'), m, aquaterra_mind_params(m))
    RETURNING * INTO r;
    RETURN jsonb_build_object('ok', true, 'release', aquaterra_mind_pub(r));
  END IF;

  IF act = 'promote' THEN
    -- a release goes live only with an exam the game's own checks passed
    v := NULLIF(req->>'version', '')::int;
    SELECT * INTO r FROM aquaterra_mind_releases WHERE version = v FOR UPDATE;
    IF r.version IS NULL THEN RETURN aquaterra_mind_err('not_found'); END IF;
    IF r.status = 'retired' THEN RETURN aquaterra_mind_err('retired'); END IF;
    IF COALESCE(req#>>'{exam,total}', '') !~ '^[0-9]{1,5}\Z' OR COALESCE(req#>>'{exam,passed}', '') !~ '^[0-9]{1,5}\Z'
       OR (req#>>'{exam,total}')::int < 20 OR (req#>>'{exam,passed}')::int > (req#>>'{exam,total}')::int THEN
      RETURN aquaterra_mind_err('exam');
    END IF;
    rate := (req#>>'{exam,passed}')::numeric / (req#>>'{exam,total}')::numeric;
    UPDATE aquaterra_mind_releases SET exam = jsonb_build_object('total', (req#>>'{exam,total}')::int,
      'passed', (req#>>'{exam,passed}')::int, 'rate', round(rate, 3), 'at', now()) WHERE version = v;
    IF rate < aquaterra_mind_setting('exam_min_pass')::numeric THEN
      RETURN jsonb_build_object('ok', true, 'live', false, 'rate', round(rate, 3));
    END IF;
    UPDATE aquaterra_mind_releases SET status = 'retired' WHERE status = 'live' AND version <> v;
    UPDATE aquaterra_mind_releases SET status = 'live', live_at = now() WHERE version = v;
    RETURN jsonb_build_object('ok', true, 'live', true, 'rate', round(rate, 3));
  END IF;

  IF act = 'retire' THEN
    UPDATE aquaterra_mind_releases SET status = 'retired' WHERE version = NULLIF(req->>'version', '')::int;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN CASE WHEN n = 1 THEN jsonb_build_object('ok', true) ELSE aquaterra_mind_err('not_found') END;
  END IF;

  -- act = 'corpus': consented dialog lines (cleaned) + public civic texts, oldest first
  after_id := COALESCE(NULLIF(req->>'after', '')::bigint, 0);
  n := LEAST(GREATEST(COALESCE(NULLIF(req->>'limit', '')::int, 500), 1), 2000);
  SELECT max(id) INTO last_id FROM (SELECT id FROM aquaterra_nics_dialogs WHERE id > after_id ORDER BY id LIMIT n) w;
  SELECT count(*) INTO total FROM aquaterra_nics_dialogs WHERE id > after_id AND id <= COALESCE(last_id, after_id);
  SELECT COALESCE(jsonb_agg(aquaterra_nics_line(c) ORDER BY c.id), '[]'::jsonb) INTO got
  FROM aquaterra_mind_clean(after_id) c WHERE c.id <= COALESCE(last_id, after_id);
  INSERT INTO aquaterra_mind_exports (after_id, lines, dropped) VALUES (after_id, jsonb_array_length(got), total - jsonb_array_length(got));
  RETURN jsonb_build_object('ok', true, 'lines', got, 'next', COALESCE(last_id, after_id),
    'dropped', total - jsonb_array_length(got),
    'civic', CASE WHEN after_id = 0 OR req->>'civic' = 'true' THEN jsonb_build_object(
      'laws', COALESCE((SELECT jsonb_agg(jsonb_build_object('title', l.title, 'body', left(l.body, 4000), 'enacted', l.enacted_at) ORDER BY l.id)
        FROM aquaterra_gov_laws l WHERE l.in_force), '[]'::jsonb),
      'quest_notes', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', q.day, 'note', q.note) ORDER BY q.day)
        FROM aquaterra_quest_days q), '[]'::jsonb)) END);
END
$fn$;
