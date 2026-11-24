-- AquaTerra Arcade: the web API. n8n "[66 PUBLIC] AquaTerra Arcade" passes each
-- request body here and returns the result as it is. Public answers carry
-- citizen names only, never emails.

CREATE OR REPLACE FUNCTION aquaterra_arc_public(a aquaterra_arcade) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('id', a.id, 'plotId', a.plot_id, 'template', a.template, 'title', a.title, 'difficulty', a.difficulty,
    'entryFee', a.entry_fee, 'prize', a.prize, 'pool', a.pool, 'ai', a.operator = 'nics-ai', 'operator', aquaterra_arc_name(a.operator),
    'topic', CASE WHEN a.template = 'quiz' THEN COALESCE(a.config->>'topic', 'mixed') END,
    'plays', a.plays, 'wins', a.wins, 'createdAt', a.created_at,
    'rules', aquaterra_arc_rules(a.template, a.difficulty) || CASE WHEN a.config ? 'questions' THEN jsonb_build_object(
      'questions', least((aquaterra_arc_rules('quiz', a.difficulty)->>'questions')::int, jsonb_array_length(a.config->'questions')),
      'win', least((aquaterra_arc_rules('quiz', a.difficulty)->>'win')::int, jsonb_array_length(a.config->'questions'))) ELSE '{}'::jsonb END)
$fn$;

-- Owner-written quiz: 3 to 10 questions, each with one answer and three wrong options.
CREATE OR REPLACE FUNCTION aquaterra_arc_clean_questions(qs jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE e jsonb; res jsonb := '[]'::jsonb; w jsonb; q text; ans text; wr text[];
BEGIN
  IF qs IS NULL OR jsonb_typeof(qs) <> 'array' OR jsonb_array_length(qs) < 3 OR jsonb_array_length(qs) > 10 THEN RAISE EXCEPTION 'questions'; END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(qs) LOOP
    q := btrim(COALESCE(e->>'q', '')); ans := btrim(COALESCE(e->>'answer', ''));
    IF jsonb_typeof(e->'wrong') <> 'array' THEN RAISE EXCEPTION 'questions'; END IF;
    wr := ARRAY(SELECT btrim(x) FROM jsonb_array_elements_text(e->'wrong') x WHERE btrim(x) <> '');
    IF length(q) < 5 OR length(q) > 140 OR ans = '' OR length(ans) > 60 OR array_length(wr, 1) IS DISTINCT FROM 3
      OR EXISTS (SELECT 1 FROM unnest(wr) x WHERE length(x) > 60 OR lower(x) = lower(ans))
      OR (SELECT count(DISTINCT lower(x)) FROM unnest(wr) x) <> 3 THEN
      RAISE EXCEPTION 'questions';
    END IF;
    res := res || jsonb_build_object('q', q, 'answer', ans, 'wrong', to_jsonb(wr));
  END LOOP;
  RETURN res;
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_arcade(req jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  act text := COALESCE(req->>'action', '');
  me text; res jsonb := '{}'::jsonb;
  a aquaterra_arcade; run aquaterra_arcade_runs; v_plot aquaterra_plots;
  v_op text; v_n int; v_amt bigint; v_fee bigint; v_tax bigint; v_prize bigint; v_cap bigint; v_won_today bigint;
  v_build jsonb; v_seed text; v_score jsonb; v_title text; v_tpl text; v_diff text; v_cfg jsonb; v_days int; v_land text; v_cell int; v_hit boolean; v_dist int;
  v_district text; v_size int; v_offer aquaterra_arcade_rent_offers; v_q jsonb; v_owner text;
BEGIN
  IF COALESCE(req->>'session', '') <> '' THEN
    SELECT s.email INTO me FROM aquaterra_sessions s
    WHERE s.token_hash = encode(sha256(convert_to(req->>'session', 'UTF8')), 'hex') AND s.expires_at > now();
  END IF;
  IF act NOT IN ('map', 'plot') AND me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401);
  END IF;
  IF me IS NOT NULL THEN INSERT INTO aquaterra_wallets (account) VALUES (me) ON CONFLICT DO NOTHING; END IF;

  BEGIN
    PERFORM aquaterra_arc_tidy();
    PERFORM aquaterra_arc_ai_day();

    IF act = 'map' THEN
      res := jsonb_build_object(
        'attractions', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'plotId', plot_id, 'template', template, 'title', title,
            'ai', operator = 'nics-ai', 'entryFee', entry_fee, 'prize', CASE WHEN pool >= prize THEN prize ELSE pool END) ORDER BY id)
          FROM aquaterra_arcade WHERE status = 'open'), '[]'::jsonb),
        'forRent', COALESCE((SELECT jsonb_agg(jsonb_build_array(o.plot_id, o.price_per_day, o.max_days) ORDER BY o.plot_id)
          FROM aquaterra_arcade_rent_offers o WHERE NOT EXISTS (SELECT 1 FROM aquaterra_arcade_rentals r WHERE r.plot_id = o.plot_id AND r.ends_at > now())), '[]'::jsonb),
        'mind', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', day, 'text', text) ORDER BY id DESC)
          FROM (SELECT * FROM aquaterra_arcade_ai_log ORDER BY id DESC LIMIT 7) l), '[]'::jsonb),
        'laws', jsonb_build_object('entryTaxPct', aquaterra_arc_param('arcade_entry_tax_pct', 5), 'prizeTaxPct', aquaterra_arc_param('arcade_prize_tax_pct', 5),
          'rentTaxPct', aquaterra_arc_param('rent_tax_pct', 3), 'dailyPrizeCap', aquaterra_arc_param('arcade_daily_prize_cap', 500)));

    ELSIF act = 'plot' THEN
      SELECT * INTO v_plot FROM aquaterra_plots WHERE id = (req->>'plotId')::int;
      IF v_plot.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      SELECT * INTO a FROM aquaterra_arcade WHERE plot_id = v_plot.id AND status = 'open';
      v_op := aquaterra_arc_operator(v_plot.id);
      SELECT owner INTO v_owner FROM aquaterra_plot_owners WHERE plot_id = v_plot.id;
      SELECT * INTO v_offer FROM aquaterra_arcade_rent_offers WHERE plot_id = v_plot.id;
      res := jsonb_build_object(
        'plotId', v_plot.id,
        'attraction', CASE WHEN a.id IS NOT NULL THEN aquaterra_arc_public(a) || jsonb_build_object(
          'best', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', aquaterra_arc_name(player), 'score', score) ORDER BY score DESC, finished_at)
            FROM (SELECT DISTINCT ON (player) player, score, finished_at FROM aquaterra_arcade_runs
                  WHERE arcade_id = a.id AND status = 'done' AND NOT practice AND won AND started_at >= current_date ORDER BY player, score DESC) b), '[]'::jsonb)) END,
        'rentOffer', CASE WHEN v_offer.plot_id IS NOT NULL THEN jsonb_build_object('pricePerDay', v_offer.price_per_day, 'maxDays', v_offer.max_days) END,
        'rental', (SELECT jsonb_build_object('tenant', aquaterra_arc_name(tenant), 'endsAt', ends_at, 'mine', tenant = me)
                   FROM aquaterra_arcade_rentals WHERE plot_id = v_plot.id AND ends_at > now() ORDER BY ends_at DESC LIMIT 1),
        'me', CASE WHEN me IS NULL THEN NULL ELSE jsonb_build_object(
          'role', CASE WHEN v_op = me THEN CASE WHEN v_owner = me THEN 'owner' ELSE 'tenant' END WHEN v_owner = me THEN 'landlord' END,
          'here', aquaterra_arc_here(me, v_plot.id),
          'free', aquaterra_arc_free(me),
          'attemptsLeft', CASE WHEN a.id IS NOT NULL THEN greatest(0, 3 - (SELECT count(*) FROM aquaterra_arcade_runs
              WHERE arcade_id = a.id AND player = me AND NOT practice AND started_at >= current_date)) END,
          'prizeHereToday', CASE WHEN a.id IS NOT NULL THEN EXISTS (SELECT 1 FROM aquaterra_arcade_runs
              WHERE arcade_id = a.id AND player = me AND prize > 0 AND started_at >= current_date) END,
          'prizeLeftToday', greatest(0, aquaterra_arc_param('arcade_daily_prize_cap', 500)::bigint - COALESCE((SELECT sum(prize) FROM aquaterra_arcade_runs
              WHERE player = me AND started_at >= current_date), 0))) END);

    ELSIF act = 'place' THEN
      SELECT * INTO v_plot FROM aquaterra_plots WHERE id = (req->>'plotId')::int;
      IF v_plot.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      IF aquaterra_arc_operator(v_plot.id) IS DISTINCT FROM me THEN RAISE EXCEPTION 'forbidden'; END IF;
      v_tpl := req->>'template'; v_diff := COALESCE(req->>'difficulty', 'normal');
      IF v_tpl NOT IN ('quiz', 'crystals', 'maze', 'range', 'race') THEN RAISE EXCEPTION 'template'; END IF;
      IF v_diff NOT IN ('easy', 'normal', 'hard') THEN RAISE EXCEPTION 'difficulty'; END IF;
      v_fee := COALESCE((req->>'entryFee')::bigint, 0); v_prize := COALESCE((req->>'prize')::bigint, 0); v_amt := COALESCE((req->>'deposit')::bigint, 0);
      IF v_fee < 0 OR v_fee > 1000 OR v_prize < 0 OR v_prize > 10000 OR v_amt < 0 OR v_amt > 1000000 THEN RAISE EXCEPTION 'amount'; END IF;
      v_title := left(btrim(regexp_replace(COALESCE(req->>'title', ''), '\s+', ' ', 'g')), 40);
      IF length(v_title) < 3 THEN RAISE EXCEPTION 'title'; END IF;
      v_cfg := '{}'::jsonb;
      IF v_tpl = 'quiz' THEN
        v_cfg := jsonb_build_object('topic', COALESCE(req->>'topic', 'mixed'));
        IF v_cfg->>'topic' NOT IN ('mixed', 'elements', 'science', 'commonwealth', 'world', 'custom') THEN RAISE EXCEPTION 'questions'; END IF;
        IF v_cfg->>'topic' = 'custom' THEN v_cfg := v_cfg || jsonb_build_object('questions', aquaterra_arc_clean_questions(req->'questions')); END IF;
      END IF;
      SELECT * INTO a FROM aquaterra_arcade WHERE plot_id = v_plot.id AND status = 'open' FOR UPDATE;
      IF a.id IS NOT NULL THEN
        IF a.operator <> 'nics-ai' THEN RAISE EXCEPTION 'exists'; END IF;
        PERFORM aquaterra_arc_close(a.id, 'owner_moved_in');  -- the City Mind's pop-up makes room
      END IF;
      IF aquaterra_arc_free(me) < v_amt THEN RAISE EXCEPTION 'insufficient'; END IF;
      INSERT INTO aquaterra_arcade (plot_id, operator, template, title, difficulty, entry_fee, prize, pool, config)
      VALUES (v_plot.id, me, v_tpl, v_title, v_diff, v_fee, v_prize, v_amt, v_cfg) RETURNING * INTO a;
      PERFORM aquaterra_arc_pay(me, 'arcade:escrow', v_amt, 'arcade_pool', v_plot.id, 'Prize pool: ' || v_title, me, 'arcade:' || a.id || ':pool');
      res := jsonb_build_object('attraction', aquaterra_arc_public(a));

    ELSIF act IN ('update', 'topup', 'close') THEN
      SELECT * INTO a FROM aquaterra_arcade WHERE id = (req->>'id')::int AND status = 'open' FOR UPDATE;
      IF a.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      IF a.operator <> me THEN RAISE EXCEPTION 'forbidden'; END IF;
      IF act = 'close' THEN
        PERFORM aquaterra_arc_close(a.id, 'closed');
        res := jsonb_build_object('closed', a.id, 'refund', a.pool);
      ELSIF act = 'topup' THEN
        v_amt := (req->>'amount')::bigint;
        IF v_amt IS NULL OR v_amt < 1 OR v_amt > 1000000 THEN RAISE EXCEPTION 'amount'; END IF;
        IF aquaterra_arc_free(me) < v_amt THEN RAISE EXCEPTION 'insufficient'; END IF;
        PERFORM aquaterra_arc_pay(me, 'arcade:escrow', v_amt, 'arcade_pool', a.plot_id, 'Prize pool: ' || a.title, me, 'arcade:' || a.id || ':pool');
        UPDATE aquaterra_arcade SET pool = pool + v_amt WHERE id = a.id RETURNING * INTO a;
        res := jsonb_build_object('attraction', aquaterra_arc_public(a));
      ELSE
        v_fee := COALESCE((req->>'entryFee')::bigint, a.entry_fee); v_prize := COALESCE((req->>'prize')::bigint, a.prize);
        v_diff := COALESCE(req->>'difficulty', a.difficulty);
        v_title := COALESCE(left(btrim(regexp_replace(req->>'title', '\s+', ' ', 'g')), 40), a.title);
        IF v_fee < 0 OR v_fee > 1000 OR v_prize < 0 OR v_prize > 10000 THEN RAISE EXCEPTION 'amount'; END IF;
        IF v_diff NOT IN ('easy', 'normal', 'hard') THEN RAISE EXCEPTION 'difficulty'; END IF;
        IF length(v_title) < 3 THEN RAISE EXCEPTION 'title'; END IF;
        UPDATE aquaterra_arcade SET entry_fee = v_fee, prize = v_prize, difficulty = v_diff, title = v_title WHERE id = a.id RETURNING * INTO a;
        res := jsonb_build_object('attraction', aquaterra_arc_public(a));
      END IF;

    ELSIF act = 'start' THEN
      SELECT * INTO a FROM aquaterra_arcade WHERE id = (req->>'id')::int FOR UPDATE;
      IF a.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      IF a.status <> 'open' THEN RAISE EXCEPTION 'closed'; END IF;
      -- the operator may try their own game anywhere, for free and for nothing
      IF a.operator <> me AND NOT aquaterra_arc_here(me, a.plot_id) THEN RAISE EXCEPTION 'not_here'; END IF;
      -- one game at a time: an unfinished one is lost
      UPDATE aquaterra_arcade_runs SET status = 'done', finished_at = now(), score = 0, won = false WHERE player = me AND status = 'live';
      IF a.operator <> me THEN
        SELECT count(*) INTO v_n FROM aquaterra_arcade_runs WHERE arcade_id = a.id AND player = me AND NOT practice AND started_at >= current_date;
        IF v_n >= 3 THEN RAISE EXCEPTION 'attempts'; END IF;
        IF a.entry_fee > 0 AND aquaterra_arc_free(me) < a.entry_fee THEN RAISE EXCEPTION 'insufficient'; END IF;
      END IF;
      v_seed := encode(gen_random_bytes(12), 'hex');
      v_build := CASE a.template WHEN 'quiz' THEN aquaterra_arc_build_quiz(a, v_seed) WHEN 'crystals' THEN aquaterra_arc_build_crystals(a, v_seed)
        WHEN 'maze' THEN aquaterra_arc_build_maze(a, v_seed) WHEN 'range' THEN aquaterra_arc_build_range(a, v_seed) ELSE aquaterra_arc_build_race(a, v_seed) END;
      SELECT p.district, d.land INTO v_district, v_land FROM aquaterra_plots p LEFT JOIN aquaterra_districts d ON d.name = p.district AND d.merged_into IS NULL WHERE p.id = a.plot_id LIMIT 1;
      INSERT INTO aquaterra_arcade_runs (arcade_id, player, district, land, deadline, secret, public, max_score, practice)
      VALUES (a.id, me, v_district, v_land, now() + make_interval(secs => (v_build->>'seconds')::int + 20), v_build->'secret', v_build->'public',
        (v_build->>'max')::int, a.operator = me)
      RETURNING * INTO run;
      IF a.operator <> me AND a.entry_fee > 0 THEN
        v_tax := aquaterra_arc_pay_taxed(me, CASE WHEN a.operator = 'nics-ai' THEN 'treasury' ELSE a.operator END, a.entry_fee,
          'arcade_entry_tax_pct', 'arcade_entry', a.plot_id, 'Ticket: ' || a.title, me, 'arcade:' || a.id || ':run:' || run.id);
        UPDATE aquaterra_arcade_runs SET fee = a.entry_fee WHERE id = run.id;
      END IF;
      res := jsonb_build_object('run', run.id, 'template', a.template, 'title', a.title, 'difficulty', a.difficulty, 'practice', run.practice,
        'fee', CASE WHEN run.practice THEN 0 ELSE a.entry_fee END, 'game', run.public, 'deadline', run.deadline, 'startedAt', run.started_at);

    ELSIF act = 'move' THEN
      SELECT * INTO run FROM aquaterra_arcade_runs WHERE id = (req->>'run')::bigint AND player = me FOR UPDATE;
      IF run.id IS NULL THEN RAISE EXCEPTION 'run'; END IF;
      IF run.status <> 'live' THEN RAISE EXCEPTION 'done'; END IF;
      SELECT * INTO a FROM aquaterra_arcade WHERE id = run.arcade_id;
      IF a.template <> 'crystals' THEN RAISE EXCEPTION 'run'; END IF;
      v_size := (run.public->>'size')::int; v_cell := (req->>'cell')::int;
      IF v_cell IS NULL OR v_cell < 0 OR v_cell >= v_size * v_size THEN RAISE EXCEPTION 'amount'; END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(run.moves) m WHERE (m->>'cell')::int = v_cell) THEN RAISE EXCEPTION 'picked'; END IF;
      IF jsonb_array_length(run.moves) >= (run.public->>'picks')::int OR now() > run.deadline THEN RAISE EXCEPTION 'done'; END IF;
      v_hit := run.secret->'cells' @> to_jsonb(v_cell);
      -- a miss tells how far the nearest crystal still hidden is (in steps, diagonals count as one)
      SELECT min(greatest(abs((c::int % v_size) - (v_cell % v_size)), abs((c::int / v_size) - (v_cell / v_size)))) INTO v_dist
      FROM jsonb_array_elements_text(run.secret->'cells') c
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(run.moves) m WHERE (m->>'cell')::int = c::int) AND c::int <> v_cell;
      UPDATE aquaterra_arcade_runs SET moves = moves || jsonb_build_object('cell', v_cell, 'hit', v_hit, 'near', CASE WHEN v_hit THEN NULL ELSE v_dist END)
        WHERE id = run.id RETURNING * INTO run;
      res := jsonb_build_object('cell', v_cell, 'hit', v_hit, 'near', CASE WHEN v_hit THEN NULL ELSE v_dist END,
        'found', (SELECT count(*) FROM jsonb_array_elements(run.moves) m WHERE (m->>'hit')::boolean),
        'picksLeft', (run.public->>'picks')::int - jsonb_array_length(run.moves));

    ELSIF act = 'finish' THEN
      SELECT * INTO run FROM aquaterra_arcade_runs WHERE id = (req->>'run')::bigint AND player = me FOR UPDATE;
      IF run.id IS NULL THEN RAISE EXCEPTION 'run'; END IF;
      IF run.status <> 'live' THEN RAISE EXCEPTION 'done'; END IF;
      SELECT * INTO a FROM aquaterra_arcade WHERE id = run.arcade_id FOR UPDATE;
      v_score := aquaterra_arc_score(run, a.template, req);
      v_prize := 0; v_tax := 0;
      IF (v_score->>'won')::boolean AND NOT run.practice AND a.status = 'open' AND a.prize > 0 AND a.pool > 0
         AND NOT EXISTS (SELECT 1 FROM aquaterra_arcade_runs WHERE arcade_id = a.id AND player = me AND prize > 0 AND started_at >= current_date) THEN
        v_cap := aquaterra_arc_param('arcade_daily_prize_cap', 500)::bigint;
        SELECT COALESCE(sum(prize), 0) INTO v_won_today FROM aquaterra_arcade_runs WHERE player = me AND started_at >= current_date;
        v_prize := greatest(0, least(a.prize, a.pool, v_cap - v_won_today));
        IF v_prize > 0 THEN
          v_tax := aquaterra_arc_pay_taxed('arcade:escrow', me, v_prize, 'arcade_prize_tax_pct', 'arcade_prize', a.plot_id,
            'Prize: ' || a.title, NULL, 'arcade:' || a.id || ':run:' || run.id);
          UPDATE aquaterra_arcade SET pool = pool - v_prize WHERE id = a.id;
        END IF;
      END IF;
      UPDATE aquaterra_arcade_runs SET status = 'done', finished_at = now(), score = (v_score->>'score')::int, won = (v_score->>'won')::boolean,
        prize = v_prize, moves = CASE WHEN a.template = 'crystals' THEN moves WHEN length((req - 'session' - 'action' - 'run')::text) <= 8000 THEN req - 'session' - 'action' - 'run' ELSE '[]'::jsonb END
        WHERE id = run.id;
      IF NOT run.practice THEN
        UPDATE aquaterra_arcade SET plays = plays + 1, wins = wins + CASE WHEN (v_score->>'won')::boolean THEN 1 ELSE 0 END WHERE id = a.id;
      END IF;
      res := jsonb_build_object('score', (v_score->>'score')::int, 'maxScore', run.max_score, 'won', (v_score->>'won')::boolean,
        'prize', v_prize, 'tax', v_tax, 'practice', run.practice, 'review', v_score->'review', 'detail', v_score - 'review' - 'score' - 'won',
        'quests', aquaterra_arc_quests(me));

    ELSIF act = 'me' THEN
      res := jsonb_build_object(
        'quests', aquaterra_arc_quests(me),
        'ranking', aquaterra_arc_ranking(me),
        'today', jsonb_build_object(
          'plays', (SELECT count(*) FROM aquaterra_arcade_runs WHERE player = me AND NOT practice AND started_at >= current_date),
          'prizeWon', (SELECT COALESCE(sum(prize), 0) FROM aquaterra_arcade_runs WHERE player = me AND started_at >= current_date),
          'cap', aquaterra_arc_param('arcade_daily_prize_cap', 500)),
        'operating', COALESCE((SELECT jsonb_agg(aquaterra_arc_public(x) || jsonb_build_object(
            'earned', (SELECT COALESCE(sum(fee), 0) FROM aquaterra_arcade_runs r WHERE r.arcade_id = x.id)) ORDER BY x.id)
          FROM aquaterra_arcade x WHERE x.operator = me AND x.status = 'open'), '[]'::jsonb),
        'rentals', COALESCE((SELECT jsonb_agg(jsonb_build_object('plotId', r.plot_id, 'endsAt', r.ends_at, 'as', CASE WHEN r.tenant = me THEN 'tenant' ELSE 'owner' END,
            'other', aquaterra_arc_name(CASE WHEN r.tenant = me THEN r.owner ELSE r.tenant END), 'paid', r.paid) ORDER BY r.ends_at)
          FROM aquaterra_arcade_rentals r WHERE (r.tenant = me OR r.owner = me) AND r.ends_at > now()), '[]'::jsonb),
        'offers', COALESCE((SELECT jsonb_agg(jsonb_build_object('plotId', plot_id, 'pricePerDay', price_per_day, 'maxDays', max_days) ORDER BY plot_id)
          FROM aquaterra_arcade_rent_offers WHERE owner = me), '[]'::jsonb),
        'recent', COALESCE((SELECT jsonb_agg(jsonb_build_object('title', x.title, 'template', x.template, 'plotId', x.plot_id, 'score', r.score, 'maxScore', r.max_score,
            'won', r.won, 'prize', r.prize, 'at', r.finished_at) ORDER BY r.id DESC)
          FROM (SELECT * FROM aquaterra_arcade_runs WHERE player = me AND status = 'done' AND NOT practice ORDER BY id DESC LIMIT 10) r
          JOIN aquaterra_arcade x ON x.id = r.arcade_id), '[]'::jsonb));

    ELSIF act = 'claim_quest' THEN
      SELECT e INTO v_q FROM jsonb_array_elements(aquaterra_arc_quests(me)) e WHERE e->>'id' = req->>'quest';
      IF v_q IS NULL THEN RAISE EXCEPTION 'quest'; END IF;
      IF (v_q->>'claimed')::boolean THEN RAISE EXCEPTION 'done'; END IF;
      IF (v_q->>'progress')::int < (v_q->>'need')::int THEN RAISE EXCEPTION 'not_ready'; END IF;
      INSERT INTO aquaterra_arcade_quests_done (player, day, quest, reward) VALUES (me, current_date, v_q->>'id', (v_q->>'reward')::bigint);
      PERFORM aquaterra_arc_pay('treasury', me, (v_q->>'reward')::bigint, 'quest', NULL, 'Daily quest', NULL, 'quest:' || current_date || ':' || (v_q->>'id'));
      res := jsonb_build_object('reward', (v_q->>'reward')::bigint, 'quests', aquaterra_arc_quests(me));

    ELSIF act IN ('rent_offer', 'rent_cancel') THEN
      SELECT owner INTO v_owner FROM aquaterra_plot_owners WHERE plot_id = (req->>'plotId')::int;
      IF v_owner IS DISTINCT FROM me THEN RAISE EXCEPTION 'forbidden'; END IF;
      IF act = 'rent_cancel' THEN
        DELETE FROM aquaterra_arcade_rent_offers WHERE plot_id = (req->>'plotId')::int;
      ELSE
        v_amt := (req->>'pricePerDay')::bigint; v_days := (req->>'maxDays')::int;
        IF v_amt IS NULL OR v_amt < 1 OR v_amt > 100000 THEN RAISE EXCEPTION 'amount'; END IF;
        IF v_days IS NULL OR v_days < 1 OR v_days > 30 THEN RAISE EXCEPTION 'days'; END IF;
        INSERT INTO aquaterra_arcade_rent_offers (plot_id, owner, price_per_day, max_days) VALUES ((req->>'plotId')::int, me, v_amt, v_days)
        ON CONFLICT (plot_id) DO UPDATE SET price_per_day = EXCLUDED.price_per_day, max_days = EXCLUDED.max_days, owner = EXCLUDED.owner;
      END IF;
      res := jsonb_build_object('plotId', (req->>'plotId')::int);

    ELSIF act = 'rent' THEN
      SELECT * INTO v_offer FROM aquaterra_arcade_rent_offers WHERE plot_id = (req->>'plotId')::int FOR UPDATE;
      IF v_offer.plot_id IS NULL THEN RAISE EXCEPTION 'no_offer'; END IF;
      IF v_offer.owner IS DISTINCT FROM (SELECT owner FROM aquaterra_plot_owners WHERE plot_id = v_offer.plot_id) THEN RAISE EXCEPTION 'no_offer'; END IF;
      IF v_offer.owner = me THEN RAISE EXCEPTION 'self'; END IF;
      IF EXISTS (SELECT 1 FROM aquaterra_arcade_rentals WHERE plot_id = v_offer.plot_id AND ends_at > now()) THEN RAISE EXCEPTION 'busy'; END IF;
      v_days := (req->>'days')::int;
      IF v_days IS NULL OR v_days < 1 OR v_days > v_offer.max_days THEN RAISE EXCEPTION 'days'; END IF;
      SELECT * INTO a FROM aquaterra_arcade WHERE plot_id = v_offer.plot_id AND status = 'open' FOR UPDATE;
      IF a.id IS NOT NULL AND a.operator <> 'nics-ai' THEN RAISE EXCEPTION 'busy'; END IF;
      v_amt := v_offer.price_per_day * v_days;
      IF aquaterra_arc_free(me) < v_amt THEN RAISE EXCEPTION 'insufficient'; END IF;
      IF a.id IS NOT NULL THEN PERFORM aquaterra_arc_close(a.id, 'rented'); END IF;
      INSERT INTO aquaterra_arcade_rentals (plot_id, owner, tenant, price_per_day, days, paid, ends_at)
      VALUES (v_offer.plot_id, v_offer.owner, me, v_offer.price_per_day, v_days, v_amt, now() + make_interval(days => v_days)) RETURNING id INTO v_n;
      v_tax := aquaterra_arc_pay_taxed(me, v_offer.owner, v_amt, 'rent_tax_pct', 'rent', v_offer.plot_id, 'Rent, ' || v_days || ' days', me, 'rent:' || v_n);
      DELETE FROM aquaterra_arcade_rent_offers WHERE plot_id = v_offer.plot_id;
      res := jsonb_build_object('plotId', v_offer.plot_id, 'days', v_days, 'paid', v_amt, 'tax', v_tax,
        'endsAt', (SELECT ends_at FROM aquaterra_arcade_rentals WHERE id = v_n));
    ELSE
      RAISE EXCEPTION 'action';
    END IF;
  EXCEPTION
    WHEN raise_exception THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM,
        'status', CASE SQLERRM WHEN 'forbidden' THEN 403 WHEN 'not_found' THEN 404 WHEN 'exists' THEN 409 WHEN 'busy' THEN 409 ELSE 400 END);
    WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
      RETURN jsonb_build_object('ok', false, 'error', 'amount', 'status', 400);
  END;

  RETURN jsonb_build_object('ok', true, 'status', 200) || res;
END $fn$;
