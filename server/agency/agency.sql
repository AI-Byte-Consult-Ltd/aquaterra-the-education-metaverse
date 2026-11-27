-- AquaTerra: First Light Realty (the real estate agency), selling land back to the state,
-- and barter of harvest between residents.
-- One-off migration (never per request). Safe to run again.
-- Needs: economy, governance, travel, arcade, treasury, build, roads, heritage (towers, companions), orbit, farm.
-- n8n quirks: no double-dollar quotes (use $fn$), no positional parameters in the text,
-- no dollar sign right before a quote, no apostrophes in comments.
--
--  * Sell to the state: the owner of a land plot (with whatever stands on it) sells it back at the
--    tax valuation. Land: state_buy_pct of the lower of what was paid and the registry price, so land
--    bought cheap (auction, agency, a friend) is never sold to the state above its cost.
--    Building: sell_back_pct of what was invested (the same law as selling a building in the plot window).
--    The AquaTerra Reserve pays (the State Treasury stays for salaries), sales_tax_pct of it goes to
--    the State Treasury. Not before state_buy_hold_days of owning it. Not while the plot is pledged to
--    the bank, at auction, farmed, or while the owner has unpaid land tax.
--    The plot goes back on sale in the land registry, the building is taken down.
--  * First Light Realty: any asset can be listed for other residents at the price of the seller:
--    land and water plots (with the house), roads, tower apartments, Orbit planets, AI companions.
--    The buyer pays the price with free Tide (welcome Tide is for land from the Reserve) and, for land,
--    the deal duty of the Charter. The seller pays agency_fee_pct to First Light Realty and sales_tax_pct
--    to the State Treasury. The asset stays with the seller until it is sold. Limits: plots per resident
--    (max_plots_per_citizen) and roads per resident (road_max_per_citizen) for the buyer.
--    A plot bought this way earns income on the lower of the price and the registry price,
--    so a deal between friends at a high price does not print Tide.
--  * Harvest barter: a resident offers units of one crop for units of another. The offered units wait
--    in the offer. Each side pays barter_tax_pct of the Reserve value of what it receives
--    (at least 1 Tide) to the State Treasury; the maker pays when the offer is made (returned on cancel).

INSERT INTO aquaterra_gov_params (key, value, min_value, max_value, label) VALUES
  ('agency_fee_pct', 3.6, 0, 20, 'First Light Realty: commission on every sale, paid by the seller'),
  ('agency_max_listings', 30, 1, 500, 'First Light Realty: open listings per resident'),
  ('state_buy_pct', 70, 0, 100, 'Sale to the state: land value, % of the lower of price paid and registry price'),
  ('state_buy_hold_days', 7, 0, 365, 'Sale to the state: days a plot must be owned first'),
  ('barter_tax_pct', 5, 0, 50, 'Harvest barter: tax on the Reserve value of what each side receives'),
  ('barter_max_offers', 20, 1, 200, 'Harvest barter: open offers per resident')
ON CONFLICT (key) DO NOTHING;

INSERT INTO aquaterra_wallets (account, welcomed_at) VALUES ('state:agency', now()) ON CONFLICT DO NOTHING;

DO $do$
DECLARE src text; anchor text := 'WHEN acct IS NULL THEN NULL';
BEGIN
  src := pg_get_functiondef('aquaterra_name(text)'::regprocedure);
  IF position('state:agency' IN src) > 0 THEN RETURN; END IF;
  IF position(anchor IN src) = 0 THEN RAISE EXCEPTION 'name patch: anchor not found'; END IF;
  src := replace(src, anchor, anchor || E'\n    WHEN acct = ''state:agency'' THEN ''First Light Realty''');
  EXECUTE src;
END $do$;

CREATE TABLE IF NOT EXISTS aquaterra_agency_listings (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('plot', 'road', 'apartment', 'planet', 'companion')),
  ref text NOT NULL,
  seller text NOT NULL REFERENCES aquaterra_players (email),
  title text NOT NULL,
  place text,
  price bigint NOT NULL CHECK (price > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sold', 'cancelled', 'gone')),
  buyer text,
  fee bigint NOT NULL DEFAULT 0,
  tax bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS aquaterra_agency_open ON aquaterra_agency_listings (kind, ref) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS aquaterra_agency_seller ON aquaterra_agency_listings (seller, id DESC);
CREATE INDEX IF NOT EXISTS aquaterra_agency_status ON aquaterra_agency_listings (status, kind, id DESC);

CREATE TABLE IF NOT EXISTS aquaterra_state_buybacks (
  id bigserial PRIMARY KEY,
  plot_id int NOT NULL,
  seller text NOT NULL,
  land bigint NOT NULL,
  house bigint NOT NULL,
  tax bigint NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aquaterra_farm_barter (
  id bigserial PRIMARY KEY,
  email text NOT NULL REFERENCES aquaterra_players (email),
  give_crop text NOT NULL REFERENCES aquaterra_crops (key),
  give_units bigint NOT NULL CHECK (give_units > 0),
  want_crop text NOT NULL REFERENCES aquaterra_crops (key),
  want_units bigint NOT NULL CHECK (want_units > 0),
  maker_tax bigint NOT NULL DEFAULT 0,
  taker_tax bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  taker text,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS aquaterra_farm_barter_open ON aquaterra_farm_barter (status, id DESC);

CREATE OR REPLACE FUNCTION aquaterra_agency_law(k text) RETURNS numeric LANGUAGE sql STABLE AS
$fn$ SELECT COALESCE((SELECT value FROM aquaterra_gov_params WHERE key = k), 0)::numeric $fn$;

-- Who owns an asset now (null: nobody, or not a resident).
CREATE OR REPLACE FUNCTION aquaterra_agency_owner(k text, r text) RETURNS text LANGUAGE plpgsql STABLE AS $fn$
BEGIN
  IF k = 'plot' THEN
    IF r ~ '[^0-9]' OR length(r) NOT BETWEEN 1 AND 9 THEN RETURN NULL; END IF;
    RETURN (SELECT owner FROM aquaterra_plot_owners WHERE plot_id = r::int);
  ELSIF k = 'road' THEN
    RETURN (SELECT owner FROM aquaterra_roads WHERE id = r);
  ELSIF k = 'apartment' THEN
    IF split_part(r, ':', 2) ~ '[^0-9]' OR length(split_part(r, ':', 2)) NOT BETWEEN 1 AND 9 THEN RETURN NULL; END IF;
    RETURN (SELECT owner FROM aquaterra_apartments WHERE tower = split_part(r, ':', 1) AND token_id = split_part(r, ':', 2)::int);
  ELSIF k = 'planet' THEN
    IF r ~ '[^0-9]' OR length(r) NOT BETWEEN 1 AND 9 THEN RETURN NULL; END IF;
    RETURN (SELECT owner FROM aquaterra_planets WHERE token_id = r::int);
  ELSIF k = 'companion' THEN
    IF split_part(r, ':', 1) ~ '[^0-9]' OR length(split_part(r, ':', 1)) NOT BETWEEN 1 AND 9 THEN RETURN NULL; END IF;
    RETURN (SELECT email FROM aquaterra_companions WHERE collection_id = split_part(r, ':', 1)::int AND token_id = substr(r, length(split_part(r, ':', 1)) + 2));
  END IF;
  RETURN NULL;
END $fn$;

-- Title and place of an asset for the listing card.
CREATE OR REPLACE FUNCTION aquaterra_agency_describe(k text, r text, OUT title text, OUT place text) LANGUAGE plpgsql STABLE AS $fn$
BEGIN
  IF k = 'plot' THEN
    SELECT p.address, p.district || ', ' || p.tiles || ' tiles' ||
        CASE WHEN COALESCE(b.kind, 'empty') <> 'empty' THEN ', ' || b.kind || ' level ' || b.level
             WHEN COALESCE(s.starter, 'none') <> 'none' THEN ', ' || s.starter ELSE '' END ||
        CASE WHEN s.plot_id IS NOT NULL AND NOT s.buildable THEN ', water' ELSE '' END
      INTO title, place
    FROM aquaterra_plots p LEFT JOIN aquaterra_buildings b ON b.plot_id = p.id LEFT JOIN aquaterra_build_sites s ON s.plot_id = p.id
    WHERE p.id = r::int;
  ELSIF k = 'road' THEN
    SELECT name, 'Road, condition ' || round(aquaterra_road_cond(x), 0) || '%' INTO title, place FROM aquaterra_roads x WHERE id = r;
  ELSIF k = 'apartment' THEN
    SELECT t.name || ', apartment ' || a.number, a.apt_type || ', floor ' || a.floor || COALESCE(', ' || a.view || ' view', '')
      INTO title, place
    FROM aquaterra_apartments a JOIN aquaterra_towers t ON t.id = a.tower
    WHERE a.tower = split_part(r, ':', 1) AND a.token_id = split_part(r, ':', 2)::int;
  ELSIF k = 'planet' THEN
    SELECT name || ' #' || token_id, body_type || ' of ' || main_planet || ', ' || resource || ', ' || rarity INTO title, place
    FROM aquaterra_planets WHERE token_id = r::int;
  ELSIF k = 'companion' THEN
    SELECT name, COALESCE(pantheon, '') || CASE WHEN domain IS NOT NULL THEN ', ' || domain ELSE '' END INTO title, place
    FROM aquaterra_companions WHERE collection_id = split_part(r, ':', 1)::int AND token_id = substr(r, length(split_part(r, ':', 1)) + 2);
  END IF;
END $fn$;

-- Why a plot cannot change hands now: null, pledged, auction, field.
CREATE OR REPLACE FUNCTION aquaterra_agency_plot_block(pid int) RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM aquaterra_bank_loans WHERE collateral_plot = pid AND status = 'open') THEN 'pledged'
    WHEN EXISTS (SELECT 1 FROM aquaterra_land_auctions WHERE plot_id = pid AND status = 'open') THEN 'auction'
    WHEN EXISTS (SELECT 1 FROM aquaterra_farm_fields WHERE plot_id = pid) THEN 'field'
  END
$fn$;

-- Pays the owner of a plot what it has earned so far (land and building), before it changes hands.
CREATE OR REPLACE FUNCTION aquaterra_agency_settle_plot(pid int, who text) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE o aquaterra_plot_owners; due bigint; addr text;
BEGIN
  SELECT * INTO o FROM aquaterra_plot_owners WHERE plot_id = pid FOR UPDATE;
  IF o.plot_id IS NULL OR o.owner <> who THEN RETURN; END IF;
  due := aquaterra_pending(o.price_paid, o.income_from);
  SELECT address INTO addr FROM aquaterra_plots WHERE id = pid;
  IF due > 0 THEN
    PERFORM aquaterra_arc_pay('treasury', who, due, 'income', pid, 'Plot income, ' || COALESCE(addr, ''), who, 'agency:income:' || pid || ':' || extract(epoch FROM clock_timestamp()));
  END IF;
  UPDATE aquaterra_plot_owners SET income_from = now() WHERE plot_id = pid;
  PERFORM aquaterra_build_collect(pid, who);
END $fn$;

-- The tax valuation of a plot for a sale to the state.
CREATE OR REPLACE FUNCTION aquaterra_state_appraise(pid int, who text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $fn$
DECLARE o aquaterra_plot_owners; p aquaterra_plots; b aquaterra_buildings; land bigint; house bigint; gross bigint; tax bigint;
  held numeric; blk text;
BEGIN
  SELECT * INTO o FROM aquaterra_plot_owners WHERE plot_id = pid;
  SELECT * INTO p FROM aquaterra_plots WHERE id = pid;
  IF o.plot_id IS NULL OR p.id IS NULL THEN RETURN jsonb_build_object('block', 'not_found'); END IF;
  SELECT * INTO b FROM aquaterra_buildings WHERE plot_id = pid;
  land := floor(least(o.price_paid, p.price) * aquaterra_agency_law('state_buy_pct') / 100.0)::bigint;
  house := CASE WHEN b.plot_id IS NOT NULL AND b.kind <> 'empty'
    THEN floor(COALESCE(b.invested, 0) * aquaterra_build_param('sell_back_pct') / 100.0)::bigint ELSE 0 END;
  gross := land + house;
  tax := round(gross * aquaterra_sales_tax_pct() / 100.0)::bigint;
  held := extract(epoch FROM now() - o.bought_at) / 86400.0;
  blk := CASE WHEN o.owner IS DISTINCT FROM who THEN 'not_owner' ELSE aquaterra_agency_plot_block(pid) END;
  IF blk IS NULL AND EXISTS (SELECT 1 FROM aquaterra_debts WHERE email = who AND status IN ('open', 'auction')) THEN blk := 'debt'; END IF;
  IF blk IS NULL AND held < aquaterra_agency_law('state_buy_hold_days') THEN blk := 'too_soon'; END IF;
  IF blk IS NULL AND gross - tax < 1 THEN blk := 'too_little'; END IF;
  RETURN jsonb_build_object('plotId', pid, 'address', p.address, 'district', p.district, 'pricePaid', o.price_paid, 'registryPrice', p.price,
    'landPct', aquaterra_agency_law('state_buy_pct'), 'housePct', aquaterra_build_param('sell_back_pct'),
    'land', land, 'house', house, 'gross', gross, 'taxPct', aquaterra_sales_tax_pct(), 'tax', tax, 'net', gross - tax,
    'boughtAt', o.bought_at, 'holdDays', aquaterra_agency_law('state_buy_hold_days'),
    'sellableAt', o.bought_at + make_interval(days => aquaterra_agency_law('state_buy_hold_days')::int), 'block', blk);
END $fn$;

-- Moves an asset to its new owner.
CREATE OR REPLACE FUNCTION aquaterra_agency_give(k text, r text, dst text, price bigint) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF k = 'plot' THEN
    UPDATE aquaterra_plot_owners o SET owner = dst, price_paid = least(aquaterra_agency_give.price, p.price), bought_at = now(), income_from = now()
    FROM aquaterra_plots p WHERE o.plot_id = r::int AND p.id = o.plot_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'gone'; END IF;
    UPDATE aquaterra_buildings SET income_from = now() WHERE plot_id = r::int;
    RETURN;
  ELSIF k = 'road' THEN
    UPDATE aquaterra_roads SET owner = dst, bought_at = now(), revenue = 0, repairs = 0 WHERE id = r;
  ELSIF k = 'apartment' THEN
    UPDATE aquaterra_apartments SET owner = dst, owned_at = now(), income_from = now()
    WHERE tower = split_part(r, ':', 1) AND token_id = split_part(r, ':', 2)::int;
  ELSIF k = 'planet' THEN
    UPDATE aquaterra_planets SET owner = dst, owned_at = now() WHERE token_id = r::int;
  ELSIF k = 'companion' THEN
    UPDATE aquaterra_companions SET email = dst, since = now()
    WHERE collection_id = split_part(r, ':', 1)::int AND token_id = substr(r, length(split_part(r, ':', 1)) + 2);
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'gone'; END IF;
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_agency_card(l aquaterra_agency_listings, me text) RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('id', l.id, 'kind', l.kind, 'ref', l.ref, 'title', l.title, 'place', l.place, 'price', l.price,
    'seller', aquaterra_name(l.seller), 'mine', me IS NOT NULL AND l.seller = me, 'status', l.status, 'at', l.created_at,
    'registryPrice', CASE WHEN l.kind = 'plot' THEN (SELECT price FROM aquaterra_plots WHERE id = l.ref::int) END,
    'duty', CASE WHEN l.kind = 'plot' AND aquaterra_fisc('deal_duty_pct') > 0 THEN greatest(1, round(l.price * aquaterra_fisc('deal_duty_pct') / 100.0))::bigint ELSE 0 END)
$fn$;

-- What a resident owns that the agency can sell.
CREATE OR REPLACE FUNCTION aquaterra_agency_assets(me text) RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.o, x.t), '[]'::jsonb) FROM (
    SELECT 1 AS o, p.address AS t, jsonb_build_object('kind', 'plot', 'ref', p.id::text, 'title', d.title, 'place', d.place,
      'value', p.price, 'pricePaid', o.price_paid, 'block', aquaterra_agency_plot_block(p.id),
      'listing', (SELECT id FROM aquaterra_agency_listings WHERE kind = 'plot' AND ref = p.id::text AND status = 'open')) AS j
    FROM aquaterra_plot_owners o JOIN aquaterra_plots p ON p.id = o.plot_id, aquaterra_agency_describe('plot', p.id::text) d WHERE o.owner = me
    UNION ALL
    SELECT 2, r.name, jsonb_build_object('kind', 'road', 'ref', r.id, 'title', d.title, 'place', d.place, 'value', r.price,
      'listing', (SELECT id FROM aquaterra_agency_listings WHERE kind = 'road' AND ref = r.id AND status = 'open'))
    FROM aquaterra_roads r, aquaterra_agency_describe('road', r.id) d WHERE r.owner = me
    UNION ALL
    SELECT 3, a.tower || lpad(a.token_id::text, 6, '0'), jsonb_build_object('kind', 'apartment', 'ref', a.tower || ':' || a.token_id, 'title', d.title, 'place', d.place,
      'listing', (SELECT id FROM aquaterra_agency_listings WHERE kind = 'apartment' AND ref = a.tower || ':' || a.token_id AND status = 'open'))
    FROM aquaterra_apartments a, aquaterra_agency_describe('apartment', a.tower || ':' || a.token_id) d WHERE a.owner = me
    UNION ALL
    SELECT 4, lpad(pl.token_id::text, 6, '0'), jsonb_build_object('kind', 'planet', 'ref', pl.token_id::text, 'title', d.title, 'place', d.place,
      'listing', (SELECT id FROM aquaterra_agency_listings WHERE kind = 'planet' AND ref = pl.token_id::text AND status = 'open'))
    FROM aquaterra_planets pl, aquaterra_agency_describe('planet', pl.token_id::text) d WHERE pl.owner = me
    UNION ALL
    SELECT 5, c.name, jsonb_build_object('kind', 'companion', 'ref', c.collection_id || ':' || c.token_id, 'title', d.title, 'place', d.place,
      'listing', (SELECT id FROM aquaterra_agency_listings WHERE kind = 'companion' AND ref = c.collection_id || ':' || c.token_id AND status = 'open'))
    FROM aquaterra_companions c, aquaterra_agency_describe('companion', c.collection_id || ':' || c.token_id) d WHERE c.email = me
  ) x
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_barter_card(b aquaterra_farm_barter, me text) RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('id', b.id, 'maker', aquaterra_name(b.email), 'mine', me IS NOT NULL AND b.email = me,
    'giveCrop', b.give_crop, 'giveUnits', b.give_units, 'wantCrop', b.want_crop, 'wantUnits', b.want_units,
    'takerTax', greatest(1, round(b.give_units * COALESCE(aquaterra_farm_price(b.give_crop), 0) * aquaterra_agency_law('barter_tax_pct') / 100.0))::bigint,
    'status', b.status, 'at', b.created_at)
$fn$;

-- The API. req: {action, session?, ...}. Returns {ok, ...} or {ok:false, error, status}.
--  list {kind?} (public): open listings and the laws. mine: my assets, listings and history.
--  appraise {plotId}, sell_state {plotId}: sale to the state.
--  list_add {kind, ref, price}, list_cancel {id}, buy {id}.
--  barter (public): open offers. barter_offer {give, giveUnits, want, wantUnits}, barter_take {id}, barter_cancel {id}.
CREATE OR REPLACE FUNCTION aquaterra_agency(req jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  act text := coalesce(req->>'action', '');
  me text; res jsonb := '{}'::jsonb;
  v_kind text; v_ref text; v_price bigint; v_id bigint; v_txt text; l aquaterra_agency_listings; bt aquaterra_farm_barter;
  ap jsonb; v_fee bigint; v_tax bigint; v_duty bigint; pid int; d record; v_give text; v_want text; v_gu bigint; v_wu bigint;
  v_lim numeric;
BEGIN
  IF coalesce(req->>'session', '') <> '' THEN
    SELECT s.email INTO me FROM aquaterra_sessions s
    WHERE s.token_hash = encode(sha256(convert_to(req->>'session', 'UTF8')), 'hex') AND s.expires_at > now();
  END IF;
  IF act NOT IN ('list', 'barter') AND me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401);
  END IF;
  v_txt := coalesce(req->>'id', req->>'plotId', '');
  v_id := CASE WHEN v_txt ~ '^[0-9]' AND length(v_txt) <= 12 AND v_txt !~ '[^0-9]' THEN v_txt::bigint END;

  BEGIN
    IF act = 'list' THEN
      v_kind := req->>'kind';
      res := jsonb_build_object('listings', COALESCE((SELECT jsonb_agg(aquaterra_agency_card(x, me) ORDER BY x.id DESC) FROM (
        SELECT * FROM aquaterra_agency_listings WHERE status = 'open' AND (v_kind IS NULL OR v_kind = '' OR kind = v_kind)
        ORDER BY id DESC LIMIT 200) x), '[]'::jsonb),
        'sold', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', x.kind, 'title', x.title, 'price', x.price, 'at', x.closed_at) ORDER BY x.closed_at DESC)
          FROM (SELECT * FROM aquaterra_agency_listings WHERE status = 'sold' ORDER BY closed_at DESC LIMIT 12) x), '[]'::jsonb));

    ELSIF act = 'mine' THEN
      NULL;

    ELSIF act = 'appraise' THEN
      IF v_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      ap := aquaterra_state_appraise(v_id::int, me);
      IF ap->>'block' = 'not_found' THEN RAISE EXCEPTION 'not_found'; END IF;
      res := jsonb_build_object('appraisal', ap);

    ELSIF act = 'sell_state' THEN
      IF v_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      pid := v_id::int;
      PERFORM 1 FROM aquaterra_plot_owners WHERE plot_id = pid FOR UPDATE;
      ap := aquaterra_state_appraise(pid, me);
      IF ap->>'block' IS NOT NULL THEN RAISE EXCEPTION '%', ap->>'block'; END IF;
      PERFORM aquaterra_agency_settle_plot(pid, me);
      PERFORM aquaterra_arc_pay('treasury', me, (ap->>'net')::bigint, 'state_buyback', pid,
        'Sold to the state: ' || (ap->>'address'), me, 'state:buy:' || pid || ':' || extract(epoch FROM clock_timestamp()));
      PERFORM aquaterra_arc_pay('treasury', 'state:treasury', (ap->>'tax')::bigint, 'tax', pid,
        'Sales tax: ' || (ap->>'address') || ' sold to the state', me, 'tax:state:buy:' || pid || ':' || extract(epoch FROM clock_timestamp()));
      IF (ap->>'house')::bigint > 0 OR EXISTS (SELECT 1 FROM aquaterra_buildings WHERE plot_id = pid AND kind <> 'empty') THEN
        UPDATE aquaterra_buildings SET kind = 'empty', level = 0, design = 0, invested = 0, ready_at = now(), income_from = now(), built_by = NULL, updated_at = now()
        WHERE plot_id = pid;
        INSERT INTO aquaterra_build_log (plot_id, actor, action, cost) VALUES (pid, me, 'sell', (ap->>'house')::bigint);
      END IF;
      DELETE FROM aquaterra_plot_owners WHERE plot_id = pid;
      UPDATE aquaterra_agency_listings SET status = 'gone', closed_at = now() WHERE kind = 'plot' AND ref = pid::text AND status = 'open';
      INSERT INTO aquaterra_state_buybacks (plot_id, seller, land, house, tax) VALUES (pid, me, (ap->>'land')::bigint, (ap->>'house')::bigint, (ap->>'tax')::bigint);
      res := jsonb_build_object('sold', ap);

    ELSIF act = 'list_add' THEN
      v_kind := req->>'kind'; v_ref := left(coalesce(req->>'ref', ''), 80);
      IF v_kind IS NULL OR v_kind NOT IN ('plot', 'road', 'apartment', 'planet', 'companion') THEN RAISE EXCEPTION 'kind'; END IF;
      v_txt := coalesce(req->>'price', '');
      IF v_txt !~ '^[0-9]' OR v_txt ~ '[^0-9]' OR length(v_txt) > 10 THEN RAISE EXCEPTION 'price'; END IF;
      v_price := v_txt::bigint;
      IF v_price < 1 OR v_price > 1000000000 THEN RAISE EXCEPTION 'price'; END IF;
      IF aquaterra_agency_owner(v_kind, v_ref) IS DISTINCT FROM me THEN RAISE EXCEPTION 'not_owner'; END IF;
      IF v_kind = 'plot' AND aquaterra_agency_plot_block(v_ref::int) IS NOT NULL THEN RAISE EXCEPTION '%', aquaterra_agency_plot_block(v_ref::int); END IF;
      IF (SELECT count(*) FROM aquaterra_agency_listings WHERE seller = me AND status = 'open') >= aquaterra_agency_law('agency_max_listings') THEN
        RAISE EXCEPTION 'too_many';
      END IF;
      SELECT * INTO d FROM aquaterra_agency_describe(v_kind, v_ref);
      INSERT INTO aquaterra_agency_listings (kind, ref, seller, title, place, price) VALUES (v_kind, v_ref, me, COALESCE(d.title, v_ref), d.place, v_price)
      ON CONFLICT DO NOTHING RETURNING id INTO v_id;
      IF v_id IS NULL THEN RAISE EXCEPTION 'listed'; END IF;
      res := jsonb_build_object('listingId', v_id);

    ELSIF act = 'list_cancel' THEN
      UPDATE aquaterra_agency_listings SET status = 'cancelled', closed_at = now() WHERE id = v_id AND seller = me AND status = 'open';
      IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
      res := jsonb_build_object('cancelled', v_id);

    ELSIF act = 'buy' THEN
      SELECT * INTO l FROM aquaterra_agency_listings WHERE id = v_id AND status = 'open' FOR UPDATE;
      IF l.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      IF l.seller = me THEN RAISE EXCEPTION 'self'; END IF;
      IF aquaterra_agency_owner(l.kind, l.ref) IS DISTINCT FROM l.seller
         OR (l.kind = 'plot' AND aquaterra_agency_plot_block(l.ref::int) IS NOT NULL) THEN
        UPDATE aquaterra_agency_listings SET status = 'gone', closed_at = now() WHERE id = l.id;
        RETURN jsonb_build_object('ok', false, 'error', 'gone', 'status', 409);
      END IF;
      IF l.price > 1000000000 THEN RAISE EXCEPTION 'price'; END IF;
      IF l.kind = 'plot' AND (SELECT count(*) FROM aquaterra_plot_owners WHERE owner = me) >= aquaterra_param('max_plots_per_citizen') THEN
        RAISE EXCEPTION 'plot_limit';
      END IF;
      IF l.kind = 'road' AND (SELECT count(*) FROM aquaterra_roads WHERE owner = me) >= aquaterra_agency_law('road_max_per_citizen') THEN
        RAISE EXCEPTION 'road_limit';
      END IF;
      PERFORM 1 FROM aquaterra_wallets WHERE account IN (me, l.seller) ORDER BY account FOR UPDATE;
      v_duty := CASE WHEN l.kind = 'plot' AND aquaterra_fisc('deal_duty_pct') > 0 THEN greatest(1, round(l.price * aquaterra_fisc('deal_duty_pct') / 100.0))::bigint ELSE 0 END;
      IF aquaterra_arc_free(me) < l.price + v_duty THEN RAISE EXCEPTION 'insufficient'; END IF;
      v_fee := round(l.price * aquaterra_agency_law('agency_fee_pct') / 100.0)::bigint;
      v_tax := round(l.price * aquaterra_sales_tax_pct() / 100.0)::bigint;
      IF l.kind = 'plot' THEN PERFORM aquaterra_agency_settle_plot(l.ref::int, l.seller); END IF;
      PERFORM aquaterra_arc_pay(me, l.seller, l.price, 'agency_sale', CASE WHEN l.kind = 'plot' THEN l.ref::int END,
        'First Light Realty: ' || l.title, me, 'agency:' || l.id || ':price');
      PERFORM aquaterra_arc_pay(l.seller, 'state:agency', v_fee, 'agency_fee', CASE WHEN l.kind = 'plot' THEN l.ref::int END,
        'Agency commission: ' || l.title, me, 'agency:' || l.id || ':fee');
      PERFORM aquaterra_arc_pay(l.seller, 'state:treasury', v_tax, 'tax', CASE WHEN l.kind = 'plot' THEN l.ref::int END,
        'Sales tax: ' || l.title, me, 'agency:' || l.id || ':tax');
      PERFORM aquaterra_arc_pay(me, 'state:treasury', v_duty, 'duty', CASE WHEN l.kind = 'plot' THEN l.ref::int END, 'Deal duty: ' || l.title, me, 'agency:' || l.id || ':duty');
      PERFORM aquaterra_agency_give(l.kind, l.ref, me, l.price);
      UPDATE aquaterra_agency_listings SET status = 'sold', buyer = me, fee = v_fee, tax = v_tax, closed_at = now() WHERE id = l.id;
      UPDATE aquaterra_agency_listings SET status = 'gone', closed_at = now() WHERE kind = l.kind AND ref = l.ref AND status = 'open' AND id <> l.id;
      PERFORM aquaterra_notice(l.seller, 'agency', format('First Light Realty sold %s to %s for %s TIDE. Commission %s, sales tax %s: %s TIDE came to your wallet.',
        l.title, aquaterra_name(me), l.price, v_fee, v_tax, l.price - v_fee - v_tax));
      res := jsonb_build_object('bought', aquaterra_agency_card(l, me), 'price', l.price, 'duty', v_duty);

    ELSIF act = 'barter' THEN
      NULL;

    ELSIF act = 'barter_offer' THEN
      v_give := left(coalesce(req->>'give', ''), 20); v_want := left(coalesce(req->>'want', ''), 20);
      IF NOT EXISTS (SELECT 1 FROM aquaterra_crops WHERE key = v_give) OR NOT EXISTS (SELECT 1 FROM aquaterra_crops WHERE key = v_want) OR v_give = v_want THEN
        RAISE EXCEPTION 'crop';
      END IF;
      v_gu := CASE WHEN coalesce(req->>'giveUnits', '') ~ '^[0-9]' AND length(req->>'giveUnits') <= 9 AND (req->>'giveUnits') !~ '[^0-9]' THEN (req->>'giveUnits')::bigint END;
      v_wu := CASE WHEN coalesce(req->>'wantUnits', '') ~ '^[0-9]' AND length(req->>'wantUnits') <= 9 AND (req->>'wantUnits') !~ '[^0-9]' THEN (req->>'wantUnits')::bigint END;
      IF v_gu IS NULL OR v_gu < 1 OR v_wu IS NULL OR v_wu < 1 THEN RAISE EXCEPTION 'units'; END IF;
      IF (SELECT count(*) FROM aquaterra_farm_barter WHERE email = me AND status = 'open') >= aquaterra_agency_law('barter_max_offers') THEN RAISE EXCEPTION 'too_many'; END IF;
      v_tax := greatest(1, round(v_wu * COALESCE(aquaterra_farm_price(v_want), 0) * aquaterra_agency_law('barter_tax_pct') / 100.0))::bigint;
      IF aquaterra_agency_law('barter_tax_pct') <= 0 THEN v_tax := 0; END IF;
      IF aquaterra_arc_free(me) < v_tax THEN RAISE EXCEPTION 'insufficient'; END IF;
      UPDATE aquaterra_farm_barn SET units = units - v_gu WHERE email = me AND crop = v_give AND units >= v_gu;
      IF NOT FOUND THEN RAISE EXCEPTION 'nothing'; END IF;
      INSERT INTO aquaterra_farm_barter (email, give_crop, give_units, want_crop, want_units, maker_tax) VALUES (me, v_give, v_gu, v_want, v_wu, v_tax) RETURNING id INTO v_id;
      PERFORM aquaterra_arc_pay(me, 'farm:escrow', v_tax, 'farm_escrow', NULL, 'Harvest barter: tax held for offer ' || v_id, me, 'barter:' || v_id || ':hold');
      res := jsonb_build_object('offerId', v_id);

    ELSIF act = 'barter_cancel' THEN
      SELECT * INTO bt FROM aquaterra_farm_barter WHERE id = v_id AND email = me AND status = 'open' FOR UPDATE;
      IF bt.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      UPDATE aquaterra_farm_barter SET status = 'cancelled', closed_at = now() WHERE id = bt.id;
      INSERT INTO aquaterra_farm_barn (email, crop, units) VALUES (me, bt.give_crop, bt.give_units)
      ON CONFLICT (email, crop) DO UPDATE SET units = aquaterra_farm_barn.units + EXCLUDED.units;
      PERFORM aquaterra_arc_pay('farm:escrow', me, bt.maker_tax, 'farm_return', NULL, 'Harvest barter: offer ' || bt.id || ' cancelled', me, 'barter:' || bt.id || ':back');
      res := jsonb_build_object('cancelled', bt.id);

    ELSIF act = 'barter_take' THEN
      SELECT * INTO bt FROM aquaterra_farm_barter WHERE id = v_id AND status = 'open' FOR UPDATE;
      IF bt.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      IF bt.email = me THEN RAISE EXCEPTION 'self'; END IF;
      v_tax := CASE WHEN aquaterra_agency_law('barter_tax_pct') <= 0 THEN 0 ELSE
        greatest(1, round(bt.give_units * COALESCE(aquaterra_farm_price(bt.give_crop), 0) * aquaterra_agency_law('barter_tax_pct') / 100.0))::bigint END;
      IF aquaterra_arc_free(me) < v_tax THEN RAISE EXCEPTION 'insufficient'; END IF;
      UPDATE aquaterra_farm_barn SET units = units - bt.want_units WHERE email = me AND crop = bt.want_crop AND units >= bt.want_units;
      IF NOT FOUND THEN RAISE EXCEPTION 'nothing'; END IF;
      INSERT INTO aquaterra_farm_barn (email, crop, units) VALUES (me, bt.give_crop, bt.give_units)
      ON CONFLICT (email, crop) DO UPDATE SET units = aquaterra_farm_barn.units + EXCLUDED.units;
      INSERT INTO aquaterra_farm_barn (email, crop, units) VALUES (bt.email, bt.want_crop, bt.want_units)
      ON CONFLICT (email, crop) DO UPDATE SET units = aquaterra_farm_barn.units + EXCLUDED.units;
      PERFORM aquaterra_arc_pay(me, 'state:treasury', v_tax, 'tax', NULL, 'Harvest barter tax, offer ' || bt.id, me, 'barter:' || bt.id || ':taker');
      PERFORM aquaterra_arc_pay('farm:escrow', 'state:treasury', bt.maker_tax, 'tax', NULL, 'Harvest barter tax, offer ' || bt.id, bt.email, 'barter:' || bt.id || ':maker');
      UPDATE aquaterra_farm_barter SET status = 'done', taker = me, taker_tax = v_tax, closed_at = now() WHERE id = bt.id;
      INSERT INTO aquaterra_farm_log (email, kind, crop, units) VALUES (me, 'barter', bt.give_crop, bt.give_units), (bt.email, 'barter', bt.want_crop, bt.want_units);
      PERFORM aquaterra_notice(bt.email, 'farm', format('%s took your barter offer: %s %s for %s %s.', aquaterra_name(me), bt.give_units, bt.give_crop, bt.want_units, bt.want_crop));
      res := jsonb_build_object('done', bt.id, 'tax', v_tax);

    ELSE
      RAISE EXCEPTION 'action';
    END IF;

    res := res || jsonb_build_object('laws', jsonb_build_object('feePct', aquaterra_agency_law('agency_fee_pct'), 'salesTaxPct', aquaterra_sales_tax_pct(),
      'dutyPct', aquaterra_fisc('deal_duty_pct'), 'statePct', aquaterra_agency_law('state_buy_pct'), 'holdDays', aquaterra_agency_law('state_buy_hold_days'),
      'housePct', aquaterra_build_param('sell_back_pct'), 'maxListings', aquaterra_agency_law('agency_max_listings'),
      'maxPlots', aquaterra_param('max_plots_per_citizen'), 'maxRoads', aquaterra_agency_law('road_max_per_citizen'),
      'barterTaxPct', aquaterra_agency_law('barter_tax_pct'), 'maxOffers', aquaterra_agency_law('barter_max_offers')));
    IF act LIKE 'barter%' THEN
      res := res || jsonb_build_object('offers', COALESCE((SELECT jsonb_agg(aquaterra_barter_card(x, me) ORDER BY x.id DESC) FROM (
        SELECT * FROM aquaterra_farm_barter WHERE status = 'open' ORDER BY id DESC LIMIT 200) x), '[]'::jsonb));
    END IF;
    IF me IS NOT NULL AND act NOT LIKE 'barter%' AND act <> 'list' THEN
      res := res || jsonb_build_object('assets', aquaterra_agency_assets(me),
        'listings', COALESCE((SELECT jsonb_agg(aquaterra_agency_card(x, me) ORDER BY x.id DESC) FROM (
          SELECT * FROM aquaterra_agency_listings WHERE seller = me AND status = 'open' ORDER BY id DESC) x), '[]'::jsonb),
        'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', x.kind, 'title', x.title, 'price', x.price, 'fee', x.fee, 'tax', x.tax,
            'side', CASE WHEN x.seller = me THEN 'sold' ELSE 'bought' END, 'at', x.closed_at) ORDER BY x.closed_at DESC)
          FROM (SELECT * FROM aquaterra_agency_listings WHERE status = 'sold' AND (seller = me OR buyer = me) ORDER BY closed_at DESC LIMIT 20) x), '[]'::jsonb));
    END IF;
    IF me IS NOT NULL THEN
      res := res || jsonb_build_object('balance', aquaterra_balance(me), 'free', aquaterra_arc_free(me));
    END IF;
    RETURN jsonb_build_object('ok', true) || res;
  EXCEPTION WHEN raise_exception OR check_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM,
      'status', CASE SQLERRM WHEN 'not_found' THEN 404 WHEN 'gone' THEN 409 ELSE 400 END);
  END;
END $fn$;
