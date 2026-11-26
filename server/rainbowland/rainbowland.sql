-- AquaTerra World: Rainbowland. The continent of the old LAND NFTs (Cronos, "The Rainbowland",
-- contract 0x3ff260ce7a8dfcadaf5e880137ee1750ceae9889, 55,524 tokens, ids 0..55523).
-- One-off migration (run once, never per request). Safe to run again.
-- Needs the economy, governance, travel and heritage migrations.
-- n8n runs this text: no double dollar quotes (use $fn$), no positional parameters,
-- no dollar+quote pair, no apostrophes in comments.
--
-- Rules (server-authoritative; the site only asks and shows):
--  * The grid is the old one: token id t sits at x = t mod 640 - 128, y = t div 640 - 128,
--    exactly the coordinates in the token name "LAND (x, y)". Every token is one cell.
--  * A cell is fog until its LAND comes home through the Heritage Port. When the swap is
--    confirmed (the vault holds the token), the resident gets a plot at the same address,
--    "LAND (x, y), Rainbowland", and nothing else: no Heritage Reserve plot, no Tide.
--  * The plot size, its price (income is the usual daily share of price_paid) and its subsoil
--    bonus come from the rarity tier of the token. Rarity is read once from the token metadata
--    (aquaterra_rainbow_meta, loaded by a one-off n8n loader) and mapped to a tier here.
--  * The world only grows: cells, ids and addresses never change. Plot id = 1000000 + token id.
-- Public API: aquaterra_rainbow(req) {action: map | cell | me}.

CREATE TABLE IF NOT EXISTS aquaterra_rainbow_meta (
  token_id int PRIMARY KEY,
  rarity text,
  district text,
  name text
);

CREATE TABLE IF NOT EXISTS aquaterra_rainbow_tiers (
  tier text PRIMARY KEY,             -- common | rare | epic | legendary | cyber
  label text NOT NULL,
  code char(1) NOT NULL UNIQUE,      -- one letter per cell in the map string
  tiles int NOT NULL,                -- plot size in cells of the game map
  price bigint NOT NULL,             -- price_paid of the plot: its daily income follows it
  subsoil_pct int NOT NULL,          -- subsoil bonus, for mining of the elements
  sort int NOT NULL
);
INSERT INTO aquaterra_rainbow_tiers (tier, label, code, tiles, price, subsoil_pct, sort) VALUES
  ('common', 'Common', 'c', 1, 300, 0, 1),
  ('rare', 'Rare', 'r', 2, 600, 10, 2),
  ('epic', 'Epic', 'e', 3, 1000, 25, 3),
  ('legendary', 'Legendary', 'l', 4, 1600, 50, 4),
  ('cyber', 'Cyber', 'x', 6, 2500, 100, 5)
ON CONFLICT (tier) DO NOTHING;

-- Rarity name (as in the token metadata) to tier. Filled from the loaded metadata below:
-- by what the name is (see aquaterra_rainbow_name_tier). The founder can change a row.
CREATE TABLE IF NOT EXISTS aquaterra_rainbow_rarity (
  rarity text PRIMARY KEY,
  tier text NOT NULL REFERENCES aquaterra_rainbow_tiers (tier),
  tokens int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS aquaterra_rainbow_cells (
  token_id int PRIMARY KEY CHECK (token_id >= 0 AND token_id < 55524),
  x int NOT NULL,
  y int NOT NULL,
  tier text NOT NULL REFERENCES aquaterra_rainbow_tiers (tier),
  plot_id int NOT NULL UNIQUE,
  email text NOT NULL,
  swap_id bigint,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aquaterra_rainbow_cells_email ON aquaterra_rainbow_cells (email);

INSERT INTO aquaterra_heritage_settings (key, value) VALUES
  ('rainbow_contract', '0x3ff260ce7a8dfcadaf5e880137ee1750ceae9889'),
  ('rainbow_district', 'Rainbowland')
ON CONFLICT (key) DO NOTHING;

-- The LAND collection: its swap is the Rainbowland plot. No Tide instead (swap_tide 0).
UPDATE aquaterra_nft_collections SET name = 'Rainbowland LAND', kind = 'land', swap_tide = 0, allow_plot = true, enabled = true,
  note = 'The old LAND grid. Each LAND comes home as a plot at the same coordinates in Rainbowland.'
WHERE chain = 'cronos' AND contract = '0x3ff260ce7a8dfcadaf5e880137ee1750ceae9889'
  AND (name, swap_tide, enabled) IS DISTINCT FROM ('Rainbowland LAND', 0::bigint, true);

-- Rarity names in the LAND metadata are chemical elements, gems and a few words, spread
-- evenly over the tokens (about 120 names). Their tier follows what the name is, sized so
-- that about half of the land is common and few are legendary:
--   cyber:     any name with Cyber in it
--   legendary: Diamond, Legendary, Mythical, Ultra Rare, Cosmic, and the three heaviest
--              elements (Oganesson, Tennessine, Livermorium)
--   epic:      the other superheavy elements (104 to 115), Gold, Platinum, Iridium, Osmium,
--              Rhodium, Sapphire, Emerald, Ruby, Epic, Mystic, Enchanted
--   rare:      radioactive elements and actinides, Scandium, Yttrium, Cesium, Silver,
--              Palladium, Ruthenium, the other gems, Rare, Medieval
--   common:    every other element and word (Zinc, Iron, the lanthanides, Uncommon...)
-- Only names not mapped yet are added, so a change by the founder stays.
CREATE OR REPLACE FUNCTION aquaterra_rainbow_name_tier(n text) RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN n ILIKE '%cyber%' THEN 'cyber'
    WHEN lower(n) IN ('diamond', 'legendary', 'mythical', 'ultra rare', 'cosmic', 'oganesson', 'tennessine', 'livermorium') THEN 'legendary'
    WHEN lower(n) IN ('rutherfordium', 'dubnium', 'seaborgium', 'bohrium', 'hassium', 'meitnerium', 'darmstadtium',
      'roentgenium', 'copernicium', 'nihonium', 'flerovium', 'moscovium',
      'gold', 'platinum', 'iridium', 'osmium', 'rhodium', 'sapphire', 'emerald', 'ruby', 'epic', 'mystic', 'enchanted') THEN 'epic'
    WHEN lower(n) IN ('polonium', 'astatine', 'radon', 'francium', 'radium', 'actinium', 'thorium', 'protactinium', 'uranium',
      'neptunium', 'plutonium', 'americium', 'curium', 'berkelium', 'californium', 'einsteinium', 'fermium',
      'mendelevium', 'nobelium', 'lawrencium', 'technetium', 'promethium',
      'scandium', 'yttrium', 'cesium', 'caesium', 'silver', 'palladium', 'ruthenium', 'rhenium',
      'topaz', 'amber', 'citrine', 'garnet', 'zircon', 'rose quartz', 'tourmaline', 'amethyst', 'opal', 'jade',
      'pearl', 'onyx', 'quartz', 'aquamarine', 'peridot', 'rare', 'medieval') THEN 'rare'
    ELSE 'common' END
$fn$;

INSERT INTO aquaterra_rainbow_rarity (rarity, tier, tokens)
SELECT rarity, aquaterra_rainbow_name_tier(rarity), count(*)::int
FROM aquaterra_rainbow_meta WHERE coalesce(rarity, '') <> '' GROUP BY rarity
ON CONFLICT (rarity) DO UPDATE SET tokens = EXCLUDED.tokens WHERE aquaterra_rainbow_rarity.tokens <> EXCLUDED.tokens;

-- Rarities mapped by earlier rules on 2026-11-26 (before any LAND was swapped): put them on
-- the current rule once. Guarded so later founder edits stay.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM aquaterra_heritage_settings WHERE key = 'rainbow_tiers_v2') THEN
    UPDATE aquaterra_rainbow_rarity SET tier = aquaterra_rainbow_name_tier(rarity);
    INSERT INTO aquaterra_heritage_settings (key, value) VALUES ('rainbow_tiers_v2', 'yes');
  END IF;
END $do$;

CREATE OR REPLACE FUNCTION aquaterra_rainbow_tier(t int) RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT coalesce((SELECT coalesce(r.tier, aquaterra_rainbow_name_tier(m.rarity))
                   FROM aquaterra_rainbow_meta m LEFT JOIN aquaterra_rainbow_rarity r ON r.rarity = m.rarity
                   WHERE m.token_id = t AND coalesce(m.rarity, '') <> ''), 'common')
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_rainbow_x(t int) RETURNS int LANGUAGE sql IMMUTABLE AS $fn$ SELECT t % 640 - 128 $fn$;
CREATE OR REPLACE FUNCTION aquaterra_rainbow_y(t int) RETURNS int LANGUAGE sql IMMUTABLE AS $fn$ SELECT t / 640 - 128 $fn$;

-- Gives the resident the Rainbowland plot of one token. Returns the plot id.
CREATE OR REPLACE FUNCTION aquaterra_rainbow_grant(who text, t int, v_swap bigint) RETURNS int LANGUAGE plpgsql AS $fn$
DECLARE c aquaterra_rainbow_cells; tr aquaterra_rainbow_tiers; v_plot int := 1000000 + t; x int; y int;
BEGIN
  SELECT * INTO c FROM aquaterra_rainbow_cells WHERE token_id = t FOR UPDATE;
  IF c.token_id IS NOT NULL THEN
    -- Each token comes home once. A second confirm of the same swap is harmless.
    IF c.email = who THEN RETURN c.plot_id; END IF;
    RAISE EXCEPTION 'cell_taken';
  END IF;
  SELECT * INTO tr FROM aquaterra_rainbow_tiers WHERE tier = aquaterra_rainbow_tier(t);
  x := aquaterra_rainbow_x(t); y := aquaterra_rainbow_y(t);
  INSERT INTO aquaterra_plots (id, address, district, tiles, price)
  VALUES (v_plot, 'LAND (' || x || ', ' || y || '), Rainbowland', aquaterra_hs('rainbow_district'), tr.tiles, tr.price)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO aquaterra_wallets (account) VALUES (who) ON CONFLICT DO NOTHING;
  INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid) VALUES (v_plot, who, tr.price)
  ON CONFLICT (plot_id) DO UPDATE SET owner = EXCLUDED.owner, price_paid = EXCLUDED.price_paid, bought_at = now(), income_from = now();
  INSERT INTO aquaterra_rainbow_cells (token_id, x, y, tier, plot_id, email, swap_id) VALUES (t, x, y, tr.tier, v_plot, who, v_swap);
  RETURN v_plot;
END $fn$;

-- When the Heritage Port completes a swap of a LAND token, the result is the Rainbowland plot.
-- A trigger, so it holds whatever the swap code does: a Heritage Reserve plot it picked goes
-- back to the reserve, and Tide is never paid (the collection has swap_tide 0).
CREATE OR REPLACE FUNCTION aquaterra_rainbow_on_swap() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE col aquaterra_nft_collections; t int;
BEGIN
  IF NOT (OLD.status = 'open' AND NEW.status = 'done') THEN RETURN NEW; END IF;
  SELECT * INTO col FROM aquaterra_nft_collections WHERE id = NEW.collection_id;
  IF col.chain <> 'cronos' OR col.contract <> aquaterra_hs('rainbow_contract') THEN RETURN NEW; END IF;
  IF NEW.token_id = '' OR length(NEW.token_id) > 6 OR NEW.token_id ~ '[^0-9]' THEN RAISE EXCEPTION 'token'; END IF;
  t := NEW.token_id::int;
  IF t >= 55524 THEN RAISE EXCEPTION 'token'; END IF;
  IF NEW.plot_id IS NOT NULL AND NEW.plot_id < 1000000 THEN
    UPDATE aquaterra_plot_owners SET owner = 'heritage:reserve', price_paid = 0
    WHERE plot_id = NEW.plot_id AND owner = NEW.email;
  END IF;
  NEW.plot_id := aquaterra_rainbow_grant(NEW.email, t, NEW.id);
  NEW.choice := 'plot';
  NEW.tide := 0;
  NEW.reason := 'Rainbowland';
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS aquaterra_rainbow_swap ON aquaterra_nft_swaps;
CREATE TRIGGER aquaterra_rainbow_swap BEFORE UPDATE OF status ON aquaterra_nft_swaps
  FOR EACH ROW EXECUTE FUNCTION aquaterra_rainbow_on_swap();

-- Rainbowland on the map of districts, with its harbour, station and the Rainbow Bridge.
-- District 1000 (far from the generated ids). The site writes the same into districts.json and
-- travel.json, so the hourly syncs keep them.
INSERT INTO aquaterra_districts (id, name, biome, land)
VALUES (1000, 'Rainbowland', 'rainbow', 'Rainbowland') ON CONFLICT (id) DO NOTHING;

-- The tier letter of every cell, in token order: the map of Rainbowland in one string.
CREATE OR REPLACE FUNCTION aquaterra_rainbow_tiles() RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT string_agg(coalesce(tr.code, '?'), '' ORDER BY g.t)
  FROM generate_series(0, 55523) g(t)
  LEFT JOIN aquaterra_rainbow_meta m ON m.token_id = g.t AND coalesce(m.rarity, '') <> ''
  LEFT JOIN aquaterra_rainbow_rarity r ON r.rarity = m.rarity
  LEFT JOIN aquaterra_rainbow_tiers tr ON tr.tier = coalesce(r.tier, CASE WHEN m.token_id IS NOT NULL THEN aquaterra_rainbow_name_tier(m.rarity) END)
$fn$;

-- The cached map string: rarities never change, so it is kept and rebuilt only when the
-- rarity loader adds names (it clears the cache) or the migration runs again.
CREATE TABLE IF NOT EXISTS aquaterra_rainbow_cache (key text PRIMARY KEY, value text NOT NULL, built_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION aquaterra_rainbow_tiles_cached() RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  SELECT value INTO v FROM aquaterra_rainbow_cache WHERE key = 'tiles';
  IF v IS NULL THEN
    v := aquaterra_rainbow_tiles();
    INSERT INTO aquaterra_rainbow_cache (key, value) VALUES ('tiles', v) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, built_at = now();
  END IF;
  RETURN v;
END $fn$;
DELETE FROM aquaterra_rainbow_cache WHERE key = 'tiles';

-- The public API. req: {action, session?, token?}.
CREATE OR REPLACE FUNCTION aquaterra_rainbow(req jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  act text := req->>'action';
  me text; t int; c aquaterra_rainbow_cells; m aquaterra_rainbow_meta; tr aquaterra_rainbow_tiers;
BEGIN
  IF coalesce(req->>'session', '') <> '' THEN
    SELECT s.email INTO me FROM aquaterra_sessions s
    WHERE s.token_hash = encode(sha256(convert_to(req->>'session', 'UTF8')), 'hex') AND s.expires_at > now();
  END IF;

  IF act = 'map' THEN
    RETURN jsonb_build_object('ok', true, 'status', 200,
      'cols', 640, 'rows', 87, 'x0', -128, 'y0', -128, 'total', 55524,
      'tiles', aquaterra_rainbow_tiles_cached(),
      'tiers', (SELECT jsonb_agg(jsonb_build_object('tier', tier, 'label', label, 'code', code, 'tiles', tiles,
                  'price', price, 'subsoilPct', subsoil_pct) ORDER BY sort) FROM aquaterra_rainbow_tiers),
      'claimed', coalesce((SELECT jsonb_agg(jsonb_build_array(c2.token_id, aquaterra_name(c2.email), (c2.email = me)) ORDER BY c2.token_id)
                  FROM aquaterra_rainbow_cells c2), '[]'::jsonb),
      'swapFee', (SELECT value FROM aquaterra_gov_params WHERE key = 'nft_swap_fee'));

  ELSIF act = 'cell' THEN
    IF coalesce(req->>'token', '') ~ '[^0-9]' OR coalesce(req->>'token', '') = '' OR length(req->>'token') > 6 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'token', 'status', 400);
    END IF;
    t := (req->>'token')::int;
    IF t >= 55524 THEN RETURN jsonb_build_object('ok', false, 'error', 'token', 'status', 400); END IF;
    SELECT * INTO c FROM aquaterra_rainbow_cells WHERE token_id = t;
    SELECT * INTO m FROM aquaterra_rainbow_meta WHERE token_id = t;
    SELECT * INTO tr FROM aquaterra_rainbow_tiers WHERE tier = coalesce(c.tier, aquaterra_rainbow_tier(t));
    RETURN jsonb_build_object('ok', true, 'status', 200, 'cell', jsonb_build_object(
      'token', t, 'x', aquaterra_rainbow_x(t), 'y', aquaterra_rainbow_y(t),
      'rarity', m.rarity, 'oldDistrict', m.district, 'tier', tr.tier, 'tiles', tr.tiles, 'price', tr.price, 'subsoilPct', tr.subsoil_pct,
      'claimed', c.token_id IS NOT NULL, 'owner', CASE WHEN c.token_id IS NOT NULL THEN aquaterra_name(c.email) END,
      'mine', c.token_id IS NOT NULL AND c.email = me, 'plotId', c.plot_id, 'since', c.claimed_at));

  ELSIF act = 'me' THEN
    IF me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401); END IF;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'cells',
      coalesce((SELECT jsonb_agg(jsonb_build_object('token', token_id, 'x', x, 'y', y, 'tier', tier, 'plotId', plot_id) ORDER BY token_id)
                FROM aquaterra_rainbow_cells WHERE email = me), '[]'::jsonb));
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'action', 'status', 400);
END $fn$;
