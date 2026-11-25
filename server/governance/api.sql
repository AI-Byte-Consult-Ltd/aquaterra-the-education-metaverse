-- AquaTerra Commonwealth: the web API. n8n "[63 PUBLIC] AquaTerra Governance"
-- passes each request body here and returns the result as it is.
-- Public answers carry citizen names only, never emails.

CREATE OR REPLACE FUNCTION aquaterra_gov_err(code text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$ SELECT jsonb_build_object('ok', false, 'error', code) $fn$;

-- A citizen by their exact citizen name. NULL if nobody or more than one has it.
CREATE OR REPLACE FUNCTION aquaterra_gov_find(n text) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT CASE WHEN count(*) = 1 THEN min(email) END FROM aquaterra_players
  WHERE lower(display_name) = lower(btrim(COALESCE(n, '')))
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov_public_payload(p aquaterra_gov_proposals) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT (p.payload - 'email')
    || CASE WHEN p.payload ? 'district' THEN jsonb_build_object('districtName', aquaterra_gov_admin_name((p.payload->>'district')::int)) ELSE '{}'::jsonb END
    || CASE WHEN p.payload ? 'into' THEN jsonb_build_object('intoName', aquaterra_gov_admin_name((p.payload->>'into')::int)) ELSE '{}'::jsonb END
    || CASE WHEN p.payload ? 'key' THEN jsonb_build_object('label', (SELECT label FROM aquaterra_gov_params WHERE key = p.payload->>'key'),
         'current', aquaterra_gov_param(p.payload->>'key')) ELSE '{}'::jsonb END
$fn$;

-- One proposal as the site shows it. me: the viewer's email or NULL. full: add roll call and candidates.
CREATE OR REPLACE FUNCTION aquaterra_gov_proposal_json(pid int, me text, with_detail boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE p aquaterra_gov_proposals; j jsonb; cur text; mine text; elig boolean := false; sigs int; roll jsonb; cands jsonb;
BEGIN
  SELECT * INTO p FROM aquaterra_gov_proposals WHERE id = pid;
  IF p.id IS NULL THEN RETURN NULL; END IF;
  cur := CASE WHEN p.status = 'voting' THEN p.stages->p.stage->>'body' END;
  IF me IS NOT NULL AND cur IS NOT NULL AND cur <> 'nomination' THEN
    elig := EXISTS (SELECT 1 FROM aquaterra_gov_electorate(pid) WHERE voter = me);
    SELECT choice INTO mine FROM aquaterra_gov_votes WHERE proposal_id = pid AND stage = p.stage AND voter = me;
  END IF;
  SELECT count(*) INTO sigs FROM aquaterra_gov_signatures WHERE proposal_id = pid;
  j := jsonb_build_object(
    'id', p.id, 'kind', p.kind, 'title', p.title, 'body', p.body, 'payload', aquaterra_gov_public_payload(p),
    'author', CASE WHEN p.author_email IS NULL THEN NULL ELSE aquaterra_gov_name(p.author_email) END,
    'status', p.status, 'stage', p.stage, 'stages', p.stages, 'stageBody', cur, 'stageEnds', p.stage_ends,
    'results', p.results, 'outcome', p.outcome, 'createdAt', p.created_at, 'closedAt', p.closed_at,
    'tally', CASE WHEN cur IS NOT NULL AND cur NOT IN ('nomination', 'ballot') THEN aquaterra_gov_tally(pid, p.stage) END,
    'signatures', CASE WHEN p.status = 'signatures' THEN jsonb_build_object('count', sigs, 'needed', aquaterra_gov_signatures_needed()) END,
    'candidates', CASE WHEN p.kind = 'election' THEN (SELECT count(*) FROM aquaterra_gov_candidates WHERE proposal_id = pid) END,
    'me', CASE WHEN me IS NULL THEN NULL ELSE jsonb_build_object(
      'canVote', elig, 'vote', CASE WHEN p.kind = 'election' AND mine IS NOT NULL THEN
          (SELECT n FROM (SELECT email, row_number() OVER (ORDER BY at) AS n FROM aquaterra_gov_candidates WHERE proposal_id = pid) c WHERE c.email = mine)::text
        ELSE mine END,
      'signed', EXISTS (SELECT 1 FROM aquaterra_gov_signatures WHERE proposal_id = pid AND email = me),
      'canSign', p.status = 'signatures' AND EXISTS (SELECT 1 FROM aquaterra_residents WHERE email = me),
      'stood', EXISTS (SELECT 1 FROM aquaterra_gov_candidates WHERE proposal_id = pid AND email = me),
      'isAuthor', p.author_email = me) END);
  IF with_detail THEN
    -- Council and Assembly votes are public (roll call); district votes, referendums and ballots are secret.
    SELECT COALESCE(jsonb_agg(jsonb_build_object('stage', v.stage, 'name', aquaterra_gov_name(v.voter), 'ai', v.voter = 'nics-ai',
        'choice', v.choice, 'reason', v.reason, 'at', v.at) ORDER BY v.stage, v.at), '[]'::jsonb) INTO roll
      FROM aquaterra_gov_votes v WHERE v.proposal_id = pid AND p.kind <> 'election' AND p.stages->v.stage->>'body' IN ('council', 'assembly');
    SELECT COALESCE(jsonb_agg(jsonb_build_object('n', c.n, 'name', aquaterra_gov_name(c.email), 'statement', c.statement,
        'votes', CASE WHEN p.status <> 'voting' THEN (SELECT count(*) FROM aquaterra_gov_votes v WHERE v.proposal_id = pid AND v.stage = 1 AND v.choice = c.email) END)
        ORDER BY c.n), '[]'::jsonb) INTO cands
      FROM (SELECT email, statement, row_number() OVER (ORDER BY at) AS n FROM aquaterra_gov_candidates WHERE proposal_id = pid) c;
    j := j || jsonb_build_object('rollCall', roll, 'candidateList', cands);
  END IF;
  RETURN j;
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov_state() RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE dseats int; total int; filled int;
BEGIN
  SELECT count(*) INTO dseats FROM aquaterra_gov_seats WHERE kind = 'district';
  total := GREATEST(51, ceil(dseats / 0.6))::int;
  SELECT count(*) INTO filled FROM aquaterra_gov_council_voters();
  RETURN jsonb_build_object('ok', true,
    'citizens', (SELECT count(*) FROM aquaterra_players),
    'residents', (SELECT count(*) FROM aquaterra_residents),
    'districts', (SELECT count(*) FROM aquaterra_districts WHERE merged_into IS NULL),
    'council', jsonb_build_object('seats', 11, 'filled', filled, 'need', GREATEST(1, ceil(filled * 7 / 11.0))::int,
      'members', COALESCE((SELECT jsonb_agg(jsonb_build_object('seat', c.seat, 'name', COALESCE(pl.display_name, c.name), 'title', c.title, 'kind', c.kind,
         'joinedAt', c.joined_at, 'termEnds', c.term_ends) ORDER BY c.seat)
        FROM aquaterra_council c LEFT JOIN aquaterra_players pl ON pl.email = c.email
        WHERE c.kind = 'ai' OR (c.email IS NOT NULL AND (c.term_ends IS NULL OR c.term_ends > now()))), '[]'::jsonb)),
    'assembly', jsonb_build_object('total', total, 'districtSeats', total - 2 * round(total * 0.2)::int, 'districtSeatsOpen', dseats,
      'guildSeats', round(total * 0.2)::int, 'lotSeats', round(total * 0.2)::int, 'lotDrawn', (SELECT count(*) FROM aquaterra_gov_seats WHERE kind = 'lot' AND holder_email IS NOT NULL),
      'seated', aquaterra_gov_deputies(), 'founding', aquaterra_gov_founding(), 'foundingUntil', aquaterra_gov_param('founding_deputies'),
      'members', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', aquaterra_gov_name(s.holder_email), 'kind', s.kind,
         'district', CASE WHEN s.district_id IS NOT NULL THEN aquaterra_gov_admin_name(s.district_id) END, 'termEnds', s.term_ends) ORDER BY s.kind, s.id)
        FROM aquaterra_gov_seats s WHERE s.holder_email IS NOT NULL), '[]'::jsonb)),
    'directorate', (SELECT jsonb_agg(jsonb_build_object('post', d.post, 'title', d.title,
        'holder', CASE WHEN d.holder_email IS NOT NULL AND d.term_ends > now() THEN aquaterra_gov_name(d.holder_email) END, 'termEnds', d.term_ends)
        ORDER BY array_position(ARRAY['president', 'treasury', 'works', 'civic'], d.post)) FROM aquaterra_gov_directorate d),
    'mayors', (SELECT count(*) FROM aquaterra_districts WHERE merged_into IS NULL AND mayor_email IS NOT NULL AND mayor_term_ends > now()),
    'treasury', aquaterra_gov_treasury(),
    'ledgerLive', to_regprocedure('aquaterra_tide_transfer(text,text,bigint,text,text)') IS NOT NULL,
    'signaturesNeeded', aquaterra_gov_signatures_needed(),
    'open', (SELECT count(*) FROM aquaterra_gov_proposals WHERE status IN ('voting', 'signatures')),
    'params', (SELECT jsonb_agg(jsonb_build_object('key', key, 'value', value, 'min', min_value, 'max', max_value, 'label', label, 'updatedAt', updated_at) ORDER BY key)
      FROM aquaterra_gov_params));
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov_me(me text) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('ok', true,
    'name', (SELECT display_name FROM aquaterra_players WHERE email = me),
    'home', (SELECT jsonb_build_object('district', r.district_id, 'name', d.name, 'governedBy', aquaterra_gov_admin_name(d.id), 'since', r.since, 'chosen', r.chosen,
        'canMoveAt', CASE WHEN r.chosen THEN r.since + aquaterra_gov_param('residence_change_days') * interval '1 day' END)
      FROM aquaterra_residents r JOIN aquaterra_districts d ON d.id = r.district_id WHERE r.email = me),
    'offices', COALESCE((SELECT jsonb_agg(o) FROM (
        SELECT jsonb_build_object('office', 'council', 'title', title, 'seat', seat, 'termEnds', term_ends) AS o FROM aquaterra_council
          WHERE email = me AND (term_ends IS NULL OR term_ends > now())
        UNION ALL SELECT jsonb_build_object('office', 'deputy', 'seat', id, 'kind', kind,
            'title', CASE WHEN district_id IS NOT NULL THEN 'Deputy for ' || aquaterra_gov_admin_name(district_id) ELSE 'Deputy (drawn by lot)' END, 'termEnds', term_ends)
          FROM aquaterra_gov_seats WHERE holder_email = me AND (term_ends IS NULL OR term_ends > now())
        UNION ALL SELECT jsonb_build_object('office', 'mayor', 'title', 'Mayor of ' || aquaterra_gov_admin_name(id), 'district', id, 'termEnds', mayor_term_ends)
          FROM aquaterra_districts WHERE mayor_email = me AND mayor_term_ends > now()
        UNION ALL SELECT jsonb_build_object('office', 'director', 'title', title, 'post', post, 'termEnds', term_ends)
          FROM aquaterra_gov_directorate WHERE holder_email = me AND term_ends > now()) x), '[]'::jsonb),
    'acting', COALESCE((SELECT jsonb_agg(post) FROM aquaterra_gov_directorate d WHERE aquaterra_gov_can_act(me, d.post)), '[]'::jsonb),
    'official', aquaterra_gov_official(me),
    'toVote', (SELECT count(*) FROM aquaterra_gov_proposals p WHERE p.status = 'voting' AND p.stages->p.stage->>'body' <> 'nomination'
        AND EXISTS (SELECT 1 FROM aquaterra_gov_electorate(p.id) WHERE voter = me)
        AND NOT EXISTS (SELECT 1 FROM aquaterra_gov_votes v WHERE v.proposal_id = p.id AND v.stage = p.stage AND v.voter = me)))
$fn$;

-- Checks a new proposal. Returns NULL when fine, else an error code; fills payload.
CREATE OR REPLACE FUNCTION aquaterra_gov_check(kind text, title text, body text, INOUT payload jsonb, OUT err text)
LANGUAGE plpgsql AS $fn$
DECLARE prm aquaterra_gov_params; v numeric; f int; d int; e text;
BEGIN
  err := NULL;
  IF kind IS NULL OR kind = 'election' OR aquaterra_gov_pipeline(kind) IS NULL THEN err := 'kind'; RETURN; END IF;
  IF length(btrim(COALESCE(title, ''))) NOT BETWEEN 5 AND 120 THEN err := 'title'; RETURN; END IF;
  IF length(COALESCE(body, '')) > 4000 THEN err := 'body'; RETURN; END IF;
  IF kind IN ('resolution', 'strategy', 'charter') AND length(btrim(COALESCE(body, ''))) < 20 THEN err := 'body'; RETURN; END IF;
  IF payload ? 'district' THEN
    IF NOT (payload->>'district') ~ '^\d{1,5}\Z' OR NOT EXISTS (SELECT 1 FROM aquaterra_districts WHERE id = (payload->>'district')::int) THEN err := 'district'; RETURN; END IF;
  END IF;
  CASE kind
  WHEN 'set_param' THEN
    SELECT * INTO prm FROM aquaterra_gov_params WHERE key = payload->>'key';
    IF prm.key IS NULL OR NOT (payload->>'value') ~ '^-?\d+(\.\d+)?\Z' THEN err := 'param'; RETURN; END IF;
    v := (payload->>'value')::numeric;
    IF v < prm.min_value OR v > prm.max_value OR v = prm.value THEN err := 'param'; RETURN; END IF;
    payload := jsonb_build_object('key', prm.key, 'value', v);
  WHEN 'budget' THEN
    IF NOT COALESCE(payload->>'amount', '') ~ '^\d{1,10}\Z' OR (payload->>'amount')::bigint < 1 THEN err := 'amount'; RETURN; END IF;
    payload := jsonb_build_object('amount', (payload->>'amount')::bigint) || CASE WHEN payload ? 'district' THEN jsonb_build_object('district', (payload->>'district')::int) ELSE '{}'::jsonb END;
  WHEN 'building', 'skyscraper' THEN
    IF NOT payload ? 'district' THEN err := 'district'; RETURN; END IF;
    IF length(btrim(COALESCE(payload->>'address', ''))) NOT BETWEEN 3 AND 80 THEN err := 'address'; RETURN; END IF;
    IF NOT COALESCE(payload->>'floors', '') ~ '^\d{1,4}\Z' THEN err := 'floors'; RETURN; END IF;
    f := (payload->>'floors')::int;
    IF kind = 'building' AND (f <= aquaterra_gov_param('permit_free_floors') OR f >= aquaterra_gov_param('skyscraper_floors')) THEN err := 'floors'; RETURN; END IF;
    IF kind = 'skyscraper' AND (f < aquaterra_gov_param('skyscraper_floors') OR f > 1200) THEN err := 'floors'; RETURN; END IF;
    payload := jsonb_build_object('district', (payload->>'district')::int, 'address', btrim(payload->>'address'), 'floors', f);
  WHEN 'new_district' THEN
    IF NOT COALESCE(payload->>'name', '') ~ '^[A-Za-z][A-Za-z '' -]{1,38}[A-Za-z]\Z' THEN err := 'name'; RETURN; END IF;
    IF EXISTS (SELECT 1 FROM aquaterra_districts WHERE lower(name) = lower(payload->>'name')) THEN err := 'name'; RETURN; END IF;
    payload := jsonb_build_object('name', btrim(payload->>'name'), 'land', left(btrim(COALESCE(payload->>'land', '')), 60), 'climate', left(btrim(COALESCE(payload->>'climate', '')), 40));
  WHEN 'district_merge' THEN
    IF NOT payload ? 'district' OR NOT COALESCE(payload->>'into', '') ~ '^\d{1,5}\Z' THEN err := 'district'; RETURN; END IF;
    d := (payload->>'district')::int;
    IF NOT EXISTS (SELECT 1 FROM aquaterra_districts WHERE id = d AND merged_into IS NULL)
       OR NOT EXISTS (SELECT 1 FROM aquaterra_districts WHERE id = (payload->>'into')::int AND merged_into IS NULL)
       OR d = (payload->>'into')::int THEN err := 'district'; RETURN; END IF;
    payload := jsonb_build_object('district', d, 'into', (payload->>'into')::int, 'districts', jsonb_build_array(d, (payload->>'into')::int),
      'name', left(btrim(COALESCE(payload->>'name', '')), 40));
  WHEN 'district_split' THEN
    IF NOT payload ? 'district' OR NOT EXISTS (SELECT 1 FROM aquaterra_districts WHERE id = (payload->>'district')::int AND merged_into IS NOT NULL) THEN err := 'district'; RETURN; END IF;
    d := (payload->>'district')::int;
    payload := jsonb_build_object('district', d, 'into', (SELECT merged_into FROM aquaterra_districts WHERE id = d), 'districts', jsonb_build_array(aquaterra_gov_admin(d)));
  WHEN 'appoint_director' THEN
    IF NOT EXISTS (SELECT 1 FROM aquaterra_gov_directorate WHERE post = payload->>'post') THEN err := 'post'; RETURN; END IF;
    e := aquaterra_gov_find(payload->>'name');
    IF e IS NULL OR NOT EXISTS (SELECT 1 FROM aquaterra_residents WHERE email = e) THEN err := 'citizen'; RETURN; END IF;
    payload := jsonb_build_object('post', payload->>'post', 'email', e, 'name', aquaterra_gov_name(e));
  WHEN 'dismiss' THEN
    IF payload->>'office' = 'director' THEN
      IF NOT EXISTS (SELECT 1 FROM aquaterra_gov_directorate WHERE post = payload->>'post' AND holder_email IS NOT NULL AND term_ends > now()) THEN err := 'office'; RETURN; END IF;
      payload := jsonb_build_object('office', 'director', 'post', payload->>'post', 'name', aquaterra_gov_name((SELECT holder_email FROM aquaterra_gov_directorate WHERE post = payload->>'post')));
    ELSIF payload->>'office' = 'mayor' THEN
      IF NOT payload ? 'district' OR NOT EXISTS (SELECT 1 FROM aquaterra_districts WHERE id = (payload->>'district')::int AND mayor_email IS NOT NULL) THEN err := 'office'; RETURN; END IF;
      payload := jsonb_build_object('office', 'mayor', 'district', (payload->>'district')::int,
        'name', aquaterra_gov_name((SELECT mayor_email FROM aquaterra_districts WHERE id = (payload->>'district')::int)));
    ELSIF payload->>'office' = 'councillor' THEN
      IF NOT COALESCE(payload->>'seat', '') ~ '^\d{1,2}\Z' OR (payload->>'seat')::int < 4
         OR NOT EXISTS (SELECT 1 FROM aquaterra_council WHERE seat = (payload->>'seat')::int AND email IS NOT NULL) THEN err := 'office'; RETURN; END IF;
      payload := jsonb_build_object('office', 'councillor', 'seat', (payload->>'seat')::int,
        'name', aquaterra_gov_name((SELECT email FROM aquaterra_council WHERE seat = (payload->>'seat')::int)));
    ELSIF payload->>'office' = 'deputy' THEN
      IF NOT COALESCE(payload->>'seat', '') ~ '^\d{1,6}\Z'
         OR NOT EXISTS (SELECT 1 FROM aquaterra_gov_seats WHERE id = (payload->>'seat')::int AND holder_email IS NOT NULL) THEN err := 'office'; RETURN; END IF;
      payload := jsonb_build_object('office', 'deputy', 'seat', (payload->>'seat')::int,
        'name', aquaterra_gov_name((SELECT holder_email FROM aquaterra_gov_seats WHERE id = (payload->>'seat')::int)));
    ELSE err := 'office'; RETURN;
    END IF;
  ELSE
    payload := '{}'::jsonb;
  END CASE;
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_gov(req jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  act text := req->>'action';
  me text;
  p aquaterra_gov_proposals;
  pid int; n int; payload jsonb; err text; t jsonb; e text; line aquaterra_gov_budget; amount bigint; d int;
BEGIN
  IF req ? 'session' THEN me := aquaterra_gov_session(req->>'session'); END IF;

  -- public reading
  IF act = 'state' THEN RETURN aquaterra_gov_state(); END IF;
  IF act = 'districts' THEN
    RETURN jsonb_build_object('ok', true, 'seatAt', aquaterra_gov_param('district_seat_residents'), 'mayorAt', aquaterra_gov_param('mayor_residents'),
      'districts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'land', d.land, 'biome', d.biome, 'capital', d.capital,
        'governedBy', CASE WHEN d.merged_into IS NOT NULL THEN aquaterra_gov_admin_name(d.id) END,
        'adminName', d.admin_name,
        'residents', (SELECT count(*) FROM aquaterra_residents r WHERE r.district_id = d.id),
        'totalResidents', CASE WHEN d.merged_into IS NULL THEN aquaterra_gov_residents(d.id) END,
        'mayor', CASE WHEN d.mayor_email IS NOT NULL AND d.mayor_term_ends > now() THEN aquaterra_gov_name(d.mayor_email) END,
        'seat', (SELECT jsonb_build_object('id', s.id, 'holder', CASE WHEN s.holder_email IS NOT NULL THEN aquaterra_gov_name(s.holder_email) END, 'termEnds', s.term_ends)
          FROM aquaterra_gov_seats s WHERE s.kind = 'district' AND s.district_id = d.id)) ORDER BY d.id) FROM aquaterra_districts d), '[]'::jsonb));
  END IF;
  IF act = 'proposals' THEN
    RETURN jsonb_build_object('ok', true, 'proposals', COALESCE((SELECT jsonb_agg(aquaterra_gov_proposal_json(x.id, me, true) ORDER BY x.ord, x.id DESC) FROM (
      SELECT id, CASE WHEN status IN ('voting', 'signatures') THEN 0 ELSE 1 END AS ord FROM aquaterra_gov_proposals
      WHERE CASE COALESCE(req->>'filter', 'open')
        WHEN 'open' THEN status IN ('voting', 'signatures')
        WHEN 'closed' THEN status NOT IN ('voting', 'signatures')
        WHEN 'mine' THEN author_email = me
        WHEN 'elections' THEN kind = 'election'
        WHEN 'all' THEN true
        ELSE status = 'voting' AND stages->stage->>'body' = req->>'filter' END
      ORDER BY CASE WHEN status IN ('voting', 'signatures') THEN 0 ELSE 1 END, id DESC LIMIT 100) x), '[]'::jsonb));
  END IF;
  IF act = 'proposal' THEN
    IF NOT COALESCE(req->>'id', '') ~ '^\d{1,9}\Z' THEN RETURN aquaterra_gov_err('not_found'); END IF;
    t := aquaterra_gov_proposal_json((req->>'id')::int, me, true);
    RETURN CASE WHEN t IS NULL THEN aquaterra_gov_err('not_found') ELSE jsonb_build_object('ok', true, 'proposal', t) END;
  END IF;
  IF act = 'log' THEN
    RETURN jsonb_build_object('ok', true, 'entries', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'at', at, 'kind', kind, 'proposal', proposal_id, 'text', text) ORDER BY id DESC)
      FROM (SELECT * FROM aquaterra_gov_log WHERE (req->>'before') IS NULL OR id < (NULLIF(regexp_replace(req->>'before', '\D', '', 'g'), ''))::bigint
            ORDER BY id DESC LIMIT 100) l), '[]'::jsonb));
  END IF;
  IF act = 'laws' THEN
    RETURN jsonb_build_object('ok', true,
      'laws', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'proposal', proposal_id, 'kind', kind, 'title', title, 'body', body,
        'inForce', in_force, 'enactedAt', enacted_at, 'endedAt', ended_at) ORDER BY id DESC) FROM aquaterra_gov_laws), '[]'::jsonb),
      'projects', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pr.id, 'proposal', pr.proposal_id, 'kind', pr.kind, 'title', pr.title, 'status', pr.status,
        'district', CASE WHEN pr.payload ? 'district' THEN aquaterra_gov_admin_name((pr.payload->>'district')::int) END,
        'floors', pr.payload->'floors', 'address', pr.payload->'address', 'approvedAt', pr.approved_at, 'builtAt', pr.built_at) ORDER BY pr.id DESC) FROM aquaterra_gov_projects pr), '[]'::jsonb),
      'budget', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'proposal', b.proposal_id, 'purpose', b.purpose, 'allocated', b.allocated, 'spent', b.spent,
        'district', CASE WHEN b.district_id IS NOT NULL THEN aquaterra_gov_admin_name(b.district_id) END, 'createdAt', b.created_at) ORDER BY b.id DESC) FROM aquaterra_gov_budget b), '[]'::jsonb),
      'treasury', aquaterra_gov_treasury(),
      'taxes', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', kind, 'at', at, 'collected', collected, 'payers', payers) ORDER BY id DESC)
        FROM (SELECT * FROM aquaterra_gov_tax_runs ORDER BY id DESC LIMIT 12) tr), '[]'::jsonb));
  END IF;

  -- everything below needs a citizen
  IF me IS NULL THEN RETURN aquaterra_gov_err('session'); END IF;

  IF act = 'me' THEN RETURN aquaterra_gov_me(me); END IF;

  IF act = 'set_residence' THEN
    -- skip: the citizen did not choose at sign-up and lives in the capital until they do
    IF COALESCE((req->>'skip')::boolean, false) THEN
      INSERT INTO aquaterra_residents (email, district_id, chosen)
        SELECT me, id, false FROM aquaterra_districts WHERE capital ORDER BY id LIMIT 1
        ON CONFLICT (email) DO NOTHING;
      RETURN aquaterra_gov_me(me);
    END IF;
    IF NOT COALESCE(req->>'district', '') ~ '^\d{1,5}\Z' OR NOT EXISTS (SELECT 1 FROM aquaterra_districts WHERE id = (req->>'district')::int) THEN
      RETURN aquaterra_gov_err('district'); END IF;
    IF EXISTS (SELECT 1 FROM aquaterra_residents WHERE email = me AND chosen AND since > now() - aquaterra_gov_param('residence_change_days') * interval '1 day')
       AND NOT EXISTS (SELECT 1 FROM aquaterra_players WHERE email = me AND role = 'founder') THEN
      RETURN aquaterra_gov_err('cooldown'); END IF;
    IF EXISTS (SELECT 1 FROM aquaterra_districts WHERE mayor_email = me AND mayor_term_ends > now())
       OR EXISTS (SELECT 1 FROM aquaterra_gov_seats WHERE holder_email = me AND kind = 'district' AND term_ends > now()) THEN
      RETURN aquaterra_gov_err('office'); END IF;
    INSERT INTO aquaterra_residents (email, district_id, chosen) VALUES (me, (req->>'district')::int, true)
      ON CONFLICT (email) DO UPDATE SET district_id = EXCLUDED.district_id, since = now(), chosen = true;
    RETURN aquaterra_gov_me(me);
  END IF;

  IF act = 'propose' THEN
    IF (SELECT display_name FROM aquaterra_players WHERE email = me) IS NULL THEN RETURN aquaterra_gov_err('no_name'); END IF;
    IF NOT EXISTS (SELECT 1 FROM aquaterra_residents WHERE email = me) THEN RETURN aquaterra_gov_err('no_home'); END IF;
    IF (SELECT count(*) FROM aquaterra_gov_proposals WHERE author_email = me AND status IN ('voting', 'signatures')) >= aquaterra_gov_param('max_open_proposals')
       AND NOT EXISTS (SELECT 1 FROM aquaterra_players WHERE email = me AND role = 'founder') THEN RETURN aquaterra_gov_err('too_many'); END IF;
    SELECT c.payload, c.err INTO payload, err FROM aquaterra_gov_check(req->>'kind', req->>'title', req->>'body', COALESCE(req->'payload', '{}'::jsonb)) c;
    IF err IS NOT NULL THEN RETURN aquaterra_gov_err(err); END IF;
    INSERT INTO aquaterra_gov_proposals (kind, title, body, payload, author_email, status, stages, stage_ends)
      VALUES (req->>'kind', btrim(req->>'title'), btrim(COALESCE(req->>'body', '')), payload, me, 'signatures', aquaterra_gov_pipeline(req->>'kind'),
        now() + aquaterra_gov_param('signature_days') * interval '1 day')
      RETURNING id INTO pid;
    INSERT INTO aquaterra_gov_signatures (proposal_id, email) VALUES (pid, me);
    IF aquaterra_gov_official(me) OR aquaterra_gov_signatures_needed() <= 1 THEN
      PERFORM aquaterra_gov_log_add('proposed', pid, format('%s proposed "%s".', aquaterra_gov_name(me), btrim(req->>'title')));
      PERFORM aquaterra_gov_open_stage(pid, 0);
    ELSE
      PERFORM aquaterra_gov_log_add('proposed', pid, format('%s started a citizens'' petition: "%s". It needs %s signatures.', aquaterra_gov_name(me),
        btrim(req->>'title'), aquaterra_gov_signatures_needed()));
    END IF;
    RETURN jsonb_build_object('ok', true, 'proposal', aquaterra_gov_proposal_json(pid, me, true));
  END IF;

  -- actions on one proposal
  IF act IN ('sign', 'withdraw', 'vote', 'stand') THEN
    IF NOT COALESCE(req->>'id', '') ~ '^\d{1,9}\Z' THEN RETURN aquaterra_gov_err('not_found'); END IF;
    SELECT * INTO p FROM aquaterra_gov_proposals WHERE id = (req->>'id')::int FOR UPDATE;
    IF p.id IS NULL THEN RETURN aquaterra_gov_err('not_found'); END IF;

    IF act = 'sign' THEN
      IF p.status <> 'signatures' THEN RETURN aquaterra_gov_err('closed'); END IF;
      IF NOT EXISTS (SELECT 1 FROM aquaterra_residents WHERE email = me) THEN RETURN aquaterra_gov_err('no_home'); END IF;
      INSERT INTO aquaterra_gov_signatures (proposal_id, email) VALUES (p.id, me) ON CONFLICT DO NOTHING;
      SELECT count(*) INTO n FROM aquaterra_gov_signatures WHERE proposal_id = p.id;
      IF n >= aquaterra_gov_signatures_needed() THEN
        PERFORM aquaterra_gov_log_add('proposed', p.id, format('"%s" gathered %s signatures and goes to a vote.', p.title, n));
        PERFORM aquaterra_gov_open_stage(p.id, 0);
      END IF;
    ELSIF act = 'withdraw' THEN
      IF p.author_email <> me THEN RETURN aquaterra_gov_err('forbidden'); END IF;
      IF p.status <> 'signatures' AND NOT (p.status = 'voting' AND p.stage = 0
          AND NOT EXISTS (SELECT 1 FROM aquaterra_gov_votes WHERE proposal_id = p.id AND voter <> 'nics-ai')) THEN RETURN aquaterra_gov_err('closed'); END IF;
      UPDATE aquaterra_gov_proposals SET status = 'withdrawn', outcome = 'Withdrawn by the author.', closed_at = now(), stage_ends = NULL WHERE id = p.id;
      PERFORM aquaterra_gov_log_add('withdrawn', p.id, format('"%s" was withdrawn by its author.', p.title));
    ELSIF act = 'stand' THEN
      IF p.kind <> 'election' OR p.status <> 'voting' OR p.stage <> 0 THEN RETURN aquaterra_gov_err('closed'); END IF;
      IF (SELECT display_name FROM aquaterra_players WHERE email = me) IS NULL THEN RETURN aquaterra_gov_err('no_name'); END IF;
      IF p.payload->>'office' IN ('deputy', 'mayor') AND NOT EXISTS (SELECT 1 FROM aquaterra_gov_district_voters(aquaterra_gov_scope(p.payload)) WHERE voter = me) THEN
        RETURN aquaterra_gov_err('not_eligible'); END IF;
      IF p.payload->>'office' = 'council' AND (NOT EXISTS (SELECT 1 FROM aquaterra_residents WHERE email = me)
          OR EXISTS (SELECT 1 FROM aquaterra_council WHERE email = me AND (term_ends IS NULL OR term_ends > now() + interval '7 days'))) THEN
        RETURN aquaterra_gov_err('not_eligible'); END IF;
      IF p.payload->>'office' = 'deputy' AND EXISTS (SELECT 1 FROM aquaterra_gov_seats WHERE holder_email = me AND id <> (p.payload->>'seat')::int AND term_ends > now()) THEN
        RETURN aquaterra_gov_err('not_eligible'); END IF;
      INSERT INTO aquaterra_gov_candidates (proposal_id, email, statement) VALUES (p.id, me, left(btrim(COALESCE(req->>'statement', '')), 280))
        ON CONFLICT (proposal_id, email) DO UPDATE SET statement = EXCLUDED.statement;
      PERFORM aquaterra_gov_log_add('candidate', p.id, format('%s stands as a candidate. %s.', aquaterra_gov_name(me), p.title));
    ELSIF act = 'vote' THEN
      IF p.status <> 'voting' OR p.stages->p.stage->>'body' = 'nomination' THEN RETURN aquaterra_gov_err('closed'); END IF;
      IF NOT EXISTS (SELECT 1 FROM aquaterra_gov_electorate(p.id) WHERE voter = me) THEN RETURN aquaterra_gov_err('not_eligible'); END IF;
      IF p.kind = 'election' THEN
        SELECT c.email INTO e FROM (SELECT email, row_number() OVER (ORDER BY at) AS n FROM aquaterra_gov_candidates WHERE proposal_id = p.id) c
          WHERE c.n::text = req->>'choice';
        IF e IS NULL THEN RETURN aquaterra_gov_err('choice'); END IF;
      ELSE
        IF COALESCE(req->>'choice', '') NOT IN ('yes', 'no', 'abstain') THEN RETURN aquaterra_gov_err('choice'); END IF;
        e := req->>'choice';
      END IF;
      INSERT INTO aquaterra_gov_votes (proposal_id, stage, voter, choice, reason)
        VALUES (p.id, p.stage, me, e, NULLIF(left(btrim(COALESCE(req->>'reason', '')), 280), ''))
        ON CONFLICT (proposal_id, stage, voter) DO UPDATE SET choice = EXCLUDED.choice, reason = EXCLUDED.reason, at = now();
      -- a stage whose result is already certain closes at once
      IF p.kind <> 'election' AND (aquaterra_gov_tally(p.id, p.stage)->>'decided')::boolean THEN PERFORM aquaterra_gov_close_stage(p.id); END IF;
    END IF;
    RETURN jsonb_build_object('ok', true, 'proposal', aquaterra_gov_proposal_json(p.id, me, true));
  END IF;

  -- the Directorate at work
  IF act = 'disburse' THEN
    IF NOT aquaterra_gov_can_act(me, 'treasury') THEN RETURN aquaterra_gov_err('forbidden'); END IF;
    IF NOT COALESCE(req->>'line', '') ~ '^\d{1,9}\Z' OR NOT COALESCE(req->>'amount', '') ~ '^\d{1,10}\Z' THEN RETURN aquaterra_gov_err('amount'); END IF;
    SELECT * INTO line FROM aquaterra_gov_budget WHERE id = (req->>'line')::int FOR UPDATE;
    amount := (req->>'amount')::bigint;
    IF line.id IS NULL THEN RETURN aquaterra_gov_err('not_found'); END IF;
    IF amount < 1 OR amount > line.allocated - line.spent THEN RETURN aquaterra_gov_err('funds'); END IF;
    e := aquaterra_gov_find(req->>'to');
    IF e IS NULL THEN RETURN aquaterra_gov_err('citizen'); END IF;
    IF to_regprocedure('aquaterra_tide_transfer(text,text,bigint,text,text)') IS NULL THEN RETURN aquaterra_gov_err('ledger'); END IF;
    BEGIN
      PERFORM aquaterra_gov_pay('state:budget:' || line.id, e, amount, left('State payment: ' || line.purpose || COALESCE(' - ' || NULLIF(btrim(req->>'memo'), ''), ''), 200), 'gov:pay:' || line.id || ':' || md5(e || now()::text));
    EXCEPTION WHEN OTHERS THEN RETURN aquaterra_gov_err('funds');
    END;
    UPDATE aquaterra_gov_budget SET spent = spent + amount WHERE id = line.id;
    PERFORM aquaterra_gov_log_add('payment', line.proposal_id, format('The Treasury paid %s TIDE to %s from budget line %s "%s".%s', amount, aquaterra_gov_name(e), line.id, line.purpose,
      COALESCE(' ' || NULLIF(left(btrim(req->>'memo'), 120), ''), '')));
    RETURN jsonb_build_object('ok', true);
  END IF;
  IF act = 'mark_built' THEN
    IF NOT aquaterra_gov_can_act(me, 'works') THEN RETURN aquaterra_gov_err('forbidden'); END IF;
    UPDATE aquaterra_gov_projects SET status = 'built', built_at = now()
      WHERE id = NULLIF(regexp_replace(COALESCE(req->>'project', ''), '\D', '', 'g'), '')::int AND status = 'approved' RETURNING proposal_id INTO pid;
    IF pid IS NULL THEN RETURN aquaterra_gov_err('not_found'); END IF;
    PERFORM aquaterra_gov_log_add('built', pid, format('Works completed: "%s".', (SELECT title FROM aquaterra_gov_proposals WHERE id = pid)));
    RETURN jsonb_build_object('ok', true);
  END IF;
  IF act = 'announce' THEN
    IF NOT (aquaterra_gov_can_act(me, 'civic') OR aquaterra_gov_can_act(me, 'president')) THEN RETURN aquaterra_gov_err('forbidden'); END IF;
    IF length(btrim(COALESCE(req->>'text', ''))) NOT BETWEEN 10 AND 500 THEN RETURN aquaterra_gov_err('body'); END IF;
    PERFORM aquaterra_gov_log_add('notice', NULL, format('Notice from %s: %s', aquaterra_gov_name(me), btrim(req->>'text')));
    RETURN jsonb_build_object('ok', true);
  END IF;

  RETURN aquaterra_gov_err('action');
END $fn$;
