-- AquaTerra: Orbit, the sky layer above the world.
-- One-off migration (never per request). Safe to run again.
-- Needs: economy, governance, treasury (income tax trigger on kind 'income'), heritage.
-- n8n quirks: no double-dollar quotes (use $fn$), no positional parameters in
-- the text, no dollar sign right before a quote.
--
-- The 10,000 Milky Way Marvels NFTs (Cronos 0xf37a3686800a9fb19625c05e1a7acf2d232e8aa4)
-- are mining claims on real bodies of the Solar System: planets, moons, satellites,
-- asteroids, centaurs, trans-Neptunian objects. Many claims share a body. Each claim
-- carries one resource (Gold, Platinum, Nickel ...) and a rarity, from its metadata
-- (loaded once by n8n into aquaterra_planets).
--  * A resident brings the NFT home through the Heritage Port (kind planet): token N
--    becomes claim N in Orbit, owned in the game.
--  * Once a UTC day each claim can be mined: law orbit_mine_units units of its resource
--    times the rarity factor go into the owner's hold.
--  * The hold sells to the AquaTerra Reserve at the resource price: Tide, kind 'income',
--    so the treasury trigger takes income tax and loan repayments.
--  * Resources stay in the hold until sold: later they feed building and expeditions
--    from the Skyport.

CREATE TABLE IF NOT EXISTS aquaterra_planets (
  token_id int PRIMARY KEY,
  name text NOT NULL,                -- the body: Charon, Vesta, Aegaeon ...
  body_type text NOT NULL,           -- Planet, Moon, Satellite, Asteroid, Centaur, Trans Neptunian Object ...
  main_planet text NOT NULL,         -- what it orbits: Saturn, Pluto, Sun, Asteroid Belt ...
  resource text NOT NULL,
  rarity text NOT NULL,
  system text,
  galaxy text,
  image text,
  owner text REFERENCES aquaterra_players (email),
  owned_at timestamptz,
  mined_on date
);
CREATE INDEX IF NOT EXISTS aquaterra_planets_owner ON aquaterra_planets (owner) WHERE owner IS NOT NULL;
CREATE INDEX IF NOT EXISTS aquaterra_planets_body ON aquaterra_planets (main_planet, name);

CREATE TABLE IF NOT EXISTS aquaterra_orbit_holds (
  email text NOT NULL REFERENCES aquaterra_players (email),
  resource text NOT NULL,
  units bigint NOT NULL DEFAULT 0 CHECK (units >= 0),
  PRIMARY KEY (email, resource)
);

CREATE TABLE IF NOT EXISTS aquaterra_orbit_log (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  kind text NOT NULL,                -- mine | sell
  resource text,
  units bigint NOT NULL,
  tide bigint NOT NULL DEFAULT 0,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aquaterra_orbit_log_email ON aquaterra_orbit_log (email, at DESC);

INSERT INTO aquaterra_gov_params (key, value, min_value, max_value, label) VALUES
  ('orbit_mine_units', 10, 0, 1000, 'Orbit: units one Common claim mines a day (Uncommon x1.5, Rare x2.5, Epic x4, Legendary x7)'),
  ('orbit_price_pct', 100, 0, 1000, 'Orbit: resource prices at the Reserve, % of the base price')
ON CONFLICT (key) DO NOTHING;

-- The planets collection swaps 1:1 into Orbit claims.
INSERT INTO aquaterra_nft_collections (chain, contract, name, kind, swap_tide, allow_plot, enabled, note)
SELECT 'cronos', '0xf37a3686800a9fb19625c05e1a7acf2d232e8aa4', 'Milky Way Marvels', 'planet', 0, false, true,
  '10,000 claims on planets, moons and asteroids. Each NFT becomes the same claim in Orbit and mines its resource every day.'
WHERE NOT EXISTS (SELECT 1 FROM aquaterra_nft_collections WHERE chain = 'cronos' AND contract = '0xf37a3686800a9fb19625c05e1a7acf2d232e8aa4');
UPDATE aquaterra_nft_collections SET kind = 'planet', swap_tide = 0, allow_plot = false
WHERE chain = 'cronos' AND contract = '0xf37a3686800a9fb19625c05e1a7acf2d232e8aa4' AND kind <> 'planet';

CREATE OR REPLACE FUNCTION aquaterra_orbit_law(k text) RETURNS numeric LANGUAGE sql STABLE AS
$fn$ SELECT COALESCE((SELECT value FROM aquaterra_gov_params WHERE key = k), 0)::numeric $fn$;

CREATE OR REPLACE FUNCTION aquaterra_orbit_factor(r text) RETURNS numeric LANGUAGE sql IMMUTABLE AS
$fn$ SELECT CASE lower(coalesce(r, '')) WHEN 'uncommon' THEN 1.5 WHEN 'rare' THEN 2.5 WHEN 'epic' THEN 4
  WHEN 'legendary' THEN 7 WHEN 'mythic' THEN 10 ELSE 1 END $fn$;

-- Base price of one unit in Tide, by how precious the resource is.
CREATE OR REPLACE FUNCTION aquaterra_orbit_base(res text) RETURNS numeric LANGUAGE sql IMMUTABLE AS
$fn$ SELECT CASE
  WHEN lower(res) IN ('gold', 'platinum', 'rhodium', 'palladium', 'iridium', 'osmium', 'rhenium', 'ruthenium', 'diamond', 'helium-3', 'antimatter') THEN 0.5
  WHEN lower(res) IN ('silver', 'titanium', 'cobalt', 'lithium', 'uranium', 'tungsten', 'neodymium', 'tantalum', 'vanadium', 'chromium', 'molybdenum', 'thorium', 'germanium', 'indium', 'gallium', 'beryllium', 'scandium', 'yttrium') THEN 0.3
  ELSE 0.2 END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_orbit_price(res text) RETURNS numeric LANGUAGE sql STABLE AS
$fn$ SELECT round(aquaterra_orbit_base(res) * aquaterra_orbit_law('orbit_price_pct') / 100.0, 3) $fn$;

CREATE OR REPLACE FUNCTION aquaterra_orbit_units(rarity text) RETURNS bigint LANGUAGE sql STABLE AS
$fn$ SELECT floor(aquaterra_orbit_law('orbit_mine_units') * aquaterra_orbit_factor(rarity))::bigint $fn$;

CREATE OR REPLACE FUNCTION aquaterra_orbit_claim_json(p aquaterra_planets) RETURNS jsonb LANGUAGE sql STABLE AS
$fn$ SELECT jsonb_build_object('tokenId', p.token_id, 'name', p.name, 'type', p.body_type, 'orbits', p.main_planet,
  'resource', p.resource, 'rarity', p.rarity, 'image', p.image, 'units', aquaterra_orbit_units(p.rarity),
  'price', aquaterra_orbit_price(p.resource), 'minedToday', p.mined_on IS NOT NULL AND p.mined_on >= (now() AT TIME ZONE 'utc')::date,
  'ownedAt', p.owned_at) $fn$;

-- n8n only, once: load NFT metadata. rows: [{tokenId, name, type, orbits, resource, rarity, system, galaxy, image}].
-- Never touches the owner.
CREATE OR REPLACE FUNCTION aquaterra_planet_load(rows jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE n int;
BEGIN
  INSERT INTO aquaterra_planets (token_id, name, body_type, main_planet, resource, rarity, system, galaxy, image)
  SELECT (r->>'tokenId')::int, left(btrim(r->>'name'), 60), left(coalesce(nullif(btrim(r->>'type'), ''), 'Body'), 40),
    left(coalesce(nullif(btrim(r->>'orbits'), ''), 'Sun'), 40), left(coalesce(nullif(btrim(r->>'resource'), ''), 'Iron'), 30),
    left(coalesce(nullif(btrim(r->>'rarity'), ''), 'Common'), 20), left(r->>'system', 40), left(r->>'galaxy', 40), left(r->>'image', 200)
  FROM jsonb_array_elements(rows) r
  WHERE (r->>'tokenId') ~ '^[0-9]' AND length(r->>'tokenId') <= 6 AND (r->>'tokenId') !~ '[^0-9]'
    AND coalesce(btrim(r->>'name'), '') <> ''
  ON CONFLICT (token_id) DO UPDATE SET name = EXCLUDED.name, body_type = EXCLUDED.body_type, main_planet = EXCLUDED.main_planet,
    resource = EXCLUDED.resource, rarity = EXCLUDED.rarity, system = EXCLUDED.system, galaxy = EXCLUDED.galaxy, image = EXCLUDED.image;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'loaded', n, 'total', (SELECT count(*) FROM aquaterra_planets));
END $fn$;

-- Called by the Heritage Port when a planet swap is confirmed (the NFT reached the vault).
CREATE OR REPLACE FUNCTION aquaterra_orbit_give(tok text, who text) RETURNS boolean LANGUAGE plpgsql AS $fn$
BEGIN
  IF tok IS NULL OR tok !~ '^[0-9]' OR length(tok) > 6 OR tok ~ '[^0-9]' THEN RETURN false; END IF;
  UPDATE aquaterra_planets SET owner = who, owned_at = now(), mined_on = NULL WHERE token_id = tok::int AND owner IS NULL;
  RETURN FOUND;
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_orbit(req jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  act text := coalesce(req->>'action', '');
  me text; res jsonb := '{}'::jsonb;
  today date := (now() AT TIME ZONE 'utc')::date;
  p record; v_units bigint; v_n int; v_res text; v_price numeric; v_tide bigint; v_have bigint;
BEGIN
  IF coalesce(req->>'session', '') <> '' THEN
    SELECT s.email INTO me FROM aquaterra_sessions s
    WHERE s.token_hash = encode(sha256(convert_to(req->>'session', 'UTF8')), 'hex') AND s.expires_at > now();
  END IF;
  IF act NOT IN ('sky', 'body') AND me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401);
  END IF;

  BEGIN
    IF act = 'sky' THEN
      -- Every body once: what it orbits, its kind, resources and how many claims are home.
      res := jsonb_build_object(
        'bodies', COALESCE((SELECT jsonb_agg(jsonb_build_array(b.name, b.body_type, b.main_planet, b.claims, b.owned, b.resources, b.top, b.image)
            ORDER BY b.main_planet, b.claims DESC, b.name)
          FROM (SELECT name, min(body_type) AS body_type, min(main_planet) AS main_planet, count(*) AS claims, count(owner) AS owned,
                  jsonb_agg(DISTINCT resource) AS resources,
                  max(CASE lower(rarity) WHEN 'common' THEN 1 WHEN 'uncommon' THEN 2 WHEN 'rare' THEN 3 WHEN 'epic' THEN 4 WHEN 'legendary' THEN 5 ELSE 6 END) AS top,
                  min(image) AS image
                FROM aquaterra_planets q GROUP BY name) b), '[]'::jsonb),
        'total', (SELECT count(*) FROM aquaterra_planets),
        'owned', (SELECT count(*) FROM aquaterra_planets WHERE owner IS NOT NULL),
        'miners', (SELECT count(DISTINCT owner) FROM aquaterra_planets WHERE owner IS NOT NULL),
        'mineUnits', aquaterra_orbit_law('orbit_mine_units'),
        'collectionId', (SELECT id FROM aquaterra_nft_collections WHERE chain = 'cronos' AND contract = '0xf37a3686800a9fb19625c05e1a7acf2d232e8aa4'));

    ELSIF act = 'body' THEN
      -- The claims on one body: [token, resource, rarity, owner name or null].
      v_res := left(coalesce(req->>'name', ''), 60);
      IF NOT EXISTS (SELECT 1 FROM aquaterra_planets WHERE name = v_res) THEN RAISE EXCEPTION 'not_found'; END IF;
      res := jsonb_build_object('name', v_res,
        'claims', (SELECT jsonb_agg(jsonb_build_array(token_id, resource, rarity, CASE WHEN owner IS NOT NULL THEN aquaterra_name(owner) END,
            me IS NOT NULL AND owner = me) ORDER BY token_id) FROM aquaterra_planets WHERE name = v_res),
        'resources', (SELECT jsonb_agg(jsonb_build_object('resource', r.resource, 'claims', r.n, 'price', aquaterra_orbit_price(r.resource)) ORDER BY r.n DESC)
          FROM (SELECT resource, count(*) AS n FROM aquaterra_planets WHERE name = v_res GROUP BY resource) r));

    ELSIF act = 'me' THEN
      NULL;

    ELSIF act = 'mine' THEN
      -- Mine every claim of mine not mined today.
      v_n := 0;
      FOR p IN SELECT * FROM aquaterra_planets WHERE owner = me AND (mined_on IS NULL OR mined_on < today) ORDER BY token_id FOR UPDATE LOOP
        v_units := aquaterra_orbit_units(p.rarity);
        UPDATE aquaterra_planets SET mined_on = today WHERE token_id = p.token_id;
        CONTINUE WHEN v_units < 1;
        INSERT INTO aquaterra_orbit_holds (email, resource, units) VALUES (me, p.resource, v_units)
        ON CONFLICT (email, resource) DO UPDATE SET units = aquaterra_orbit_holds.units + EXCLUDED.units;
        INSERT INTO aquaterra_orbit_log (email, kind, resource, units) VALUES (me, 'mine', p.resource, v_units);
        v_n := v_n + 1;
      END LOOP;
      IF v_n = 0 THEN
        RAISE EXCEPTION '%', CASE WHEN EXISTS (SELECT 1 FROM aquaterra_planets WHERE owner = me) THEN 'mined_today' ELSE 'no_claims' END;
      END IF;
      res := jsonb_build_object('mined', v_n);

    ELSIF act = 'sell' THEN
      -- Sell units of one resource from my hold (all when units is not given).
      v_res := left(coalesce(req->>'resource', ''), 30);
      SELECT units INTO v_have FROM aquaterra_orbit_holds WHERE email = me AND resource = v_res FOR UPDATE;
      IF coalesce(v_have, 0) < 1 THEN RAISE EXCEPTION 'nothing'; END IF;
      v_units := CASE WHEN coalesce(req->>'units', '') ~ '^[0-9]' AND length(req->>'units') <= 12 AND (req->>'units') !~ '[^0-9]'
        THEN (req->>'units')::bigint ELSE v_have END;
      IF v_units < 1 OR v_units > v_have THEN RAISE EXCEPTION 'units'; END IF;
      v_price := aquaterra_orbit_price(v_res);
      v_tide := floor(v_units * v_price)::bigint;
      IF v_tide < 1 THEN RAISE EXCEPTION 'too_little'; END IF;
      -- Only whole Tide is paid: the units it takes are sold, the rest stays.
      v_units := least(v_units, ceil(v_tide / v_price)::bigint);
      UPDATE aquaterra_orbit_holds SET units = units - v_units WHERE email = me AND resource = v_res;
      PERFORM aquaterra_arc_pay('treasury', me, v_tide, 'income', NULL, 'Orbit: sold ' || v_units || ' ' || v_res, me,
        'orbit:sell:' || me || ':' || extract(epoch FROM clock_timestamp()));
      INSERT INTO aquaterra_orbit_log (email, kind, resource, units, tide) VALUES (me, 'sell', v_res, v_units, v_tide);
      res := jsonb_build_object('sold', v_units, 'resource', v_res, 'tide', v_tide,
        'taxPct', COALESCE((SELECT value FROM aquaterra_gov_params WHERE key = 'income_tax_pct'), 0));

    ELSE
      RAISE EXCEPTION 'action';
    END IF;

    IF act IN ('me', 'mine', 'sell') THEN
      res := res || jsonb_build_object(
        'claims', COALESCE((SELECT jsonb_agg(aquaterra_orbit_claim_json(x) ORDER BY x.main_planet, x.name, x.token_id) FROM aquaterra_planets x WHERE x.owner = me), '[]'::jsonb),
        'hold', COALESCE((SELECT jsonb_agg(jsonb_build_object('resource', h.resource, 'units', h.units, 'price', aquaterra_orbit_price(h.resource),
            'value', floor(h.units * aquaterra_orbit_price(h.resource))) ORDER BY h.resource)
          FROM aquaterra_orbit_holds h WHERE h.email = me AND h.units > 0), '[]'::jsonb),
        'log', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', l.kind, 'resource', l.resource, 'units', l.units, 'tide', l.tide, 'at', l.at) ORDER BY l.id DESC)
          FROM (SELECT * FROM aquaterra_orbit_log WHERE email = me ORDER BY id DESC LIMIT 20) l), '[]'::jsonb),
        'balance', aquaterra_balance(me),
        'resetsAt', ((today + 1)::timestamp AT TIME ZONE 'utc'));
    END IF;
    RETURN jsonb_build_object('ok', true) || res;
  EXCEPTION WHEN raise_exception OR check_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM,
      'status', CASE SQLERRM WHEN 'not_found' THEN 404 ELSE 400 END);
  END;
END $fn$;
