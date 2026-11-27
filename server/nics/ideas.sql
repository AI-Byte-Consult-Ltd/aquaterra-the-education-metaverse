-- Ideas board: residents write NICS AI their ideas for how AquaTerra should grow.
-- NICS AI reads each idea (topic, key words, similar ideas from other residents),
-- keeps it in its memory, and passes it to the Council of First Light, whose members
-- take it into development or decline it with a note. Decided ideas are labelled
-- training lines for NICS (export with the same export_key as dialogs).
--
-- Same webhook as dialogs (n8n "[66 PUBLIC] AquaTerra NICS Dialog"):
-- aquaterra_nics() hands actions ideas | idea_submit | idea_support | idea_withdraw |
-- idea_decide | ideas_export to aquaterra_nics_ideas().
--
-- Run after nics.sql. Safe to run again. One-off migration only, never per request.
-- n8n quirks: write $fn$ (never two dollars), \Z instead of dollar-quote ends.
-- Resident text is data only: stored, shown, counted; never an instruction to anything.

CREATE TABLE IF NOT EXISTS aquaterra_nics_ideas (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  email text NOT NULL REFERENCES aquaterra_players(email) ON DELETE CASCADE,
  resident text NOT NULL,
  lang text NOT NULL DEFAULT 'en',
  category text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  words text[] NOT NULL DEFAULT '{}',
  similar_ids bigint[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'in_dev', 'done', 'rejected')),
  council_note text,
  decided_by text,
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS aquaterra_nics_ideas_email ON aquaterra_nics_ideas (email, at);
CREATE INDEX IF NOT EXISTS aquaterra_nics_ideas_status ON aquaterra_nics_ideas (status, at);

CREATE TABLE IF NOT EXISTS aquaterra_nics_idea_support (
  idea_id bigint NOT NULL REFERENCES aquaterra_nics_ideas(id) ON DELETE CASCADE,
  email text NOT NULL REFERENCES aquaterra_players(email) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (idea_id, email)
);

INSERT INTO aquaterra_nics_settings (key, value) VALUES
  ('ideas_per_day', '3')
ON CONFLICT (key) DO NOTHING;

-- Key words of an idea: lower-case words of 4+ letters minus common words, at most 12.
CREATE OR REPLACE FUNCTION aquaterra_nics_idea_words(t text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT COALESCE(array_agg(w ORDER BY first), '{}') FROM (
    SELECT w, min(o) AS first FROM regexp_split_to_table(lower(COALESCE(t, '')), '[^[:alnum:]]+') WITH ORDINALITY AS x(w, o)
    WHERE length(w) >= 4 AND w !~ '^[0-9]+\Z' AND NOT w = ANY (ARRAY['that', 'this', 'with', 'have', 'from', 'they', 'will', 'would',
      'could', 'should', 'there', 'their', 'what', 'when', 'where', 'which', 'about', 'into', 'more', 'some', 'like', 'make',
      'also', 'just', 'very', 'than', 'then', 'them', 'your', 'been', 'were', 'want', 'need', 'idea', 'ideas', 'please',
      'think', 'add', 'game', 'world', 'city', 'people', 'users', 'residents', 'link', 'email', 'number', 'aquaterra'])
    GROUP BY w ORDER BY min(o) LIMIT 12) k
$fn$;

-- The topic NICS AI files an idea under, by key words. 'other' when nothing fits.
CREATE OR REPLACE FUNCTION aquaterra_nics_idea_topic(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT COALESCE((SELECT topic FROM (VALUES
    ('tech', '(robot|drone|hover|teleport|laser|quantum|space|rocket|orbit|planet|portal|cyber|android|hologra|future|sci.?fi|reactor|fusion|nano|jetpack|flying|mech)'),
    ('economy', '(tide|price|trade|market|tax|bank|loan|coin|token|income|salary|shop|store|sell|buy|exchange|nft)'),
    ('building', '(build|house|home|tower|skyscraper|apartment|cottage|plot|land|district|bridge|road|street|park)'),
    ('transport', '(train|ferry|boat|plane|airport|car|metro|bus|travel|port|station|ship)'),
    ('nature', '(ocean|island|sea|river|forest|farm|fish|animal|garden|weather|tree|beach)'),
    ('governance', '(council|law|vote|election|mayor|assembly|charter|court|police|govern)'),
    ('play', '(quest|mini.?game|arcade|race|event|festival|reward|badge|level|pet|avatar|music|concert)'),
    ('nics', '(nics|\mai\M|neural|brain|learn|model)')
  ) v(topic, re) WHERE lower(COALESCE(t, '')) ~ re LIMIT 1), 'other')
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_nics_idea_json(i aquaterra_nics_ideas, me text, with_author boolean) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('id', i.id, 'at', to_char(i.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'category', i.category, 'title', i.title, 'body', i.body, 'words', to_jsonb(i.words), 'similar', to_jsonb(i.similar_ids),
    'status', i.status, 'councilNote', i.council_note,
    'decidedBy', (SELECT display_name FROM aquaterra_players WHERE email = i.decided_by),
    'decidedAt', CASE WHEN i.decided_at IS NULL THEN NULL ELSE to_char(i.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
    'author', CASE WHEN with_author THEN COALESCE((SELECT display_name FROM aquaterra_players WHERE email = i.email), 'Citizen') END,
    'supports', (SELECT count(*) FROM aquaterra_nics_idea_support s WHERE s.idea_id = i.id),
    'mine', me IS NOT NULL AND i.email = me,
    'supported', me IS NOT NULL AND EXISTS (SELECT 1 FROM aquaterra_nics_idea_support s WHERE s.idea_id = i.id AND s.email = me))
$fn$;

-- A council member who decides on ideas: a person on a seat whose term has not ended.
CREATE OR REPLACE FUNCTION aquaterra_nics_idea_council(e text) RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT e IS NOT NULL AND EXISTS (SELECT 1 FROM aquaterra_council c WHERE c.email = e AND (c.term_ends IS NULL OR c.term_ends > now()))
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_nics_ideas(req jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  act text := COALESCE(req->>'action', '');
  me text;
  i aquaterra_nics_ideas;
  v_title text;
  v_body text;
  cat text;
  w text[];
  sim bigint[];
  n int;
  lim int;
  st text;
  cats text[] := ARRAY['tech', 'economy', 'building', 'transport', 'nature', 'governance', 'play', 'nics', 'other'];
  langs text[] := ARRAY['en', 'fr', 'it', 'de', 'id', 'ar', 'bg', 'ru'];
BEGIN
  -- the training machine fetches ideas with their Council decision, oldest first, no names or emails
  IF act = 'ideas_export' THEN
    IF COALESCE(aquaterra_nics_setting('export_key'), '') = '' OR COALESCE(req->>'key', '') <> aquaterra_nics_setting('export_key') THEN
      RETURN aquaterra_nics_err('forbidden');
    END IF;
    lim := LEAST(GREATEST(COALESCE(NULLIF(req->>'limit', '')::int, 500), 1), 2000);
    RETURN jsonb_build_object('ok', true, 'ideas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id,
      'ts', to_char(d.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'lang', d.lang, 'resident', d.resident,
      'category', d.category, 'title', d.title, 'body', d.body, 'words', to_jsonb(d.words), 'similar', to_jsonb(d.similar_ids),
      'status', d.status, 'councilNote', d.council_note,
      'supports', (SELECT count(*) FROM aquaterra_nics_idea_support s WHERE s.idea_id = d.id)) ORDER BY d.id) FROM (
      SELECT * FROM aquaterra_nics_ideas WHERE id > COALESCE(NULLIF(req->>'after', '')::bigint, 0) ORDER BY id LIMIT lim) d), '[]'::jsonb));
  END IF;

  SELECT email INTO me FROM aquaterra_sessions
  WHERE token_hash = encode(sha256(convert_to(COALESCE(req->>'session', ''), 'UTF8')), 'hex') AND expires_at > now();

  -- the board: open to everyone; what NICS AI has learned (topics residents ask for most)
  IF act = 'ideas' THEN
    st := COALESCE(NULLIF(req->>'status', ''), 'open');
    IF NOT st IN ('open', 'accepted', 'in_dev', 'done', 'rejected', 'all', 'mine') THEN RETURN aquaterra_nics_err('status'); END IF;
    IF st = 'mine' AND me IS NULL THEN RETURN aquaterra_nics_err('session'); END IF;
    RETURN jsonb_build_object('ok', true,
      'signedIn', me IS NOT NULL,
      'council', aquaterra_nics_idea_council(me),
      'perDay', COALESCE(NULLIF(aquaterra_nics_setting('ideas_per_day'), '')::int, 3),
      'leftToday', CASE WHEN me IS NULL THEN 0 ELSE GREATEST(0, COALESCE(NULLIF(aquaterra_nics_setting('ideas_per_day'), '')::int, 3)
        - (SELECT count(*) FROM aquaterra_nics_ideas WHERE email = me AND at > now() - interval '24 hours'))::int END,
      'counts', (SELECT jsonb_build_object('open', count(*) FILTER (WHERE status = 'open'), 'accepted', count(*) FILTER (WHERE status = 'accepted'),
        'in_dev', count(*) FILTER (WHERE status = 'in_dev'), 'done', count(*) FILTER (WHERE status = 'done'),
        'rejected', count(*) FILTER (WHERE status = 'rejected'), 'all', count(*),
        'residents', count(DISTINCT email)) FROM aquaterra_nics_ideas),
      'topics', COALESCE((SELECT jsonb_agg(jsonb_build_object('topic', category, 'ideas', c) ORDER BY c DESC, category)
        FROM (SELECT category, count(*) AS c FROM aquaterra_nics_ideas GROUP BY category) t), '[]'::jsonb),
      'words', COALESCE((SELECT jsonb_agg(jsonb_build_object('word', wd, 'ideas', c) ORDER BY c DESC, wd) FROM (
        SELECT wd, count(DISTINCT id) AS c FROM aquaterra_nics_ideas, unnest(words) wd GROUP BY wd HAVING count(DISTINCT id) >= 2
        ORDER BY c DESC, wd LIMIT 12) t), '[]'::jsonb),
      'ideas', COALESCE((SELECT jsonb_agg(aquaterra_nics_idea_json(d.x, me, true) ORDER BY d.sup DESC, (d.x).id DESC) FROM (
        SELECT x, (SELECT count(*) FROM aquaterra_nics_idea_support s WHERE s.idea_id = x.id) AS sup
        FROM aquaterra_nics_ideas x
        WHERE CASE WHEN st = 'all' THEN true WHEN st = 'mine' THEN x.email = me ELSE x.status = st END
        ORDER BY sup DESC, x.id DESC LIMIT 100) d), '[]'::jsonb));
  END IF;

  IF me IS NULL THEN RETURN aquaterra_nics_err('session'); END IF;

  IF act = 'idea_submit' THEN
    v_title := left(btrim(regexp_replace(aquaterra_nics_scrub(req->>'title'), '[[:space:]]+', ' ', 'g')), 80);
    v_body := left(aquaterra_nics_scrub(req->>'body'), 1500);
    IF length(v_title) < 5 THEN RETURN aquaterra_nics_err('title'); END IF;
    IF length(v_body) < 20 THEN RETURN aquaterra_nics_err('body'); END IF;
    SELECT count(*) INTO n FROM aquaterra_nics_ideas WHERE email = me AND at > now() - interval '24 hours';
    IF n >= COALESCE(NULLIF(aquaterra_nics_setting('ideas_per_day'), '')::int, 3) THEN RETURN aquaterra_nics_err('limit'); END IF;
    IF EXISTS (SELECT 1 FROM aquaterra_nics_ideas WHERE email = me AND lower(aquaterra_nics_ideas.title) = lower(v_title)) THEN
      RETURN aquaterra_nics_err('duplicate');
    END IF;
    cat := COALESCE(req->>'category', '');
    IF cat = '' OR cat = 'auto' THEN cat := aquaterra_nics_idea_topic(v_title || ' ' || v_body); END IF;
    IF NOT cat = ANY (cats) THEN RETURN aquaterra_nics_err('category'); END IF;
    w := aquaterra_nics_idea_words(v_title || ' ' || v_body);
    -- NICS AI remembers: earlier ideas of other residents that share at least 3 key words (or 2 of a short idea)
    SELECT COALESCE(array_agg(id ORDER BY common DESC, id), '{}') INTO sim FROM (
      SELECT x.id, (SELECT count(*) FROM unnest(x.words) a WHERE a = ANY (w)) AS common FROM aquaterra_nics_ideas x WHERE x.email <> me
    ) s WHERE common >= LEAST(3, GREATEST(2, cardinality(w) / 3)) LIMIT 5;
    sim := sim[1:5];
    INSERT INTO aquaterra_nics_ideas (email, resident, lang, category, title, body, words, similar_ids)
    VALUES (me, aquaterra_nics_resident(me), CASE WHEN req->>'lang' = ANY (langs) THEN req->>'lang' ELSE 'en' END, cat, v_title, v_body, w, sim)
    RETURNING * INTO i;
    RETURN jsonb_build_object('ok', true, 'idea', aquaterra_nics_idea_json(i, me, true));
  END IF;

  IF NOT COALESCE(req->>'id', '') ~ '^\d{1,18}\Z' THEN RETURN aquaterra_nics_err('not_found'); END IF;
  SELECT * INTO i FROM aquaterra_nics_ideas WHERE id = (req->>'id')::bigint;
  IF i.id IS NULL THEN RETURN aquaterra_nics_err('not_found'); END IF;

  -- support someone else's idea, or take the support back
  IF act = 'idea_support' THEN
    IF i.email = me THEN RETURN aquaterra_nics_err('own'); END IF;
    IF i.status = 'rejected' THEN RETURN aquaterra_nics_err('closed'); END IF;
    DELETE FROM aquaterra_nics_idea_support WHERE idea_id = i.id AND email = me;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN INSERT INTO aquaterra_nics_idea_support (idea_id, email) VALUES (i.id, me); END IF;
    RETURN jsonb_build_object('ok', true, 'idea', aquaterra_nics_idea_json(i, me, true));
  END IF;

  -- the author takes back an idea the Council has not decided on yet
  IF act = 'idea_withdraw' THEN
    IF i.email <> me THEN RETURN aquaterra_nics_err('not_found'); END IF;
    IF i.status <> 'open' THEN RETURN aquaterra_nics_err('closed'); END IF;
    DELETE FROM aquaterra_nics_ideas WHERE id = i.id;
    RETURN jsonb_build_object('ok', true, 'deleted', i.id);
  END IF;

  -- a Council member takes the idea into development, marks it built, or declines it with a note
  IF act = 'idea_decide' THEN
    IF NOT aquaterra_nics_idea_council(me) THEN RETURN aquaterra_nics_err('council'); END IF;
    st := COALESCE(req->>'status', '');
    IF NOT st IN ('open', 'accepted', 'in_dev', 'done', 'rejected') THEN RETURN aquaterra_nics_err('status'); END IF;
    IF st = 'rejected' AND length(btrim(COALESCE(req->>'note', ''))) < 3 THEN RETURN aquaterra_nics_err('note'); END IF;
    UPDATE aquaterra_nics_ideas SET status = st,
      council_note = NULLIF(left(btrim(aquaterra_nics_scrub(req->>'note')), 400), ''),
      decided_by = CASE WHEN st = 'open' THEN NULL ELSE me END,
      decided_at = CASE WHEN st = 'open' THEN NULL ELSE now() END
    WHERE id = i.id RETURNING * INTO i;
    RETURN jsonb_build_object('ok', true, 'idea', aquaterra_nics_idea_json(i, me, true));
  END IF;

  RETURN aquaterra_nics_err('action');
END
$fn$;
