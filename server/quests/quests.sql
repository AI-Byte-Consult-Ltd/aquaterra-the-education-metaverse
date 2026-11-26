-- AquaTerra: daily quests from NICS AI.
-- One-off migration (never per request). Safe to run again.
-- Needs: economy, governance, travel, arcade, treasury (income tax trigger on kind 'quest').
-- n8n quirks: no double-dollar quotes (use $fn$), no positional parameters in
-- the text, no dollar sign right before a quote.
--
-- Every UTC day, on the first request, NICS AI writes the day's quests from
-- live data of the world (no language model: templates + numbers):
--   visit  - travel to the district that had the fewest visitors this week
--   play   - play one of today's NICS AI pop-up attractions
--   civic  - sign a petition or vote (when something is open), else ride by
--            the travel mode people used least this week
--   ask    - a question about the Commonwealth, one try, answer on /state
-- Rewards come from the NICS AI fund (wallet 'nics-ai', fed by its daily share
-- of the payroll). Payment kind 'quest': the treasury trigger takes income tax
-- (income_tax_pct, 10%) and loan repayments. When the fund or the day's pot is
-- spent, quests can still be done, but pay nothing until tomorrow: said honestly.

CREATE TABLE IF NOT EXISTS aquaterra_quest_days (
  day date PRIMARY KEY,
  quests jsonb NOT NULL,          -- public part + secret answer of 'ask'
  pot bigint NOT NULL,            -- TIDE NICS AI set aside for today
  paid bigint NOT NULL DEFAULT 0, -- paid so far today (before tax)
  note text NOT NULL,             -- why NICS AI chose these (book of experience)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aquaterra_quest_claims (
  player text NOT NULL,
  day date NOT NULL,
  quest text NOT NULL,
  reward bigint NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player, day, quest)
);

CREATE TABLE IF NOT EXISTS aquaterra_quest_answers (
  player text NOT NULL,
  day date NOT NULL,
  choice int NOT NULL,
  correct boolean NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player, day)
);

INSERT INTO aquaterra_gov_params (key, value, min_value, max_value, label) VALUES
  ('quest_daily_pot', 300, 0, 100000, 'Most TIDE NICS AI spends from its fund on daily quests a day'),
  ('quest_reward_max', 40, 1, 10000, 'Largest reward of one daily quest of NICS AI, TIDE')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION aquaterra_q_param(k text, dflt numeric) RETURNS numeric
LANGUAGE sql STABLE AS $fn$ SELECT COALESCE((SELECT value FROM aquaterra_gov_params WHERE key = k), dflt) $fn$;

-- A range answer around a number: four buckets, the right one at a place set by the seed.
CREATE OR REPLACE FUNCTION aquaterra_q_ranges(v bigint, step bigint, seed text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE pos int := floor(aquaterra_arc_rnd(seed, 1) * 4)::int; lo bigint; opts jsonb := '[]'::jsonb; i int; a bigint;
BEGIN
  lo := (v / step) * step - pos * step;
  WHILE lo < 0 LOOP lo := lo + step; pos := pos - 1; END LOOP;
  FOR i IN 0..3 LOOP
    a := lo + i * step;
    opts := opts || to_jsonb(to_char(a, 'FM999,999,999,990') || ' – ' || to_char(a + step - 1, 'FM999,999,999,990'));
  END LOOP;
  RETURN jsonb_build_object('options', opts, 'answer', (v - lo) / step);
END $fn$;

-- Four whole numbers around v, the right one at a place set by the seed.
CREATE OR REPLACE FUNCTION aquaterra_q_exact(v int, seed text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE pos int := floor(aquaterra_arc_rnd(seed, 2) * 4)::int; lo int;
BEGIN
  lo := greatest(0, v - pos);
  RETURN jsonb_build_object('options', jsonb_build_array((lo)::text, (lo + 1)::text, (lo + 2)::text, (lo + 3)::text), 'answer', v - lo);
END $fn$;

-- NICS AI writes today's quests. Lazy, once a day, under a lock.
CREATE OR REPLACE FUNCTION aquaterra_quest_day() RETURNS aquaterra_quest_days
LANGUAGE plpgsql AS $fn$
DECLARE today date := current_date; d aquaterra_quest_days; seed text := current_date::text; qs jsonb := '[]'::jsonb; notes text[] := '{}';
  w jsonb; wsum numeric := 0; pot bigint; fund bigint; expect int; rmax bigint; k text; r record; v_open int; v_q jsonb; n int; kinds text[];
  rates jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO d FROM aquaterra_quest_days WHERE day = today;
  IF d.day IS NOT NULL THEN RETURN d; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('aquaterra_quest_day'));
  SELECT * INTO d FROM aquaterra_quest_days WHERE day = today;
  IF d.day IS NOT NULL THEN RETURN d; END IF;
  PERFORM aquaterra_arc_ai_day();  -- today's pop-ups first: the play quest points at one

  -- visit: the least visited district this week that a station, port or airport reaches
  SELECT dd.id, dd.name, count(t.id) AS trips INTO r
  FROM aquaterra_districts dd
  LEFT JOIN aquaterra_trips t ON t.to_district = dd.id AND t.at > now() - interval '7 days'
  WHERE dd.merged_into IS NULL AND NOT dd.capital AND EXISTS (SELECT 1 FROM aquaterra_travel_hubs h WHERE h.district_id = dd.id)
  GROUP BY dd.id, dd.name ORDER BY count(t.id), md5(seed || dd.id) LIMIT 1;
  IF r.id IS NOT NULL THEN
    qs := qs || jsonb_build_object('id', 'visit', 'district', r.id, 'districtName', r.name);
    notes := notes || (r.name || ' had the fewest visitors this week (' || r.trips || ' trips), so I am sending people there');
  END IF;

  -- play: today's pop-up of the game played least this week
  SELECT a.id, a.title, a.plot_id, p.address, p.district INTO r
  FROM aquaterra_arcade a JOIN aquaterra_plots p ON p.id = a.plot_id
  WHERE a.operator = 'nics-ai' AND a.ai_day = today AND a.status = 'open'
  ORDER BY (SELECT count(*) FROM aquaterra_arcade_runs x JOIN aquaterra_arcade y ON y.id = x.arcade_id
            WHERE y.template = a.template AND x.status = 'done' AND NOT x.practice AND x.started_at > now() - interval '7 days'), md5(seed || a.id)
  LIMIT 1;
  IF r.id IS NOT NULL THEN
    qs := qs || jsonb_build_object('id', 'play', 'arcade', r.id, 'title', r.title, 'plotId', r.plot_id, 'address', r.address, 'districtName', r.district);
    notes := notes || (r.title || ' is the game played least this week: try it at ' || r.address);
  END IF;

  -- civic: take part when there is something open, else ride the least used mode
  SELECT count(*) INTO v_open FROM aquaterra_gov_proposals WHERE status IN ('signatures', 'voting');
  IF v_open > 0 THEN
    qs := qs || jsonb_build_object('id', 'civic', 'open', v_open);
    notes := notes || (v_open || CASE WHEN v_open = 1 THEN ' proposal waits' ELSE ' proposals wait' END || ' for signatures or votes');
  ELSE
    SELECT m, (SELECT count(*) FROM aquaterra_trips t, jsonb_array_elements(t.legs) l WHERE l->>'mode' = m AND t.at > now() - interval '7 days') AS c INTO r
    FROM unnest(ARRAY['train', 'ferry', 'plane']) m ORDER BY 2, md5(seed || m) LIMIT 1;
    qs := qs || jsonb_build_object('id', 'ride', 'mode', r.m);
    notes := notes || ('Nothing is open in the Commonwealth; the ' || r.m || ' was used least this week (' || r.c || ' legs)');
  END IF;

  -- ask: a question about the Commonwealth, answers to be found on /state
  kinds := ARRAY['citizens', 'districts', 'council', 'treasury'];
  k := kinds[1 + floor(aquaterra_arc_rnd(seed, 7) * 4)::int];
  v_q := CASE k
    WHEN 'citizens' THEN aquaterra_q_ranges((SELECT count(*) FROM aquaterra_players), CASE WHEN (SELECT count(*) FROM aquaterra_players) < 100 THEN 10 ELSE 100 END, seed)
    WHEN 'districts' THEN aquaterra_q_exact((SELECT count(*)::int FROM aquaterra_districts WHERE merged_into IS NULL), seed)
    WHEN 'council' THEN aquaterra_q_exact((SELECT count(*)::int FROM aquaterra_gov_council_voters()), seed)
    ELSE aquaterra_q_ranges(aquaterra_gov_treasury(), 50000, seed) END;
  qs := qs || (jsonb_build_object('id', 'ask', 'topic', k) || v_q);

  -- rewards: share of the pot by effort, more for quests few people finished last week
  FOR r IN
    SELECT c.quest, count(*) AS done FROM aquaterra_quest_claims c WHERE c.day >= today - 7 AND c.day < today GROUP BY c.quest
  LOOP rates := rates || jsonb_build_object(r.quest, r.done); END LOOP;
  SELECT greatest(1, count(DISTINCT player)) INTO n FROM aquaterra_quest_claims WHERE day >= today - 7 AND day < today;
  w := '{}'::jsonb;
  FOR v_q IN SELECT e FROM jsonb_array_elements(qs) e LOOP
    k := v_q->>'id';
    w := w || jsonb_build_object(k, CASE k WHEN 'visit' THEN 3 WHEN 'play' THEN 3 WHEN 'ride' THEN 3 WHEN 'civic' THEN 2 ELSE 1 END
      + CASE WHEN (SELECT count(*) FROM aquaterra_quest_days WHERE day >= today - 7) > 0 AND COALESCE((rates->>k)::numeric, 0) < n * 0.2 AND k <> 'ask' THEN 1 ELSE 0 END);
    wsum := wsum + (w->>k)::numeric;
  END LOOP;
  fund := COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = 'nics-ai'), 0);
  pot := least(aquaterra_q_param('quest_daily_pot', 300)::bigint, fund);
  rmax := aquaterra_q_param('quest_reward_max', 40)::bigint;
  -- how many people NICS AI expects: the busiest day of last week, at least 3
  SELECT greatest(3, COALESCE(max(c), 0) + 1) INTO expect FROM (SELECT count(DISTINCT player) AS c FROM aquaterra_quest_claims WHERE day >= today - 7 AND day < today GROUP BY day) x;
  SELECT jsonb_agg(e || jsonb_build_object('reward', CASE WHEN pot <= 0 THEN 0
      ELSE least(rmax, greatest(1, floor(pot * (w->>(e->>'id'))::numeric / wsum / expect)))::bigint END) ORDER BY ord)
    INTO qs FROM jsonb_array_elements(qs) WITH ORDINALITY x(e, ord);
  notes := notes || ('Pot ' || pot || ' TIDE of my fund of ' || fund || ', shared for about ' || expect || ' people');

  INSERT INTO aquaterra_quest_days (day, quests, pot, note) VALUES (today, qs, pot, array_to_string(notes, '. ') || '.')
  ON CONFLICT (day) DO NOTHING;
  SELECT * INTO d FROM aquaterra_quest_days WHERE day = today;
  RETURN d;
END $fn$;

-- Progress of one quest for one citizen today: 0 or 1 (all quests need one deed).
CREATE OR REPLACE FUNCTION aquaterra_q_done(e text, q jsonb) RETURNS boolean
LANGUAGE plpgsql AS $fn$
DECLARE today date := current_date; j jsonb;
BEGIN
  CASE q->>'id'
  WHEN 'visit' THEN
    IF EXISTS (SELECT 1 FROM aquaterra_trips WHERE email = e AND at >= today AND to_district = (q->>'district')::int) THEN RETURN true; END IF;
    j := aquaterra_player_where(e);
    RETURN j IS NOT NULL AND (j->>'districtId') IS NOT NULL AND (j->>'districtId')::int = (q->>'district')::int;
  WHEN 'play' THEN
    RETURN EXISTS (SELECT 1 FROM aquaterra_arcade_runs WHERE player = e AND arcade_id = (q->>'arcade')::int AND status = 'done' AND NOT practice AND started_at >= today);
  WHEN 'civic' THEN
    RETURN EXISTS (SELECT 1 FROM aquaterra_gov_signatures WHERE email = e AND at >= today)
        OR EXISTS (SELECT 1 FROM aquaterra_gov_votes WHERE voter = e AND at >= today);
  WHEN 'ride' THEN
    RETURN EXISTS (SELECT 1 FROM aquaterra_trips t, jsonb_array_elements(t.legs) l WHERE t.email = e AND t.at >= today AND l->>'mode' = q->>'mode');
  WHEN 'ask' THEN
    RETURN EXISTS (SELECT 1 FROM aquaterra_quest_answers WHERE player = e AND day = today AND correct);
  ELSE RETURN false;
  END CASE;
END $fn$;

-- Today's quests as a citizen sees them (never the answer of 'ask' before it is given).
CREATE OR REPLACE FUNCTION aquaterra_q_view(e text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE d aquaterra_quest_days; out jsonb := '[]'::jsonb; q jsonb; a aquaterra_quest_answers; fund bigint;
BEGIN
  d := aquaterra_quest_day();
  IF e IS NOT NULL THEN SELECT * INTO a FROM aquaterra_quest_answers WHERE player = e AND day = d.day; END IF;
  FOR q IN SELECT x FROM jsonb_array_elements(d.quests) x LOOP
    out := out || ((q - 'answer') || jsonb_build_object(
      'done', e IS NOT NULL AND aquaterra_q_done(e, q),
      'claimed', e IS NOT NULL AND EXISTS (SELECT 1 FROM aquaterra_quest_claims c WHERE c.player = e AND c.day = d.day AND c.quest = q->>'id'))
      || CASE WHEN q->>'id' = 'ask' AND a.player IS NOT NULL
           THEN jsonb_build_object('answered', a.choice, 'correct', a.correct, 'answer', (q->>'answer')::int) ELSE '{}'::jsonb END);
  END LOOP;
  fund := COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = 'nics-ai'), 0);
  RETURN jsonb_build_object('day', d.day, 'quests', out, 'pot', d.pot, 'paid', d.paid, 'potLeft', greatest(0, least(d.pot - d.paid, fund)),
    'fund', fund, 'note', d.note, 'taxPct', aquaterra_fisc('income_tax_pct'),
    'resetsAt', (d.day + 1)::timestamp AT TIME ZONE 'UTC',
    'claimedToday', (SELECT count(DISTINCT player) FROM aquaterra_quest_claims WHERE day = d.day));
END $fn$;

-- API: POST aquaterra-quests {action: today|answer|claim|journal, session, quest, choice}
CREATE OR REPLACE FUNCTION aquaterra_quests(req jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE act text := COALESCE(req->>'action', ''); me text; res jsonb := '{}'::jsonb; d aquaterra_quest_days; q jsonb;
  v_choice int; v_reward bigint; v_tax bigint; v_left bigint;
BEGIN
  IF COALESCE(req->>'session', '') <> '' THEN
    SELECT s.email INTO me FROM aquaterra_sessions s
    WHERE s.token_hash = encode(sha256(convert_to(req->>'session', 'UTF8')), 'hex') AND s.expires_at > now();
  END IF;
  IF act NOT IN ('today', 'journal') AND me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401);
  END IF;

  BEGIN
    IF act = 'today' THEN
      res := aquaterra_q_view(me);

    ELSIF act = 'journal' THEN
      PERFORM aquaterra_quest_day();
      res := jsonb_build_object('days', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', day, 'note', note, 'pot', pot, 'paid', paid,
          'people', (SELECT count(DISTINCT player) FROM aquaterra_quest_claims c WHERE c.day = x.day)) ORDER BY day DESC)
        FROM (SELECT * FROM aquaterra_quest_days ORDER BY day DESC LIMIT 14) x), '[]'::jsonb));

    ELSIF act = 'answer' THEN
      d := aquaterra_quest_day();
      SELECT e INTO q FROM jsonb_array_elements(d.quests) e WHERE e->>'id' = 'ask';
      IF q IS NULL THEN RAISE EXCEPTION 'quest'; END IF;
      v_choice := (req->>'choice')::int;
      IF v_choice IS NULL OR v_choice < 0 OR v_choice >= jsonb_array_length(q->'options') THEN RAISE EXCEPTION 'choice'; END IF;
      INSERT INTO aquaterra_quest_answers (player, day, choice, correct) VALUES (me, d.day, v_choice, v_choice = (q->>'answer')::int)
      ON CONFLICT DO NOTHING;
      IF NOT FOUND THEN RAISE EXCEPTION 'answered'; END IF;
      res := aquaterra_q_view(me) || jsonb_build_object('correct', v_choice = (q->>'answer')::int);

    ELSIF act = 'claim' THEN
      d := aquaterra_quest_day();
      SELECT e INTO q FROM jsonb_array_elements(d.quests) e WHERE e->>'id' = req->>'quest';
      IF q IS NULL THEN RAISE EXCEPTION 'quest'; END IF;
      IF EXISTS (SELECT 1 FROM aquaterra_quest_claims WHERE player = me AND day = d.day AND quest = q->>'id') THEN RAISE EXCEPTION 'claimed'; END IF;
      IF NOT aquaterra_q_done(me, q) THEN RAISE EXCEPTION 'not_ready'; END IF;
      SELECT * INTO d FROM aquaterra_quest_days WHERE day = d.day FOR UPDATE;
      INSERT INTO aquaterra_wallets (account) VALUES (me) ON CONFLICT DO NOTHING;
      v_left := least(d.pot - d.paid, COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = 'nics-ai'), 0));
      v_reward := greatest(0, least((q->>'reward')::bigint, v_left));
      INSERT INTO aquaterra_quest_claims (player, day, quest, reward) VALUES (me, d.day, q->>'id', v_reward);
      v_tax := 0;
      IF v_reward > 0 THEN
        PERFORM aquaterra_arc_pay('nics-ai', me, v_reward, 'quest', NULL, 'NICS AI quest: ' || (q->>'id'), NULL, 'nicsquest:' || d.day || ':' || (q->>'id'));
        UPDATE aquaterra_quest_days SET paid = paid + v_reward WHERE day = d.day;
        SELECT COALESCE(sum(amount), 0) INTO v_tax FROM aquaterra_ledger
          WHERE kind = 'income_tax' AND ref = 'tax:income:' || (SELECT max(id) FROM aquaterra_ledger WHERE ref = 'nicsquest:' || d.day || ':' || (q->>'id') AND to_account = me);
      END IF;
      res := aquaterra_q_view(me) || jsonb_build_object('reward', v_reward, 'tax', v_tax, 'fundEmpty', v_reward < (q->>'reward')::bigint);

    ELSE
      RAISE EXCEPTION 'action';
    END IF;
  EXCEPTION
    WHEN raise_exception THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'status', CASE SQLERRM WHEN 'claimed' THEN 409 WHEN 'answered' THEN 409 ELSE 400 END);
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('ok', false, 'error', 'choice', 'status', 400);
  END;
  RETURN jsonb_build_object('ok', true, 'status', 200) || res;
END $fn$;
