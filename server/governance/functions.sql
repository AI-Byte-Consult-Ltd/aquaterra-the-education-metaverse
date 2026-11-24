-- AquaTerra Commonwealth: how the state works.
-- Every rule of governance lives here, in the database, so the server decides
-- and the site only shows. Loaded by a one-off migration (CREATE OR REPLACE).
--   aquaterra_gov(request jsonb)        one call per web request
--   aquaterra_gov_tick(districts jsonb) every few minutes: sync districts,
--                                       seats, elections, closing votes, NICS AI

-- ---------------------------------------------------------------- helpers

CREATE OR REPLACE FUNCTION aquaterra_gov_param(k text) RETURNS numeric
LANGUAGE sql STABLE AS $fn$ SELECT value FROM aquaterra_gov_params WHERE key = k $fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov_name(e text) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT CASE WHEN e = 'nics-ai' THEN 'NICS AI'
    ELSE COALESCE((SELECT display_name FROM aquaterra_players WHERE email = e), 'Citizen') END
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov_session(token text) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT email FROM aquaterra_sessions
  WHERE token_hash = encode(sha256(convert_to(COALESCE(token, ''), 'UTF8')), 'hex') AND expires_at > now()
$fn$;

-- The district that governs a district (itself unless merged).
CREATE OR REPLACE FUNCTION aquaterra_gov_admin(d int) RETURNS int
LANGUAGE sql STABLE AS $fn$ SELECT COALESCE(merged_into, id) FROM aquaterra_districts WHERE id = d $fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov_admin_name(d int) RETURNS text
LANGUAGE sql STABLE AS $fn$ SELECT COALESCE(admin_name, name) FROM aquaterra_districts WHERE id = aquaterra_gov_admin(d) $fn$;

-- Residents of a governing district, merged parts included.
CREATE OR REPLACE FUNCTION aquaterra_gov_residents(admin int) RETURNS int
LANGUAGE sql STABLE AS $fn$
  SELECT count(*)::int FROM aquaterra_residents r JOIN aquaterra_districts d ON d.id = r.district_id
  WHERE COALESCE(d.merged_into, d.id) = admin
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov_deputies() RETURNS int
LANGUAGE sql STABLE AS $fn$
  SELECT count(*)::int FROM aquaterra_gov_seats WHERE holder_email IS NOT NULL AND (term_ends IS NULL OR term_ends > now())
$fn$;

-- Founding Assembly: until enough deputies are elected, every resident sits in the Assembly.
CREATE OR REPLACE FUNCTION aquaterra_gov_founding() RETURNS boolean
LANGUAGE sql STABLE AS $fn$ SELECT aquaterra_gov_deputies() < aquaterra_gov_param('founding_deputies') $fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov_treasury() RETURNS bigint
LANGUAGE plpgsql STABLE AS $fn$
DECLARE b bigint;
BEGIN
  IF to_regclass('aquaterra_wallets') IS NULL THEN RETURN 0; END IF;
  EXECUTE format('SELECT balance::bigint FROM aquaterra_wallets WHERE account = %L', 'state:treasury') INTO b;
  RETURN COALESCE(b, 0);
END $fn$;

-- Moves TIDE through the economy's ledger (aquaterra_tide_transfer, owned by
-- "[64 PUBLIC] AquaTerra Economy"). Raises its exception when it cannot pay.
CREATE OR REPLACE FUNCTION aquaterra_gov_pay(from_acc text, to_acc text, amount bigint, memo text, ref text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF to_regprocedure('aquaterra_tide_transfer(text,text,bigint,text,text)') IS NULL THEN RAISE EXCEPTION 'ledger not live'; END IF;
  EXECUTE format('SELECT aquaterra_tide_transfer(%L, %L, %s::bigint, %L, %L)', from_acc, to_acc, amount, memo, ref);
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov_log_add(k text, pid int, t text) RETURNS void
LANGUAGE sql AS $fn$ INSERT INTO aquaterra_gov_log (kind, proposal_id, text) VALUES (k, pid, t) $fn$;

-- Council members who may vote: seats with a person or the AI, terms not ended.
CREATE OR REPLACE FUNCTION aquaterra_gov_council_voters() RETURNS TABLE (voter text)
LANGUAGE sql STABLE AS $fn$
  SELECT CASE WHEN kind = 'ai' THEN 'nics-ai' ELSE email END FROM aquaterra_council
  WHERE (kind = 'ai' OR email IS NOT NULL) AND (term_ends IS NULL OR term_ends > now())
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov_assembly_voters() RETURNS TABLE (voter text)
LANGUAGE sql STABLE AS $fn$
  SELECT email FROM aquaterra_residents WHERE aquaterra_gov_founding()
  UNION
  SELECT holder_email FROM aquaterra_gov_seats
  WHERE NOT aquaterra_gov_founding() AND holder_email IS NOT NULL AND (term_ends IS NULL OR term_ends > now())
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov_district_voters(admins int[]) RETURNS TABLE (voter text)
LANGUAGE sql STABLE AS $fn$
  SELECT r.email FROM aquaterra_residents r JOIN aquaterra_districts d ON d.id = r.district_id
  WHERE admins IS NULL OR COALESCE(d.merged_into, d.id) = ANY (admins)
$fn$;

-- Districts a proposal concerns, as governing districts.
CREATE OR REPLACE FUNCTION aquaterra_gov_scope(payload jsonb) RETURNS int[]
LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN payload ? 'districts' THEN ARRAY(SELECT DISTINCT aquaterra_gov_admin(x::int) FROM jsonb_array_elements_text(payload->'districts') x)
    WHEN payload ? 'district' THEN ARRAY[aquaterra_gov_admin((payload->>'district')::int)]
    ELSE NULL END
$fn$;

-- Who may vote in the current stage of a proposal.
CREATE OR REPLACE FUNCTION aquaterra_gov_electorate(pid int) RETURNS TABLE (voter text)
LANGUAGE plpgsql STABLE AS $fn$
DECLARE p aquaterra_gov_proposals; v_body text;
BEGIN
  SELECT * INTO p FROM aquaterra_gov_proposals WHERE id = pid;
  IF p.id IS NULL OR p.status <> 'voting' THEN RETURN; END IF;
  v_body := p.stages->p.stage->>'body';
  IF v_body = 'council' THEN RETURN QUERY SELECT * FROM aquaterra_gov_council_voters();
  ELSIF v_body = 'assembly' THEN RETURN QUERY SELECT * FROM aquaterra_gov_assembly_voters();
  ELSIF v_body = 'mayors' THEN
    RETURN QUERY SELECT mayor_email FROM aquaterra_districts
      WHERE merged_into IS NULL AND mayor_email IS NOT NULL AND mayor_term_ends > now();
  ELSIF v_body = 'district' THEN RETURN QUERY SELECT * FROM aquaterra_gov_district_voters(aquaterra_gov_scope(p.payload));
  ELSIF v_body = 'referendum' THEN
    RETURN QUERY SELECT * FROM aquaterra_gov_district_voters(CASE WHEN p.payload ? 'districts' THEN aquaterra_gov_scope(p.payload) END);
  ELSIF v_body = 'ballot' THEN
    IF p.payload->>'office' = 'council' THEN RETURN QUERY SELECT * FROM aquaterra_gov_assembly_voters();
    ELSE RETURN QUERY SELECT * FROM aquaterra_gov_district_voters(aquaterra_gov_scope(p.payload)); END IF;
  END IF;
END $fn$;

-- Which bodies decide each kind of proposal, in order, and by what majority.
CREATE OR REPLACE FUNCTION aquaterra_gov_pipeline(kind text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE kind
    WHEN 'resolution' THEN '[{"body":"assembly","rule":"majority"},{"body":"council","rule":"council"}]'
    WHEN 'set_param' THEN '[{"body":"assembly","rule":"majority"},{"body":"council","rule":"council"}]'
    WHEN 'budget' THEN '[{"body":"assembly","rule":"majority"},{"body":"council","rule":"council"}]'
    WHEN 'building' THEN '[{"body":"district","rule":"majority"}]'
    WHEN 'skyscraper' THEN '[{"body":"district","rule":"majority"},{"body":"assembly","rule":"majority"},{"body":"council","rule":"council"}]'
    WHEN 'new_district' THEN '[{"body":"mayors","rule":"advisory"},{"body":"assembly","rule":"3/5"},{"body":"council","rule":"council"}]'
    WHEN 'district_merge' THEN '[{"body":"mayors","rule":"advisory"},{"body":"assembly","rule":"3/5"},{"body":"council","rule":"council"},{"body":"referendum","rule":"majority"}]'
    WHEN 'district_split' THEN '[{"body":"mayors","rule":"advisory"},{"body":"assembly","rule":"3/5"},{"body":"council","rule":"council"},{"body":"referendum","rule":"majority"}]'
    WHEN 'strategy' THEN '[{"body":"assembly","rule":"majority"},{"body":"council","rule":"council"},{"body":"referendum","rule":"majority"}]'
    WHEN 'charter' THEN '[{"body":"assembly","rule":"2/3"},{"body":"council","rule":"council"},{"body":"referendum","rule":"majority"}]'
    WHEN 'appoint_director' THEN '[{"body":"assembly","rule":"majority"},{"body":"council","rule":"council"}]'
    WHEN 'dismiss' THEN '[{"body":"assembly","rule":"3/5"},{"body":"council","rule":"council"}]'
    WHEN 'election' THEN '[{"body":"nomination"},{"body":"ballot"}]'
  END::jsonb
$fn$;

-- Holds any public office (these skip the signature stage).
CREATE OR REPLACE FUNCTION aquaterra_gov_official(e text) RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (SELECT 1 FROM aquaterra_players WHERE email = e AND role IN ('founder', 'admin'))
      OR EXISTS (SELECT 1 FROM aquaterra_council WHERE email = e AND (term_ends IS NULL OR term_ends > now()))
      OR EXISTS (SELECT 1 FROM aquaterra_gov_seats WHERE holder_email = e AND (term_ends IS NULL OR term_ends > now()))
      OR EXISTS (SELECT 1 FROM aquaterra_districts WHERE mayor_email = e AND mayor_term_ends > now())
      OR EXISTS (SELECT 1 FROM aquaterra_gov_directorate WHERE holder_email = e AND term_ends > now())
$fn$;

-- May act for a Directorate post: its holder, or the founder while the post is empty.
CREATE OR REPLACE FUNCTION aquaterra_gov_can_act(e text, post_name text) RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (SELECT 1 FROM aquaterra_gov_directorate WHERE post = post_name AND holder_email = e AND term_ends > now())
      OR (EXISTS (SELECT 1 FROM aquaterra_players WHERE email = e AND role = 'founder')
          AND NOT EXISTS (SELECT 1 FROM aquaterra_gov_directorate WHERE post = post_name AND holder_email IS NOT NULL AND term_ends > now()))
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov_signatures_needed() RETURNS int
LANGUAGE sql STABLE AS $fn$
  SELECT GREATEST(1, LEAST((SELECT count(*) FROM aquaterra_residents)::int,
    GREATEST(aquaterra_gov_param('signatures_min'), ceil((SELECT count(*) FROM aquaterra_residents) * aquaterra_gov_param('signatures_pct') / 100))::int))
$fn$;

-- ---------------------------------------------------------------- tallies

CREATE OR REPLACE FUNCTION aquaterra_gov_tally(pid int, st int) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE p aquaterra_gov_proposals; n int; y int; no_ int; ab int; v_body text; rule text; need int; quorum int; passed boolean; decided boolean;
BEGIN
  SELECT * INTO p FROM aquaterra_gov_proposals WHERE id = pid;
  v_body := p.stages->st->>'body';
  rule := p.stages->st->>'rule';
  SELECT count(*) INTO n FROM aquaterra_gov_electorate(pid);
  SELECT count(*) FILTER (WHERE v.choice = 'yes'), count(*) FILTER (WHERE v.choice = 'no'), count(*) FILTER (WHERE v.choice = 'abstain')
    INTO y, no_, ab
    FROM aquaterra_gov_votes v WHERE v.proposal_id = pid AND v.stage = st AND v.voter IN (SELECT voter FROM aquaterra_gov_electorate(pid));
  IF rule = 'council' THEN
    need := GREATEST(1, ceil(n * 7 / 11.0))::int;
    quorum := need;
    passed := y >= need;
    decided := passed OR y + (n - y - no_ - ab) < need;
  ELSIF rule = 'advisory' THEN
    need := 0; quorum := 0; passed := true; decided := n > 0 AND y + no_ + ab >= n;
  ELSE
    quorum := CASE WHEN v_body = 'assembly' AND NOT aquaterra_gov_founding()
      THEN ceil(n * aquaterra_gov_param('assembly_quorum_pct') / 100)
      ELSE GREATEST(1, ceil(n * aquaterra_gov_param('quorum_pct') / 100)) END;
    need := NULL;
    passed := y + no_ + ab >= quorum AND y > 0 AND CASE rule
      WHEN '3/5' THEN y * 5 >= (y + no_) * 3
      WHEN '2/3' THEN y * 3 >= (y + no_) * 2
      ELSE y > no_ END;
    decided := n > 0 AND y + no_ + ab >= n;
  END IF;
  RETURN jsonb_build_object('body', v_body, 'rule', rule, 'electorate', n, 'yes', y, 'no', no_, 'abstain', ab,
    'quorum', quorum, 'need', need, 'passing', passed, 'decided', decided);
END $fn$;

-- ---------------------------------------------------------------- NICS AI

-- NICS AI's vote in the Council: fixed public rules, no language model.
CREATE OR REPLACE FUNCTION aquaterra_gov_nics_ai(pid int) RETURNS TABLE (choice text, reason text)
LANGUAGE plpgsql STABLE AS $fn$
DECLARE p aquaterra_gov_proposals; v numeric; n numeric; cap numeric; waiting int; prev jsonb;
BEGIN
  SELECT * INTO p FROM aquaterra_gov_proposals WHERE id = pid;
  IF p.kind = 'charter' AND (p.title || ' ' || p.body) ~* '(permanent|seat 1\M|seat 2\M|founder|nics ai|city mind)'
     AND (p.title || ' ' || p.body) ~* '(remov|abolish|replac|strip|expel|revok|end the|dissolv)' THEN
    RETURN QUERY SELECT 'no', 'Rule C1: Article 1 of the Tide Charter is entrenched. The two permanent seats cannot be changed.'; RETURN;
  END IF;
  IF p.kind = 'set_param' THEN
    v := aquaterra_gov_param(p.payload->>'key'); n := (p.payload->>'value')::numeric;
    IF p.payload->>'key' IN ('land_tax_pct', 'sales_tax_pct') AND abs(n - v) > 2 THEN
      RETURN QUERY SELECT 'no', format('Rule E1: taxes move at most 2 points at a time (now %s%%, asked %s%%). Propose a smaller step.', v, n); RETURN;
    END IF;
  END IF;
  IF p.kind = 'budget' THEN
    cap := floor(aquaterra_gov_treasury() * aquaterra_gov_param('budget_reserve_pct') / 100);
    IF (p.payload->>'amount')::numeric > cap THEN
      RETURN QUERY SELECT 'no', format('Rule E2: one budget law may use at most %s%% of the treasury, now %s TIDE.', aquaterra_gov_param('budget_reserve_pct'), cap); RETURN;
    END IF;
  END IF;
  IF p.kind IN ('skyscraper') THEN
    SELECT r INTO prev FROM jsonb_array_elements(p.results) r WHERE r->>'body' = 'district' LIMIT 1;
    IF prev IS NOT NULL AND (prev->>'skipped')::boolean THEN
      RETURN QUERY SELECT 'no', 'Rule W1: nobody lives in that district yet, so no resident could agree to the tower.'; RETURN;
    END IF;
  END IF;
  IF p.kind = 'new_district' THEN
    SELECT count(*) INTO waiting FROM aquaterra_gov_projects WHERE kind = 'new_district' AND status = 'approved';
    IF waiting >= 3 THEN
      RETURN QUERY SELECT 'no', format('Rule W2: %s approved districts are still waiting to be built. Build them first.', waiting); RETURN;
    END IF;
  END IF;
  IF p.kind IN ('district_merge', 'district_split') AND EXISTS (
       SELECT 1 FROM aquaterra_districts WHERE capital AND id IN (aquaterra_gov_admin((p.payload->>'district')::int), aquaterra_gov_admin(NULLIF(p.payload->>'into', '')::int))) THEN
    RETURN QUERY SELECT 'no', 'Rule W3: First Light City stays a district of its own.'; RETURN;
  END IF;
  RETURN QUERY SELECT 'yes', 'Rule G1: the citizens'' bodies approved it and it breaks no rule of the Charter.';
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov_nics_vote(pid int) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE p aquaterra_gov_proposals; c text; r text;
BEGIN
  SELECT * INTO p FROM aquaterra_gov_proposals WHERE id = pid;
  IF p.status <> 'voting' OR p.stages->p.stage->>'body' <> 'council' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM aquaterra_gov_council_voters() WHERE voter = 'nics-ai') THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM aquaterra_gov_votes WHERE proposal_id = pid AND stage = p.stage AND voter = 'nics-ai') THEN RETURN; END IF;
  SELECT choice, reason INTO c, r FROM aquaterra_gov_nics_ai(pid);
  INSERT INTO aquaterra_gov_votes (proposal_id, stage, voter, choice, reason) VALUES (pid, p.stage, 'nics-ai', c, r);
  PERFORM aquaterra_gov_log_add('vote', pid, format('NICS AI voted %s on "%s". %s', upper(c), p.title, r));
  IF (aquaterra_gov_tally(pid, p.stage)->>'decided')::boolean THEN PERFORM aquaterra_gov_close_stage(pid); END IF;
END $fn$;

-- ---------------------------------------------------------------- stages

CREATE OR REPLACE FUNCTION aquaterra_gov_body_title(b text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE b WHEN 'council' THEN 'Council of First Light' WHEN 'assembly' THEN 'Citizens'' Assembly'
    WHEN 'mayors' THEN 'Conference of Mayors' WHEN 'district' THEN 'district vote' WHEN 'referendum' THEN 'referendum'
    WHEN 'nomination' THEN 'nominations' WHEN 'ballot' THEN 'ballot' ELSE b END
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov_open_stage(pid int, idx int) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE p aquaterra_gov_proposals; v_body text; days numeric; n int;
BEGIN
  SELECT * INTO p FROM aquaterra_gov_proposals WHERE id = pid FOR UPDATE;
  IF idx >= jsonb_array_length(p.stages) THEN
    PERFORM aquaterra_gov_finish(pid, true);
    RETURN;
  END IF;
  v_body := p.stages->idx->>'body';
  days := CASE v_body WHEN 'nomination' THEN aquaterra_gov_param('nomination_days') WHEN 'ballot' THEN aquaterra_gov_param('ballot_days')
    ELSE aquaterra_gov_param('voting_days') END;
  UPDATE aquaterra_gov_proposals SET status = 'voting', stage = idx, stage_started = now(), stage_ends = now() + days * interval '1 day' WHERE id = pid;
  IF v_body IN ('mayors', 'district', 'referendum') THEN
    SELECT count(*) INTO n FROM aquaterra_gov_electorate(pid);
    IF n = 0 THEN
      UPDATE aquaterra_gov_proposals SET results = results || jsonb_build_array(jsonb_build_object('body', v_body, 'skipped', true, 'passed', true, 'at', now()))
        WHERE id = pid;
      PERFORM aquaterra_gov_log_add('stage', pid, format('"%s": the %s was skipped, nobody can vote in it yet.', p.title, aquaterra_gov_body_title(v_body)));
      PERFORM aquaterra_gov_open_stage(pid, idx + 1);
      RETURN;
    END IF;
  END IF;
  IF v_body <> 'nomination' THEN
    PERFORM aquaterra_gov_log_add('stage', pid, format('"%s" is now before the %s until %s UTC.', p.title, aquaterra_gov_body_title(v_body),
      to_char(now() + days * interval '1 day', 'YYYY-MM-DD HH24:MI')));
  END IF;
  IF v_body = 'council' THEN PERFORM aquaterra_gov_nics_vote(pid); END IF;
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov_close_stage(pid int) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE p aquaterra_gov_proposals; t jsonb; v_body text;
BEGIN
  SELECT * INTO p FROM aquaterra_gov_proposals WHERE id = pid FOR UPDATE;
  IF p.status <> 'voting' THEN RETURN; END IF;
  v_body := p.stages->p.stage->>'body';
  IF p.kind = 'election' THEN PERFORM aquaterra_gov_close_election(pid); RETURN; END IF;
  t := aquaterra_gov_tally(pid, p.stage);
  UPDATE aquaterra_gov_proposals SET results = results || jsonb_build_array(t || jsonb_build_object('passed', (t->>'passing')::boolean, 'at', now())) WHERE id = pid;
  PERFORM aquaterra_gov_log_add('stage', pid, format('%s on "%s": %s yes, %s no, %s abstain of %s. %s.',
    upper(left(aquaterra_gov_body_title(v_body), 1)) || substr(aquaterra_gov_body_title(v_body), 2), p.title, t->>'yes', t->>'no', t->>'abstain', t->>'electorate',
    CASE WHEN t->>'rule' = 'advisory' THEN 'Opinion recorded' WHEN (t->>'passing')::boolean THEN 'Approved' ELSE 'Rejected' END));
  IF (t->>'passing')::boolean THEN PERFORM aquaterra_gov_open_stage(pid, p.stage + 1);
  ELSE PERFORM aquaterra_gov_finish(pid, false); END IF;
END $fn$;

-- ---------------------------------------------------------------- outcome

CREATE OR REPLACE FUNCTION aquaterra_gov_finish(pid int, passed boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE p aquaterra_gov_proposals; v_outcome text;
BEGIN
  SELECT * INTO p FROM aquaterra_gov_proposals WHERE id = pid FOR UPDATE;
  IF NOT passed THEN
    UPDATE aquaterra_gov_proposals SET status = 'rejected', outcome = 'Rejected', closed_at = now(), stage_ends = NULL WHERE id = pid;
    PERFORM aquaterra_gov_log_add('rejected', pid, format('Rejected: "%s".', p.title));
    RETURN;
  END IF;
  v_outcome := aquaterra_gov_execute(pid);
  UPDATE aquaterra_gov_proposals SET status = 'passed', outcome = v_outcome, closed_at = now(), stage_ends = NULL WHERE id = pid;
  PERFORM aquaterra_gov_log_add('passed', pid, format('Adopted: "%s". %s', p.title, v_outcome));
END $fn$;

-- Puts a passed decision into effect. Returns what happened, in plain words.
CREATE OR REPLACE FUNCTION aquaterra_gov_execute(pid int) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE p aquaterra_gov_proposals; line int; amount bigint; d int; into_d int; e text; days numeric; s int;
BEGIN
  SELECT * INTO p FROM aquaterra_gov_proposals WHERE id = pid;
  CASE p.kind
  WHEN 'resolution', 'charter' THEN
    INSERT INTO aquaterra_gov_laws (proposal_id, kind, title, body) VALUES (pid, p.kind, p.title, p.body);
    RETURN CASE p.kind WHEN 'charter' THEN 'The Tide Charter is amended.' ELSE 'The law is in force.' END;
  WHEN 'strategy' THEN
    UPDATE aquaterra_gov_laws SET in_force = false, ended_at = now() WHERE kind = 'strategy' AND in_force;
    INSERT INTO aquaterra_gov_laws (proposal_id, kind, title, body) VALUES (pid, p.kind, p.title, p.body);
    RETURN 'This is now the Strategic Plan of the Commonwealth.';
  WHEN 'set_param' THEN
    UPDATE aquaterra_gov_params SET value = LEAST(max_value, GREATEST(min_value, (p.payload->>'value')::numeric)), updated_at = now(), proposal_id = pid
      WHERE key = p.payload->>'key';
    INSERT INTO aquaterra_gov_laws (proposal_id, kind, title, body) VALUES (pid, p.kind, p.title, p.body);
    RETURN format('%s is now %s.', (SELECT label FROM aquaterra_gov_params WHERE key = p.payload->>'key'), aquaterra_gov_param(p.payload->>'key'));
  WHEN 'budget' THEN
    amount := (p.payload->>'amount')::bigint;
    INSERT INTO aquaterra_gov_budget (proposal_id, purpose, district_id, allocated)
      VALUES (pid, p.title, NULLIF(p.payload->>'district', '')::int, 0) RETURNING id INTO line;
    INSERT INTO aquaterra_gov_laws (proposal_id, kind, title, body) VALUES (pid, p.kind, p.title, p.body);
    IF to_regprocedure('aquaterra_tide_transfer(text,text,bigint,text,text)') IS NULL THEN
      RETURN format('Budget line %s opened, but the TIDE ledger is not live yet, so nothing was moved.', line);
    END IF;
    BEGIN
      PERFORM aquaterra_gov_pay('state:treasury', 'state:budget:' || line, amount, 'Budget law: ' || p.title, 'gov:budget:' || pid);
      UPDATE aquaterra_gov_budget SET allocated = amount WHERE id = line;
      RETURN format('%s TIDE moved from the State Treasury to budget line %s.', amount, line);
    EXCEPTION WHEN OTHERS THEN
      RETURN format('Budget line %s opened but not funded: the State Treasury could not pay %s TIDE (%s).', line, amount, SQLERRM);
    END;
  WHEN 'building', 'skyscraper', 'new_district' THEN
    INSERT INTO aquaterra_gov_projects (proposal_id, kind, title, payload) VALUES (pid, p.kind, p.title, p.payload);
    RETURN CASE p.kind WHEN 'new_district' THEN 'Approved. The district is queued for the builders of the world map.'
      ELSE 'Building permit issued.' END;
  WHEN 'district_merge' THEN
    d := (p.payload->>'district')::int; into_d := aquaterra_gov_admin((p.payload->>'into')::int);
    UPDATE aquaterra_districts SET merged_into = into_d, mayor_email = NULL, mayor_term_ends = NULL WHERE id = d OR merged_into = d;
    IF COALESCE(p.payload->>'name', '') <> '' THEN UPDATE aquaterra_districts SET admin_name = p.payload->>'name' WHERE id = into_d; END IF;
    RETURN format('%s is now governed together with %s.', (SELECT name FROM aquaterra_districts WHERE id = d), aquaterra_gov_admin_name(into_d));
  WHEN 'district_split' THEN
    d := (p.payload->>'district')::int;
    UPDATE aquaterra_districts SET merged_into = NULL WHERE id = d;
    RETURN format('%s governs itself again and will elect its own Mayor.', (SELECT name FROM aquaterra_districts WHERE id = d));
  WHEN 'appoint_director' THEN
    e := p.payload->>'email';
    days := aquaterra_gov_param('director_term_days');
    UPDATE aquaterra_gov_directorate SET holder_email = e, appointed_at = now(), term_ends = now() + days * interval '1 day' WHERE post = p.payload->>'post';
    RETURN format('%s is %s until %s.', aquaterra_gov_name(e), (SELECT title FROM aquaterra_gov_directorate WHERE post = p.payload->>'post'),
      to_char(now() + days * interval '1 day', 'YYYY-MM-DD'));
  WHEN 'dismiss' THEN
    CASE p.payload->>'office'
    WHEN 'director' THEN UPDATE aquaterra_gov_directorate SET holder_email = NULL, term_ends = NULL WHERE post = p.payload->>'post';
    WHEN 'deputy' THEN UPDATE aquaterra_gov_seats SET holder_email = NULL, term_ends = NULL WHERE id = (p.payload->>'seat')::int;
    WHEN 'mayor' THEN UPDATE aquaterra_districts SET mayor_email = NULL, mayor_term_ends = NULL WHERE id = (p.payload->>'district')::int;
    WHEN 'councillor' THEN
      s := (p.payload->>'seat')::int;
      IF s > 2 THEN DELETE FROM aquaterra_council WHERE seat = s; END IF;
    END CASE;
    RETURN 'The office is vacant. A new holder will be chosen.';
  ELSE RETURN 'Recorded.';
  END CASE;
END $fn$;

-- ---------------------------------------------------------------- elections

CREATE OR REPLACE FUNCTION aquaterra_gov_office_title(payload jsonb) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT CASE payload->>'office'
    WHEN 'deputy' THEN 'Deputy for ' || aquaterra_gov_admin_name((payload->>'district')::int)
    WHEN 'mayor' THEN 'Mayor of ' || aquaterra_gov_admin_name((payload->>'district')::int)
    WHEN 'council' THEN 'Council of First Light' END
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov_open_election(payload jsonb) RETURNS int
LANGUAGE plpgsql AS $fn$
DECLARE pid int; title text;
BEGIN
  title := 'Election: ' || aquaterra_gov_office_title(payload) ||
    CASE WHEN (payload->>'seats')::int > 1 THEN format(' (%s seats)', payload->>'seats') ELSE '' END;
  INSERT INTO aquaterra_gov_proposals (kind, title, body, payload, status, stages)
    VALUES ('election', title, '', payload, 'voting', aquaterra_gov_pipeline('election')) RETURNING id INTO pid;
  PERFORM aquaterra_gov_open_stage(pid, 0);
  PERFORM aquaterra_gov_log_add('election', pid, format('%s is open. Candidates may stand until %s UTC.', title,
    to_char((SELECT stage_ends FROM aquaterra_gov_proposals WHERE id = pid), 'YYYY-MM-DD HH24:MI')));
  RETURN pid;
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov_seat_winner(p aquaterra_gov_proposals, e text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE days numeric; s int;
BEGIN
  IF p.payload->>'office' = 'deputy' THEN
    days := aquaterra_gov_param('deputy_term_days');
    UPDATE aquaterra_gov_seats SET holder_email = e, term_ends = now() + days * interval '1 day' WHERE id = (p.payload->>'seat')::int;
  ELSIF p.payload->>'office' = 'mayor' THEN
    days := aquaterra_gov_param('mayor_term_days');
    UPDATE aquaterra_districts SET mayor_email = e, mayor_term_ends = now() + days * interval '1 day' WHERE id = (p.payload->>'district')::int;
  ELSE
    days := aquaterra_gov_param('council_term_days');
    SELECT g FROM generate_series(3, 11) g
      WHERE NOT EXISTS (SELECT 1 FROM aquaterra_council c WHERE c.seat = g AND c.email IS NOT NULL AND (c.term_ends IS NULL OR c.term_ends > now()))
      ORDER BY g LIMIT 1 INTO s;
    IF s IS NULL THEN RETURN; END IF;
    INSERT INTO aquaterra_council (seat, name, title, kind, email, joined_at, term_ends)
      VALUES (s, aquaterra_gov_name(e), 'Elected Councillor', 'human', e, now(), now() + days * interval '1 day')
      ON CONFLICT (seat) DO UPDATE SET name = EXCLUDED.name, title = EXCLUDED.title, kind = 'human', email = EXCLUDED.email,
        joined_at = EXCLUDED.joined_at, term_ends = EXCLUDED.term_ends;
  END IF;
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov_close_election(pid int) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE p aquaterra_gov_proposals; seats int; c int; w record; names text[] := '{}'; res jsonb;
BEGIN
  SELECT * INTO p FROM aquaterra_gov_proposals WHERE id = pid FOR UPDATE;
  seats := COALESCE((p.payload->>'seats')::int, 1);
  SELECT count(*) INTO c FROM aquaterra_gov_candidates WHERE proposal_id = pid;
  IF p.stage = 0 THEN
    IF c = 0 THEN
      UPDATE aquaterra_gov_proposals SET status = 'closed', outcome = 'No candidates stood. A new election opens soon.', closed_at = now(), stage_ends = NULL WHERE id = pid;
      PERFORM aquaterra_gov_log_add('election', pid, format('%s: no candidates stood.', p.title));
      RETURN;
    ELSIF c <= seats THEN
      FOR w IN SELECT email FROM aquaterra_gov_candidates WHERE proposal_id = pid ORDER BY at LOOP
        PERFORM aquaterra_gov_seat_winner(p, w.email); names := names || aquaterra_gov_name(w.email);
      END LOOP;
      UPDATE aquaterra_gov_proposals SET status = 'passed', outcome = 'Elected unopposed: ' || array_to_string(names, ', ') || '.', closed_at = now(), stage_ends = NULL,
        results = jsonb_build_array(jsonb_build_object('body', 'ballot', 'unopposed', true, 'winners', to_jsonb(names), 'at', now())) WHERE id = pid;
      PERFORM aquaterra_gov_log_add('elected', pid, format('%s: %s elected unopposed.', p.title, array_to_string(names, ', ')));
      RETURN;
    END IF;
    PERFORM aquaterra_gov_open_stage(pid, 1);
    RETURN;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', aquaterra_gov_name(x.email), 'votes', x.votes) ORDER BY x.votes DESC, x.at), '[]'::jsonb) INTO res
    FROM (SELECT ca.email, ca.at, (SELECT count(*) FROM aquaterra_gov_votes v WHERE v.proposal_id = pid AND v.stage = 1 AND v.choice = ca.email
            AND v.voter IN (SELECT voter FROM aquaterra_gov_electorate(pid)))::int AS votes
          FROM aquaterra_gov_candidates ca WHERE ca.proposal_id = pid) x;
  FOR w IN SELECT x.email FROM (SELECT ca.email, ca.at, (SELECT count(*) FROM aquaterra_gov_votes v WHERE v.proposal_id = pid AND v.stage = 1 AND v.choice = ca.email
            AND v.voter IN (SELECT voter FROM aquaterra_gov_electorate(pid))) AS votes
          FROM aquaterra_gov_candidates ca WHERE ca.proposal_id = pid) x WHERE x.votes > 0 ORDER BY x.votes DESC, x.at LIMIT seats LOOP
    PERFORM aquaterra_gov_seat_winner(p, w.email); names := names || aquaterra_gov_name(w.email);
  END LOOP;
  UPDATE aquaterra_gov_proposals SET status = CASE WHEN cardinality(names) > 0 THEN 'passed' ELSE 'closed' END,
    outcome = CASE WHEN cardinality(names) > 0 THEN 'Elected: ' || array_to_string(names, ', ') || '.' ELSE 'Nobody voted. A new election opens soon.' END,
    closed_at = now(), stage_ends = NULL,
    results = jsonb_build_array(jsonb_build_object('body', 'ballot', 'candidates', res, 'winners', to_jsonb(names), 'at', now())) WHERE id = pid;
  PERFORM aquaterra_gov_log_add('elected', pid, CASE WHEN cardinality(names) > 0 THEN format('%s: %s elected.', p.title, array_to_string(names, ', '))
    ELSE format('%s: nobody voted.', p.title) END);
END $fn$;

-- Land tax: every 30 days each owner pays land_tax_pct a year of what their
-- plots cost, pro rata (30/365), to the State Treasury. Owners who cannot pay
-- are skipped and counted. Needs the TIDE ledger (economy thread).
CREATE OR REPLACE FUNCTION aquaterra_gov_collect_land_tax() RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE r record; due bigint; v_total bigint := 0; v_payers int := 0; v_unpaid int := 0; run int;
BEGIN
  IF to_regclass('aquaterra_plot_owners') IS NULL OR to_regprocedure('aquaterra_tide_transfer(text,text,bigint,text,text)') IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM aquaterra_gov_tax_runs WHERE kind = 'land' AND at > now() - interval '30 days') THEN RETURN; END IF;
  INSERT INTO aquaterra_gov_tax_runs (kind) VALUES ('land') RETURNING id INTO run;
  FOR r IN EXECUTE 'SELECT owner, sum(price_paid)::numeric AS value FROM aquaterra_plot_owners WHERE bought_at < now() - interval ''30 days'' GROUP BY owner' LOOP
    due := round(r.value * aquaterra_gov_param('land_tax_pct') / 100 * 30 / 365);
    CONTINUE WHEN due <= 0;
    BEGIN
      PERFORM aquaterra_gov_pay(r.owner, 'state:treasury', due, 'Land tax', 'tax:land:' || run || ':' || md5(r.owner));
      v_total := v_total + due; v_payers := v_payers + 1;
    EXCEPTION WHEN OTHERS THEN v_unpaid := v_unpaid + 1;
    END;
  END LOOP;
  UPDATE aquaterra_gov_tax_runs SET collected = v_total, payers = v_payers, unpaid = v_unpaid WHERE id = run;
  IF v_payers + v_unpaid > 0 THEN
    PERFORM aquaterra_gov_log_add('tax', NULL, format('Land tax collected: %s TIDE from %s owners at %s%% a year.%s', v_total, v_payers,
      aquaterra_gov_param('land_tax_pct'), CASE WHEN v_unpaid > 0 THEN format(' %s owners could not pay.', v_unpaid) ELSE '' END));
  END IF;
END $fn$;

-- ---------------------------------------------------------------- tick

-- Runs every few minutes. districts: the site's /world/districts.json
-- ([{id, name, biome, land, capital}]), or null to skip the sync.
CREATE OR REPLACE FUNCTION aquaterra_gov_tick(districts jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE r record; who text; added int := 0; seats_added int := 0; closed int := 0; elections int := 0; total int; dseats int; lots int; want_lots int; residents int; vacant int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('aquaterra_gov_tick'));

  -- 1. new districts from the map; a district is never removed
  IF districts IS NOT NULL AND jsonb_typeof(districts) = 'array' THEN
    FOR r IN SELECT (x->>'id')::int AS id, x->>'name' AS name, COALESCE(x->>'biome', '') AS biome, COALESCE(x->>'land', '') AS land,
               COALESCE((x->>'capital')::boolean, false) AS capital
             FROM jsonb_array_elements(districts) x
             WHERE (x->>'id') ~ '^\d{1,5}\Z' AND length(COALESCE(x->>'name', '')) BETWEEN 1 AND 80 LOOP
      INSERT INTO aquaterra_districts (id, name, biome, land, capital) VALUES (r.id, r.name, r.biome, r.land, r.capital)
        ON CONFLICT (id) DO NOTHING;
      IF FOUND THEN
        added := added + 1;
        IF (SELECT count(*) FROM aquaterra_districts) > 1 AND EXISTS (SELECT 1 FROM aquaterra_gov_log WHERE kind = 'sync') THEN
          PERFORM aquaterra_gov_log_add('district', NULL, format('New district on the map: %s (%s). Its residents will get a Mayor at %s and an Assembly seat at %s.',
            r.name, r.land, aquaterra_gov_param('mayor_residents'), aquaterra_gov_param('district_seat_residents')));
        END IF;
        UPDATE aquaterra_gov_projects SET status = 'built', built_at = now()
          WHERE kind = 'new_district' AND status = 'approved' AND lower(payload->>'name') = lower(r.name);
      END IF;
    END LOOP;
    IF added > 0 AND NOT EXISTS (SELECT 1 FROM aquaterra_gov_log WHERE kind = 'sync') THEN
      PERFORM aquaterra_gov_log_add('sync', NULL, format('The Commonwealth registered %s districts of the world map.', added));
    END IF;
  END IF;

  -- 1b. every named citizen without a home lives in the capital until they choose
  INSERT INTO aquaterra_residents (email, district_id, chosen)
    SELECT p.email, (SELECT id FROM aquaterra_districts WHERE capital ORDER BY id LIMIT 1), false
      FROM aquaterra_players p
     WHERE p.display_name IS NOT NULL AND EXISTS (SELECT 1 FROM aquaterra_districts WHERE capital)
       AND NOT EXISTS (SELECT 1 FROM aquaterra_residents h WHERE h.email = p.email)
    ON CONFLICT (email) DO NOTHING;

  -- 2. a district seat for every governing district that has enough residents
  FOR r IN SELECT d.id, d.name FROM aquaterra_districts d
           WHERE d.merged_into IS NULL AND aquaterra_gov_residents(d.id) >= aquaterra_gov_param('district_seat_residents')
             AND NOT EXISTS (SELECT 1 FROM aquaterra_gov_seats s WHERE s.kind = 'district' AND s.district_id = d.id) LOOP
    INSERT INTO aquaterra_gov_seats (kind, district_id) VALUES ('district', r.id);
    seats_added := seats_added + 1;
    PERFORM aquaterra_gov_log_add('seat', NULL, format('%s reached %s residents and gains a seat in the Citizens'' Assembly.', aquaterra_gov_admin_name(r.id),
      aquaterra_gov_param('district_seat_residents')));
  END LOOP;
  -- seats of districts merged away end with their term
  DELETE FROM aquaterra_gov_seats s USING aquaterra_districts d
    WHERE s.kind = 'district' AND d.id = s.district_id AND d.merged_into IS NOT NULL AND (s.holder_email IS NULL OR s.term_ends < now());

  -- 3. the Assembly keeps 60% district seats, 20% guild, 20% by lot; at least 51 seats
  SELECT count(*) INTO dseats FROM aquaterra_gov_seats WHERE kind = 'district';
  total := GREATEST(51, ceil(dseats / 0.6))::int;
  want_lots := round(total * 0.2)::int;
  SELECT count(*) INTO lots FROM aquaterra_gov_seats WHERE kind = 'lot';
  SELECT count(*) INTO residents FROM aquaterra_residents;
  want_lots := LEAST(want_lots, floor(residents / aquaterra_gov_param('lot_residents_per_seat'))::int);
  WHILE lots < want_lots LOOP INSERT INTO aquaterra_gov_seats (kind) VALUES ('lot'); lots := lots + 1; END LOOP;
  FOR r IN SELECT id FROM aquaterra_gov_seats WHERE kind = 'lot' AND (holder_email IS NULL OR term_ends < now()) LOOP
    UPDATE aquaterra_gov_seats SET holder_email = (
        SELECT re.email FROM aquaterra_residents re JOIN aquaterra_players pl ON pl.email = re.email
        WHERE pl.display_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aquaterra_gov_seats s2 WHERE s2.holder_email = re.email AND (s2.term_ends IS NULL OR s2.term_ends > now()))
        ORDER BY random() LIMIT 1),
      term_ends = now() + aquaterra_gov_param('deputy_term_days') * interval '1 day'
      WHERE id = r.id RETURNING holder_email INTO who;
    IF who IS NOT NULL THEN
      PERFORM aquaterra_gov_log_add('seat', NULL, format('%s was drawn by lot for a seat in the Citizens'' Assembly.', aquaterra_gov_name(who)));
    ELSE
      UPDATE aquaterra_gov_seats SET term_ends = NULL WHERE kind = 'lot' AND holder_email IS NULL;
    END IF;
  END LOOP;

  -- 4. close stages whose time is up or whose result is already certain
  FOR r IN SELECT id, kind, stage FROM aquaterra_gov_proposals WHERE status = 'voting' ORDER BY id LOOP
    IF (SELECT stage_ends <= now() FROM aquaterra_gov_proposals WHERE id = r.id)
       OR (r.kind <> 'election' AND (aquaterra_gov_tally(r.id, r.stage)->>'decided')::boolean) THEN
      PERFORM aquaterra_gov_close_stage(r.id); closed := closed + 1;
    END IF;
  END LOOP;
  -- petitions that did not gather signatures in time
  FOR r IN SELECT id, title FROM aquaterra_gov_proposals WHERE status = 'signatures' AND stage_ends <= now() LOOP
    UPDATE aquaterra_gov_proposals SET status = 'expired', outcome = 'Not enough signatures in time.', closed_at = now(), stage_ends = NULL WHERE id = r.id;
    PERFORM aquaterra_gov_log_add('expired', r.id, format('"%s" did not gather enough signatures.', r.title));
  END LOOP;
  -- NICS AI never misses a Council vote
  FOR r IN SELECT id FROM aquaterra_gov_proposals WHERE status = 'voting' AND stages->stage->>'body' = 'council' LOOP
    PERFORM aquaterra_gov_nics_vote(r.id);
  END LOOP;

  -- 5. elections for empty or ending offices (one at a time per office, a day apart after a failed one)
  FOR r IN SELECT s.id, s.district_id FROM aquaterra_gov_seats s JOIN aquaterra_districts d ON d.id = s.district_id
           WHERE s.kind = 'district' AND d.merged_into IS NULL AND (s.holder_email IS NULL OR s.term_ends < now() + interval '7 days')
             AND NOT EXISTS (SELECT 1 FROM aquaterra_gov_proposals p WHERE p.kind = 'election' AND p.payload->>'office' = 'deputy'
               AND (p.payload->>'seat')::int = s.id AND (p.status = 'voting' OR p.closed_at > now() - interval '1 day')) LOOP
    PERFORM aquaterra_gov_open_election(jsonb_build_object('office', 'deputy', 'seat', r.id, 'district', r.district_id)); elections := elections + 1;
  END LOOP;
  FOR r IN SELECT d.id FROM aquaterra_districts d
           WHERE d.merged_into IS NULL AND aquaterra_gov_residents(d.id) >= aquaterra_gov_param('mayor_residents')
             AND (d.mayor_email IS NULL OR d.mayor_term_ends < now() + interval '7 days')
             AND NOT EXISTS (SELECT 1 FROM aquaterra_gov_proposals p WHERE p.kind = 'election' AND p.payload->>'office' = 'mayor'
               AND (p.payload->>'district')::int = d.id AND (p.status = 'voting' OR p.closed_at > now() - interval '1 day')) LOOP
    PERFORM aquaterra_gov_open_election(jsonb_build_object('office', 'mayor', 'district', r.id)); elections := elections + 1;
  END LOOP;
  SELECT count(*) INTO vacant FROM generate_series(3, 11) g
    WHERE NOT EXISTS (SELECT 1 FROM aquaterra_council c WHERE c.seat = g AND c.email IS NOT NULL AND (c.term_ends IS NULL OR c.term_ends > now() + interval '7 days'));
  IF vacant > 0 AND residents >= aquaterra_gov_param('council_election_residents')
     AND NOT EXISTS (SELECT 1 FROM aquaterra_gov_proposals p WHERE p.kind = 'election' AND p.payload->>'office' = 'council'
       AND (p.status = 'voting' OR p.closed_at > now() - interval '1 day')) THEN
    PERFORM aquaterra_gov_open_election(jsonb_build_object('office', 'council', 'seats', vacant)); elections := elections + 1;
  END IF;
  -- terms that ended
  DELETE FROM aquaterra_council WHERE seat > 2 AND term_ends < now();
  UPDATE aquaterra_districts SET mayor_email = NULL, mayor_term_ends = NULL WHERE mayor_term_ends < now();
  UPDATE aquaterra_gov_seats SET holder_email = NULL, term_ends = NULL WHERE kind = 'district' AND term_ends < now();
  UPDATE aquaterra_gov_directorate SET holder_email = NULL, term_ends = NULL WHERE term_ends < now();

  PERFORM aquaterra_gov_collect_land_tax();

  RETURN jsonb_build_object('districtsAdded', added, 'seatsAdded', seats_added, 'stagesClosed', closed, 'electionsOpened', elections);
END $fn$;
