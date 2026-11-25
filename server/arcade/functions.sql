-- AquaTerra Arcade: rules, games and NICS AI. Loaded by the one-off migration.
-- n8n quirks: no double-dollar quotes (use $fn$), no positional parameters in
-- the text, no dollar sign right before a quote.

-- A number in [0, 1) from a seed and an index. Same seed, same game.
CREATE OR REPLACE FUNCTION aquaterra_arc_rnd(seed text, i int) RETURNS double precision
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT (('x' || substr(md5(seed || ':' || i), 1, 8))::bit(32)::bigint)::double precision / 4294967296.0
$fn$;

-- A law of the Commonwealth, or the default when the state has not set it.
CREATE OR REPLACE FUNCTION aquaterra_arc_param(k text, dflt numeric) RETURNS numeric
LANGUAGE plpgsql STABLE AS $fn$
DECLARE v numeric;
BEGIN
  SELECT value INTO v FROM aquaterra_gov_params WHERE key = k;
  RETURN COALESCE(v, dflt);
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_arc_name(e text) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT CASE WHEN e = 'nics-ai' THEN 'NICS AI' WHEN e IS NULL THEN NULL
    ELSE COALESCE((SELECT display_name FROM aquaterra_players WHERE email = e), 'Citizen') END
$fn$;

-- Wallet names in histories: the economy's list plus the arcade's accounts.
CREATE OR REPLACE FUNCTION aquaterra_name(acct text) RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT CASE WHEN acct = 'treasury' THEN 'AquaTerra Reserve' WHEN acct IS NULL THEN NULL
    WHEN acct = 'state:treasury' THEN 'State Treasury' WHEN acct = 'state:escrow' THEN 'Land auctions'
    WHEN acct LIKE 'state:%' THEN 'State budget'
    WHEN acct = 'bank:first-light' THEN 'Bank of First Light'
    WHEN acct = 'arcade:escrow' THEN 'Prize pools' WHEN acct = 'nics-ai' THEN 'NICS AI'
    ELSE COALESCE((SELECT display_name FROM aquaterra_players WHERE email = acct), 'Citizen') END
$fn$;

-- Coins a citizen may spend on tickets, deposits and rent (welcome coins are for land only).
CREATE OR REPLACE FUNCTION aquaterra_arc_free(e text) RETURNS bigint
LANGUAGE sql STABLE AS $fn$
  SELECT greatest(0, COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = e), 0) - aquaterra_locked(e))::bigint
$fn$;

-- Move coins and tag the ledger row. Raises 'insufficient' and friends.
CREATE OR REPLACE FUNCTION aquaterra_arc_pay(src text, dst text, amt bigint, k text, plot int, note text, who text, r text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE lid bigint;
BEGIN
  IF amt IS NULL OR amt <= 0 THEN RETURN; END IF;
  INSERT INTO aquaterra_wallets (account, welcomed_at) VALUES (dst, now()) ON CONFLICT DO NOTHING;
  lid := aquaterra_move(src, dst, amt, k, plot, left(note, 120), who);
  UPDATE aquaterra_ledger SET ref = left(r, 120) WHERE id = lid;
END $fn$;

-- Pay and send the tax share of it to the State Treasury. Returns the tax.
CREATE OR REPLACE FUNCTION aquaterra_arc_pay_taxed(src text, dst text, amt bigint, tax_key text, k text, plot int, note text, who text, r text) RETURNS bigint
LANGUAGE plpgsql AS $fn$
DECLARE tax bigint;
BEGIN
  IF amt IS NULL OR amt <= 0 THEN RETURN 0; END IF;
  tax := round(amt * greatest(0, least(aquaterra_arc_param(tax_key, 5), 50)) / 100.0);
  IF amt - tax > 0 THEN PERFORM aquaterra_arc_pay(src, dst, amt - tax, k, plot, note, who, r); END IF;
  IF tax > 0 THEN PERFORM aquaterra_arc_pay(src, 'state:treasury', tax, 'tax', plot, note || ' tax', who, 'tax:' || r); END IF;
  RETURN tax;
END $fn$;

-- Who may run an attraction on a plot now: the tenant during a rental, else the owner.
CREATE OR REPLACE FUNCTION aquaterra_arc_operator(plot int) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(
    (SELECT tenant FROM aquaterra_arcade_rentals WHERE plot_id = plot AND ends_at > now() ORDER BY ends_at DESC LIMIT 1),
    (SELECT owner FROM aquaterra_plot_owners WHERE plot_id = plot))
$fn$;

-- Is the citizen standing on the plot? Uses the travel system's
-- aquaterra_player_where(email) when it is live; before that everybody is welcome.
CREATE OR REPLACE FUNCTION aquaterra_arc_here(e text, plot int) RETURNS boolean
LANGUAGE plpgsql AS $fn$
DECLARE j jsonb;
BEGIN
  IF to_regprocedure('aquaterra_player_where(text)') IS NULL THEN RETURN true; END IF;
  EXECUTE format('SELECT aquaterra_player_where(%L)', e) INTO j;
  RETURN (j->>'plotId') IS NOT NULL AND (j->>'plotId')::int = plot;
EXCEPTION WHEN undefined_function OR undefined_table THEN RETURN true;
END $fn$;

-- Difficulty settings of each game.
CREATE OR REPLACE FUNCTION aquaterra_arc_rules(tpl text, diff text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE tpl
    WHEN 'quiz' THEN CASE diff
      WHEN 'easy' THEN '{"questions":5,"secondsEach":20,"win":3}'
      WHEN 'hard' THEN '{"questions":10,"secondsEach":15,"win":8}'
      ELSE '{"questions":7,"secondsEach":18,"win":5}' END
    WHEN 'crystals' THEN CASE diff
      WHEN 'easy' THEN '{"size":6,"crystals":5,"picks":14,"win":3,"seconds":120}'
      WHEN 'hard' THEN '{"size":8,"crystals":5,"picks":12,"win":5,"seconds":120}'
      ELSE '{"size":7,"crystals":5,"picks":13,"win":4,"seconds":120}' END
    WHEN 'maze' THEN CASE diff
      WHEN 'easy' THEN '{"size":7,"seconds":60}'
      WHEN 'hard' THEN '{"size":11,"seconds":90}'
      ELSE '{"size":9,"seconds":75}' END
    WHEN 'range' THEN CASE diff
      WHEN 'easy' THEN '{"targets":20,"window":1500,"gap":750,"win":12}'
      WHEN 'hard' THEN '{"targets":24,"window":850,"gap":520,"win":18}'
      ELSE '{"targets":20,"window":1150,"gap":620,"win":14}' END
    WHEN 'race' THEN CASE diff
      WHEN 'easy' THEN '{"rows":60,"tick":170}'
      WHEN 'hard' THEN '{"rows":100,"tick":115}'
      ELSE '{"rows":80,"tick":140}' END
  END::jsonb
$fn$;

-- ---------------------------------------------------------------- games --
-- Each builder returns {public, secret, max, seconds}. public goes to the player.

CREATE OR REPLACE FUNCTION aquaterra_arc_build_quiz(a aquaterra_arcade, seed text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE r jsonb := aquaterra_arc_rules('quiz', a.difficulty); n int; v_topic text := COALESCE(a.config->>'topic', 'mixed');
  qs jsonb := '[]'::jsonb; answers jsonb := '[]'::jsonb; rec record; opts text[]; k int; i int := 0;
BEGIN
  n := (r->>'questions')::int;
  FOR rec IN
    SELECT q, answer, wrong FROM (
      SELECT e->>'q' AS q, e->>'answer' AS answer, ARRAY(SELECT jsonb_array_elements_text(e->'wrong')) AS wrong, 0 AS level, md5(seed || (e->>'q')) AS o
        FROM jsonb_array_elements(COALESCE(a.config->'questions', '[]'::jsonb)) e WHERE v_topic = 'custom'
      UNION ALL
      SELECT q.q, q.answer, q.wrong, q.level, md5(seed || q.id) FROM aquaterra_arcade_questions q
        WHERE v_topic <> 'custom' AND (v_topic = 'mixed' OR q.topic = v_topic)
          AND (a.difficulty <> 'easy' OR q.level <= 2) AND (a.difficulty <> 'hard' OR q.level >= 2 OR v_topic <> 'mixed')
    ) s ORDER BY o LIMIT n
  LOOP
    -- shuffle the four options; remember where the answer went
    opts := ARRAY(SELECT x FROM unnest(array_prepend(rec.answer, rec.wrong[1:3])) WITH ORDINALITY u(x, o) ORDER BY md5(seed || i || x));
    k := array_position(opts, rec.answer) - 1;
    qs := qs || jsonb_build_object('q', rec.q, 'options', to_jsonb(opts));
    answers := answers || to_jsonb(k);
    i := i + 1;
  END LOOP;
  IF i = 0 AND v_topic NOT IN ('mixed', 'custom') THEN
    a.config := jsonb_build_object('topic', 'mixed');
    RETURN aquaterra_arc_build_quiz(a, seed);
  END IF;
  IF i = 0 THEN RAISE EXCEPTION 'questions'; END IF;
  RETURN jsonb_build_object('public', jsonb_build_object('questions', qs, 'secondsEach', r->'secondsEach', 'win', least((r->>'win')::int, i)),
    'secret', jsonb_build_object('answers', answers), 'max', i, 'seconds', i * (r->>'secondsEach')::int);
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_arc_build_crystals(a aquaterra_arcade, seed text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE r jsonb := aquaterra_arc_rules('crystals', a.difficulty); s int; c int; cells jsonb;
BEGIN
  s := (r->>'size')::int; c := (r->>'crystals')::int;
  SELECT jsonb_agg(cell ORDER BY cell) INTO cells FROM (SELECT g AS cell FROM generate_series(0, s * s - 1) g ORDER BY md5(seed || g) LIMIT c) x;
  RETURN jsonb_build_object('public', r, 'secret', jsonb_build_object('cells', cells), 'max', c, 'seconds', (r->>'seconds')::int);
END $fn$;

-- Maze: a perfect maze by depth-first search. cells[i] has bit 1 open north,
-- 2 east, 4 south, 8 west. Start top-left, exit bottom-right.
CREATE OR REPLACE FUNCTION aquaterra_arc_build_maze(a aquaterra_arcade, seed text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE r jsonb := aquaterra_arc_rules('maze', a.difficulty); n int; cells int[]; seen boolean[]; stack int[]; cur int; nb int[]; nx int; dir int; k int := 0; x int; y int;
BEGIN
  n := (r->>'size')::int;
  cells := array_fill(0, ARRAY[n * n]); seen := array_fill(false, ARRAY[n * n]);
  stack := ARRAY[0]; seen[1] := true;
  WHILE array_length(stack, 1) > 0 LOOP
    cur := stack[array_length(stack, 1)]; x := cur % n; y := cur / n; nb := '{}';
    IF y > 0 AND NOT seen[cur - n + 1] THEN nb := nb || 1; END IF;
    IF x < n - 1 AND NOT seen[cur + 2] THEN nb := nb || 2; END IF;
    IF y < n - 1 AND NOT seen[cur + n + 1] THEN nb := nb || 4; END IF;
    IF x > 0 AND NOT seen[cur] THEN nb := nb || 8; END IF;
    IF array_length(nb, 1) IS NULL THEN
      stack := stack[1:array_length(stack, 1) - 1];
    ELSE
      k := k + 1;
      dir := nb[1 + floor(aquaterra_arc_rnd(seed, k) * array_length(nb, 1))::int];
      nx := CASE dir WHEN 1 THEN cur - n WHEN 2 THEN cur + 1 WHEN 4 THEN cur + n ELSE cur - 1 END;
      cells[cur + 1] := cells[cur + 1] | dir;
      cells[nx + 1] := cells[nx + 1] | CASE dir WHEN 1 THEN 4 WHEN 2 THEN 8 WHEN 4 THEN 1 ELSE 2 END;
      seen[nx + 1] := true;
      stack := stack || nx;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('public', r || jsonb_build_object('cells', to_jsonb(cells)), 'secret', '{}'::jsonb,
    'max', (r->>'seconds')::int, 'seconds', (r->>'seconds')::int);
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_arc_build_range(a aquaterra_arcade, seed text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE r jsonb := aquaterra_arc_rules('range', a.difficulty); n int; gap int; w int; t jsonb := '[]'::jsonb; at int := 1200; i int;
BEGIN
  n := (r->>'targets')::int; gap := (r->>'gap')::int; w := (r->>'window')::int;
  FOR i IN 0..n - 1 LOOP
    t := t || jsonb_build_object('id', i, 't', at,
      'x', round((0.08 + aquaterra_arc_rnd(seed, i * 3) * 0.84)::numeric, 3), 'y', round((0.1 + aquaterra_arc_rnd(seed, i * 3 + 1) * 0.8)::numeric, 3));
    at := at + gap + floor(aquaterra_arc_rnd(seed, i * 3 + 2) * gap * 0.6)::int;
  END LOOP;
  RETURN jsonb_build_object('public', r || jsonb_build_object('schedule', t, 'duration', at + w), 'secret', '{}'::jsonb,
    'max', n, 'seconds', ceil((at + w) / 1000.0)::int);
END $fn$;

-- Race: three lanes, rocks on the water. A safe lane wanders at most one lane
-- every two rows and never has a rock, so every course can be finished.
CREATE OR REPLACE FUNCTION aquaterra_arc_build_race(a aquaterra_arcade, seed text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE r jsonb := aquaterra_arc_rules('race', a.difficulty); rows_n int; tick int; safe int := 1; prev int := 1; obs jsonb := '[]'::jsonb; row_i int; lanes int[]; l int; p double precision;
BEGIN
  rows_n := (r->>'rows')::int; tick := (r->>'tick')::int;
  p := CASE a.difficulty WHEN 'easy' THEN 0.35 WHEN 'hard' THEN 0.6 ELSE 0.48 END;
  FOR row_i IN 0..rows_n - 1 LOOP
    prev := safe;
    IF row_i % 2 = 0 AND row_i > 6 THEN
      safe := greatest(0, least(2, safe + floor(aquaterra_arc_rnd(seed, row_i * 7) * 3)::int - 1));
    END IF;
    lanes := '{}';
    IF row_i >= 6 AND aquaterra_arc_rnd(seed, row_i * 7 + 1) < p THEN
      FOR l IN 0..2 LOOP
        IF l <> safe AND l <> prev AND aquaterra_arc_rnd(seed, row_i * 7 + 2 + l) < 0.75 THEN lanes := lanes || l; END IF;
      END LOOP;
    END IF;
    IF array_length(lanes, 1) > 0 THEN obs := obs || jsonb_build_array(jsonb_build_array(row_i, to_jsonb(lanes))); END IF;
  END LOOP;
  RETURN jsonb_build_object('public', r || jsonb_build_object('rocks', obs), 'secret', '{}'::jsonb,
    'max', rows_n, 'seconds', ceil(rows_n * tick / 1000.0)::int);
END $fn$;

-- Score a finished run. Returns {score, won, review}.
CREATE OR REPLACE FUNCTION aquaterra_arc_score(run aquaterra_arcade_runs, tpl text, body jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE pub jsonb := run.public; sec jsonb := run.secret; elapsed double precision := extract(epoch FROM now() - run.started_at);
  late boolean := now() > run.deadline; score int := 0; i int; n int; x int; y int; c int; mv text; step text; rocks jsonb; lane int; row_i int; sw jsonb; nxt int;
  hits jsonb; ok_ids int[] := '{}'; h jsonb; tg jsonb; maxms int := 0; ms int;
BEGIN
  IF tpl = 'quiz' THEN
    n := jsonb_array_length(sec->'answers');
    FOR i IN 0..n - 1 LOOP
      IF (body->'answers'->>i) IS NOT NULL AND (body->'answers'->>i) ~ '^[0-3]\Z' AND (body->'answers'->>i)::int = (sec->'answers'->>i)::int THEN score := score + 1; END IF;
    END LOOP;
    IF late THEN score := 0; END IF;
    RETURN jsonb_build_object('score', score, 'won', score >= (pub->>'win')::int, 'review', sec->'answers');

  ELSIF tpl = 'crystals' THEN
    score := (SELECT count(*) FROM jsonb_array_elements(run.moves) m WHERE (m->>'hit')::boolean);
    IF late THEN score := 0; END IF;
    RETURN jsonb_build_object('score', score, 'won', score >= (pub->>'win')::int, 'review', sec->'cells');

  ELSIF tpl = 'maze' THEN
    n := (pub->>'size')::int; x := 0; y := 0; mv := upper(COALESCE(body->>'path', ''));
    IF length(mv) > n * n * 4 THEN RETURN jsonb_build_object('score', 0, 'won', false); END IF;
    FOR i IN 1..length(mv) LOOP
      step := substr(mv, i, 1); c := (pub->'cells'->>(y * n + x))::int;
      IF step = 'U' AND c & 1 > 0 THEN y := y - 1;
      ELSIF step = 'R' AND c & 2 > 0 THEN x := x + 1;
      ELSIF step = 'D' AND c & 4 > 0 THEN y := y + 1;
      ELSIF step = 'L' AND c & 8 > 0 THEN x := x - 1;
      ELSE RETURN jsonb_build_object('score', 0, 'won', false, 'reason', 'wall'); END IF;
      EXIT WHEN x = n - 1 AND y = n - 1;
    END LOOP;
    IF x = n - 1 AND y = n - 1 AND NOT late AND elapsed >= length(mv) * 0.05 THEN
      score := greatest(1, (pub->>'seconds')::int - floor(elapsed)::int);
      RETURN jsonb_build_object('score', score, 'won', true, 'seconds', round(elapsed::numeric, 1));
    END IF;
    RETURN jsonb_build_object('score', 0, 'won', false);

  ELSIF tpl = 'range' THEN
    hits := COALESCE(body->'hits', '[]'::jsonb);
    IF jsonb_typeof(hits) <> 'array' OR jsonb_array_length(hits) > 200 THEN RETURN jsonb_build_object('score', 0, 'won', false); END IF;
    FOR h IN SELECT * FROM jsonb_array_elements(hits) LOOP
      CONTINUE WHEN jsonb_typeof(h) <> 'array' OR (h->>0) !~ '^\d{1,3}\Z' OR (h->>1) !~ '^\d{1,7}\Z';
      i := (h->>0)::int; ms := (h->>1)::int; tg := pub->'schedule'->i;
      CONTINUE WHEN tg IS NULL OR i = ANY(ok_ids);
      IF ms >= (tg->>'t')::int AND ms <= (tg->>'t')::int + (pub->>'window')::int THEN
        ok_ids := ok_ids || i; maxms := greatest(maxms, ms);
      END IF;
    END LOOP;
    -- a hit cannot be later than the time that really passed on the server
    IF maxms / 1000.0 > elapsed + 1.5 OR late THEN RETURN jsonb_build_object('score', 0, 'won', false, 'reason', 'time'); END IF;
    score := coalesce(array_length(ok_ids, 1), 0);
    RETURN jsonb_build_object('score', score, 'won', score >= (pub->>'win')::int);

  ELSIF tpl = 'race' THEN
    n := (pub->>'rows')::int; rocks := pub->'rocks'; lane := 1; sw := COALESCE(body->'switches', '[]'::jsonb); i := 0;
    IF jsonb_typeof(sw) <> 'array' OR jsonb_array_length(sw) > n THEN RETURN jsonb_build_object('score', 0, 'won', false); END IF;
    FOR row_i IN 0..n - 1 LOOP
      -- lane changes that happen on this row (one lane at a time)
      WHILE i < jsonb_array_length(sw) AND (sw->i->>0) ~ '^\d{1,4}\Z' AND (sw->i->>0)::int <= row_i LOOP
        nxt := CASE WHEN (sw->i->>1) ~ '^[0-2]\Z' THEN (sw->i->>1)::int ELSE lane END;
        IF abs(nxt - lane) = 1 AND (sw->i->>0)::int = row_i THEN lane := nxt; END IF;
        i := i + 1;
      END LOOP;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(rocks) k WHERE (k->>0)::int = row_i AND (k->1) @> to_jsonb(lane)) THEN
        RETURN jsonb_build_object('score', row_i, 'won', false, 'crash', row_i);
      END IF;
    END LOOP;
    IF elapsed < n * (pub->>'tick')::int / 1000.0 * 0.85 - 1 THEN RETURN jsonb_build_object('score', 0, 'won', false, 'reason', 'time'); END IF;
    RETURN jsonb_build_object('score', n, 'won', true);
  END IF;
  RETURN jsonb_build_object('score', 0, 'won', false);
END $fn$;

-- ---------------------------------------------------------- housekeeping --

-- Close an attraction and give what is left of its pool back.
CREATE OR REPLACE FUNCTION aquaterra_arc_close(aid int, why text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE a aquaterra_arcade;
BEGIN
  SELECT * INTO a FROM aquaterra_arcade WHERE id = aid AND status = 'open' FOR UPDATE;
  IF a.id IS NULL THEN RETURN; END IF;
  IF a.pool > 0 THEN
    PERFORM aquaterra_arc_pay('arcade:escrow', CASE WHEN a.operator = 'nics-ai' THEN 'treasury' ELSE a.operator END,
      a.pool, 'arcade_refund', a.plot_id, 'Prize pool back: ' || a.title, NULL, 'arcade:' || a.id || ':' || why);
  END IF;
  UPDATE aquaterra_arcade SET status = 'closed', closed_at = now(), pool = 0 WHERE id = aid;
END $fn$;

-- Cheap tidy-up on each request: tenants whose rent ended lose their attraction.
CREATE OR REPLACE FUNCTION aquaterra_arc_tidy() RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE aid int;
BEGIN
  FOR aid IN
    SELECT a.id FROM aquaterra_arcade a WHERE a.status = 'open' AND a.operator <> 'nics-ai'
      AND a.operator IS DISTINCT FROM aquaterra_arc_operator(a.plot_id)
  LOOP
    PERFORM aquaterra_arc_close(aid, 'rent_end');
  END LOOP;
END $fn$;

-- Quiz facts NICS AI writes from the live world: lands, climates, laws.
CREATE OR REPLACE FUNCTION aquaterra_arc_world_questions() RETURNS int
LANGUAGE plpgsql AS $fn$
DECLARE d record; n int := 0; wrong text[];
BEGIN
  DELETE FROM aquaterra_arcade_questions WHERE source = 'ai';
  FOR d IN SELECT id, name, land, biome FROM aquaterra_districts WHERE merged_into IS NULL LOOP
    wrong := ARRAY(SELECT DISTINCT land FROM aquaterra_districts WHERE land <> d.land ORDER BY land);
    IF array_length(wrong, 1) >= 3 THEN
      wrong := ARRAY(SELECT x FROM unnest(wrong) x ORDER BY md5(d.name || x) LIMIT 3);
      INSERT INTO aquaterra_arcade_questions (topic, q, answer, wrong, level, source)
      VALUES ('world', 'Which land is ' || d.name || ' on?', d.land, wrong, 2, 'ai') ON CONFLICT DO NOTHING;
      n := n + 1;
    END IF;
    wrong := ARRAY(SELECT x FROM (SELECT DISTINCT aquaterra_arc_biome(biome) x FROM aquaterra_districts WHERE biome <> d.biome) s ORDER BY md5(d.name || x) LIMIT 3);
    IF array_length(wrong, 1) = 3 THEN
      INSERT INTO aquaterra_arcade_questions (topic, q, answer, wrong, level, source)
      VALUES ('world', 'What is the climate of ' || d.name || '?', aquaterra_arc_biome(d.biome), wrong, 1, 'ai') ON CONFLICT DO NOTHING;
      n := n + 1;
    END IF;
  END LOOP;
  INSERT INTO aquaterra_arcade_questions (topic, q, answer, wrong, level, source)
  SELECT 'world', 'How many districts does the Commonwealth have today?', c::text,
    ARRAY[(c - 6)::text, (c + 4)::text, (c + 11)::text], 2, 'ai'
  FROM (SELECT count(*) c FROM aquaterra_districts WHERE merged_into IS NULL) s WHERE c > 6
  ON CONFLICT DO NOTHING;
  INSERT INTO aquaterra_arcade_questions (topic, q, answer, wrong, level, source)
  SELECT 'world', 'What is the tax on plot sales in AquaTerra now?', trim_scale(v)::text || '%',
    ARRAY[trim_scale(v + 2)::text || '%', trim_scale(v + 7)::text || '%', trim_scale(v * 4 + 1)::text || '%'], 3, 'ai'
  FROM (SELECT aquaterra_arc_param('sales_tax_pct', 3) v) s
  ON CONFLICT DO NOTHING;
  RETURN n;
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_arc_biome(b text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE b WHEN 'metropolis' THEN 'Metropolis' WHEN 'temperate' THEN 'Temperate' WHEN 'tundra' THEN 'Frozen north'
    WHEN 'desert' THEN 'Desert' WHEN 'jungle' THEN 'Tropical jungle' WHEN 'savanna' THEN 'Savanna' WHEN 'wetland' THEN 'Wetlands'
    WHEN 'volcanic' THEN 'Volcanic' WHEN 'autumn' THEN 'Autumn forest' WHEN 'blossom' THEN 'Blossom gardens'
    WHEN 'oceania' THEN 'Oceania islands' WHEN 'isles' THEN 'Northern isles' WHEN 'woodland' THEN 'Great forest'
    WHEN 'dunes' THEN 'Great desert' WHEN 'industrial' THEN 'Industrial' WHEN 'airport' THEN 'Airport district'
    WHEN 'deco' THEN 'Roaring Twenties' ELSE initcap(b) END
$fn$;

-- NICS AI's day in the arcade. Once a day (on the first request after
-- midnight UTC) it closes yesterday's pop-ups, looks at what people played
-- this week, and opens new ones on free plots in different districts:
-- more of the games people play, each game made harder when most players
-- win it and easier when most lose. Its reasons go to the book of experience.
CREATE OR REPLACE FUNCTION aquaterra_arc_ai_day() RETURNS int
LANGUAGE plpgsql AS $fn$
DECLARE today date := current_date; n int; budget bigint; per bigint; aid int; k int := 0; tpl text; diff text; prev text;
  st record; weights jsonb := '{}'::jsonb; total numeric := 0; pick double precision; acc numeric; notes text[] := '{}'; plot record; t text; title text;
  stats jsonb := '{}'::jsonb; topics text[] := ARRAY['mixed', 'elements', 'science', 'commonwealth', 'world']; v_topic text;
BEGIN
  IF EXISTS (SELECT 1 FROM aquaterra_arcade WHERE operator = 'nics-ai' AND ai_day = today) THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('aquaterra_arcade_ai_day'));
  IF EXISTS (SELECT 1 FROM aquaterra_arcade WHERE operator = 'nics-ai' AND ai_day = today) THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM aquaterra_arcade_ai_log WHERE day = today) THEN RETURN 0; END IF;

  FOR aid IN SELECT id FROM aquaterra_arcade WHERE operator = 'nics-ai' AND status = 'open' LOOP
    PERFORM aquaterra_arc_close(aid, 'day_end');
  END LOOP;
  PERFORM aquaterra_arc_world_questions();

  n := aquaterra_arc_param('arcade_ai_attractions', 6)::int;
  budget := aquaterra_arc_param('arcade_ai_daily_budget', 2000)::bigint;
  IF n <= 0 THEN
    INSERT INTO aquaterra_arcade_ai_log (day, text) VALUES (today, 'No pop-up attractions today: the Commonwealth set their number to zero.');
    RETURN 0;
  END IF;
  budget := least(budget, COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = 'treasury'), 0) / 100);
  per := budget / n;

  -- what people played in the last 7 days
  FOR st IN
    SELECT tp, count(r.id) AS plays, count(r.id) FILTER (WHERE r.won) AS wins,
      count(r.id) FILTER (WHERE a.operator = 'nics-ai') AS ai_plays, count(r.id) FILTER (WHERE r.won AND a.operator = 'nics-ai') AS ai_wins
    FROM unnest(ARRAY['quiz', 'crystals', 'maze', 'range', 'race']) tp
    LEFT JOIN aquaterra_arcade a ON a.template = tp
    LEFT JOIN aquaterra_arcade_runs r ON r.arcade_id = a.id AND r.status = 'done' AND NOT r.practice AND r.started_at > now() - interval '7 days'
    GROUP BY tp
  LOOP
    stats := stats || jsonb_build_object(st.tp, jsonb_build_object('plays', st.plays, 'wins', st.wins, 'aiPlays', st.ai_plays, 'aiWins', st.ai_wins));
    total := total + st.plays;
  END LOOP;
  FOR t IN SELECT jsonb_object_keys(stats) LOOP
    weights := weights || jsonb_build_object(t, 1 + 6 * CASE WHEN total > 0 THEN (stats->t->>'plays')::numeric / total ELSE 0 END);
  END LOOP;
  IF total > 0 THEN
    SELECT 'Most played this week: ' || string_agg(initcap(key) || ' ' || round(100 * (value->>'plays')::numeric / total) || '%', ', ' ORDER BY (value->>'plays')::int DESC)
      INTO t FROM jsonb_each(stats) WHERE (value->>'plays')::int > 0;
    notes := notes || t;
  ELSE
    notes := notes || 'Nobody has played yet, so every game gets an equal chance'::text;
  END IF;

  FOR plot IN
    SELECT * FROM (
      SELECT DISTINCT ON (p.district) p.id, p.district, p.address
      FROM aquaterra_plots p
      WHERE p.address NOT LIKE 'Water Plot%'
        AND NOT EXISTS (SELECT 1 FROM aquaterra_plot_owners o WHERE o.plot_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM aquaterra_arcade a WHERE a.plot_id = p.id AND a.status = 'open')
      ORDER BY p.district, md5(today::text || p.id)
    ) s ORDER BY md5(today::text || s.district)  -- districts in a new order every day
  LOOP
    EXIT WHEN k >= n;
    k := k + 1;
    IF k = 1 THEN tpl := 'quiz';  -- a lesson every day
    ELSE
      pick := aquaterra_arc_rnd(today::text || 'tpl', k) * (SELECT sum(value::numeric) FROM jsonb_each_text(weights));
      acc := 0; tpl := 'quiz';
      FOR t IN SELECT key FROM jsonb_each_text(weights) ORDER BY key LOOP
        acc := acc + (weights->>t)::numeric;
        IF pick < acc THEN tpl := t; EXIT; END IF;
      END LOOP;
    END IF;
    SELECT difficulty INTO prev FROM aquaterra_arcade WHERE operator = 'nics-ai' AND template = tpl ORDER BY id DESC LIMIT 1;
    diff := COALESCE(prev, 'normal');
    IF (stats->tpl->>'aiPlays')::int >= 5 THEN
      IF (stats->tpl->>'aiWins')::numeric / (stats->tpl->>'aiPlays')::numeric > 0.65 THEN
        diff := CASE diff WHEN 'easy' THEN 'normal' ELSE 'hard' END;
        IF diff <> COALESCE(prev, 'normal') THEN notes := notes || (initcap(tpl) || ': most players won, made it ' || diff); END IF;
      ELSIF (stats->tpl->>'aiWins')::numeric / (stats->tpl->>'aiPlays')::numeric < 0.3 THEN
        diff := CASE diff WHEN 'hard' THEN 'normal' ELSE 'easy' END;
        IF diff <> COALESCE(prev, 'normal') THEN notes := notes || (initcap(tpl) || ': most players lost, made it ' || diff); END IF;
      END IF;
    END IF;
    v_topic := topics[1 + floor(aquaterra_arc_rnd(today::text || 'topic', k) * 5)::int];
    title := CASE tpl WHEN 'quiz' THEN CASE v_topic WHEN 'elements' THEN 'Elements Quiz' WHEN 'science' THEN 'Science Quiz'
        WHEN 'commonwealth' THEN 'Commonwealth Quiz' WHEN 'world' THEN 'World Quiz' ELSE 'City Mind Quiz' END
      WHEN 'crystals' THEN 'Crystal Hunt' WHEN 'maze' THEN 'Tide Maze' WHEN 'range' THEN 'Light Range' ELSE 'Wave Race' END;
    INSERT INTO aquaterra_arcade (plot_id, operator, template, title, difficulty, entry_fee, prize, pool, config, ai_day)
    VALUES (plot.id, 'nics-ai', tpl, title, diff, 0, greatest(5, per / 15), 0,
      CASE WHEN tpl = 'quiz' THEN jsonb_build_object('topic', v_topic) ELSE '{}'::jsonb END, today)
    RETURNING id INTO aid;
    IF per > 0 THEN
      PERFORM aquaterra_arc_pay('treasury', 'arcade:escrow', per, 'arcade_pool', plot.id, 'NICS AI prizes: ' || title, NULL, 'arcade:' || aid || ':pool');
      UPDATE aquaterra_arcade SET pool = per WHERE id = aid;
    END IF;
    notes := notes || (title || ' (' || diff || ') at ' || plot.address || CASE WHEN position(plot.district IN plot.address) > 0 THEN '' ELSE ', ' || plot.district END);
  END LOOP;

  INSERT INTO aquaterra_arcade_ai_log (day, text) VALUES (today,
    'Opened ' || k || ' attractions with ' || (per * k) || ' TIDE of prizes from the Reserve. ' || array_to_string(notes, '. ') || '.');
  RETURN k;
END $fn$;

-- Daily quests: three of six, the same for everyone each day.
CREATE OR REPLACE FUNCTION aquaterra_arc_quests(e text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE today date := current_date; res jsonb := '[]'::jsonb; q record; s record;
BEGIN
  SELECT count(*) AS plays, count(DISTINCT r.district) AS districts, count(DISTINCT r.land) AS lands,
    count(*) FILTER (WHERE r.won) AS wins, count(*) FILTER (WHERE a.operator = 'nics-ai') AS ai,
    count(*) FILTER (WHERE a.template = 'quiz' AND r.score = r.max_score) AS perfect
  INTO s FROM aquaterra_arcade_runs r JOIN aquaterra_arcade a ON a.id = r.arcade_id
  WHERE r.player = e AND r.status = 'done' AND NOT r.practice AND r.started_at >= today;
  FOR q IN
    SELECT * FROM (VALUES ('play4', 4, 20), ('explore3', 3, 40), ('lands2', 2, 30), ('win2', 2, 30), ('ai1', 1, 15), ('perfect', 1, 25)) v(id, need, reward)
    ORDER BY md5(today::text || v.id) LIMIT 3
  LOOP
    res := res || jsonb_build_object('id', q.id, 'need', q.need, 'reward', q.reward,
      'progress', least(q.need, CASE q.id WHEN 'play4' THEN s.plays WHEN 'explore3' THEN s.districts WHEN 'lands2' THEN s.lands
        WHEN 'win2' THEN s.wins WHEN 'ai1' THEN s.ai ELSE s.perfect END),
      'claimed', EXISTS (SELECT 1 FROM aquaterra_arcade_quests_done d WHERE d.player = e AND d.day = today AND d.quest = q.id));
  END LOOP;
  RETURN res;
END $fn$;

-- Weekly ranking: 1 point a play, 2 a win, 3 for each district played in.
CREATE OR REPLACE FUNCTION aquaterra_arc_ranking(e text) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  WITH w AS (
    SELECT r.player, count(*) AS plays, count(*) FILTER (WHERE r.won) AS wins, count(DISTINCT r.district) AS districts
    FROM aquaterra_arcade_runs r
    WHERE r.status = 'done' AND NOT r.practice AND r.started_at >= date_trunc('week', now())
    GROUP BY r.player
  ), ranked AS (
    SELECT *, plays + 2 * wins + 3 * districts AS points, rank() OVER (ORDER BY plays + 2 * wins + 3 * districts DESC) AS place FROM w
  )
  SELECT jsonb_build_object(
    'since', date_trunc('week', now()),
    'top', COALESCE((SELECT jsonb_agg(jsonb_build_object('place', place, 'name', aquaterra_arc_name(player), 'points', points,
        'plays', plays, 'wins', wins, 'districts', districts, 'me', player = e) ORDER BY place, player)
      FROM (SELECT * FROM ranked ORDER BY place LIMIT 20) t), '[]'::jsonb),
    'me', (SELECT jsonb_build_object('place', place, 'points', points) FROM ranked WHERE player = e))
$fn$;
