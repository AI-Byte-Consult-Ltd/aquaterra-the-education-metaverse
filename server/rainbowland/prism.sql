-- AquaTerra World: Prism Hills. The continent of the LAND NFTs on Polygon ("The Rainbowland",
-- symbol LAND, contract 0x1e0b16b9a4c072fc81e015a3757f6685edb1ccda, 90,000 tokens, ids 1..90000).
-- One-off migration (run once, never per request). Safe to run again. Needs rainbowland.sql.
-- n8n runs this text: no double dollar quotes (use $fn$), no positional parameters,
-- no dollar+quote pair, no apostrophes in comments.
--
-- Rules (server-authoritative; the site only asks and shows):
--  * The metadata of these tokens has no coordinates and no rarity, so this is a new grid of
--    its own beside Rainbowland: token t sits at x = (t - 1) mod 300, y = (t - 1) div 300,
--    address "Parcel (x, y), Prism Hills". It never overlaps the Cronos LAND.
--  * A cell is fog until its LAND comes home through the Heritage Port; then the resident gets
--    the plot at that address and nothing else: no Heritage Reserve plot, no Tide.
--  * Plots are small: 1 to 3 cells, fixed by the token number (aquaterra_prism_size), worth
--    200 Tide per cell. No subsoil bonus. No houses: hills and a ragged harbour.
--  * The world only grows: cells, ids and addresses never change. Plot id = 3000000 + token id.
-- Public API: aquaterra_prism(req) {action: map | cell | me}.

INSERT INTO aquaterra_heritage_settings (key, value) VALUES
  ('prism_contract', '0x1e0b16b9a4c072fc81e015a3757f6685edb1ccda'),
  ('prism_district', 'Prism Hills')
ON CONFLICT (key) DO NOTHING;

INSERT INTO aquaterra_nft_collections (chain, contract, name, kind, swap_tide, allow_plot, enabled, note)
VALUES ('polygon', '0x1e0b16b9a4c072fc81e015a3757f6685edb1ccda', 'Prism Hills LAND', 'land', 0, true, true,
  'LAND on Polygon. Each token comes home as a small plot of its own in Prism Hills, beside Rainbowland.')
ON CONFLICT (chain, contract) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, swap_tide = 0, allow_plot = true, enabled = true, note = EXCLUDED.note
WHERE (aquaterra_nft_collections.name, aquaterra_nft_collections.swap_tide, aquaterra_nft_collections.enabled) IS DISTINCT FROM (EXCLUDED.name, 0::bigint, true);

CREATE TABLE IF NOT EXISTS aquaterra_prism_cells (
  token_id int PRIMARY KEY CHECK (token_id >= 1 AND token_id <= 90000),
  x int NOT NULL,
  y int NOT NULL,
  tiles int NOT NULL,
  plot_id int NOT NULL UNIQUE,
  email text NOT NULL,
  swap_id bigint,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aquaterra_prism_cells_email ON aquaterra_prism_cells (email);

-- Plot size 1..3 from the token number: about 60% one cell, 30% two, 10% three.
-- The site has the same rule (src/game/rainbowland/prism.ts, prismSize).
CREATE OR REPLACE FUNCTION aquaterra_prism_size(t int) RETURNS int LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN h < 60 THEN 1 WHEN h < 90 THEN 2 ELSE 3 END
  FROM (SELECT ((t::bigint * 2654435761) % 4294967296) % 100 AS h) z
$fn$;
CREATE OR REPLACE FUNCTION aquaterra_prism_x(t int) RETURNS int LANGUAGE sql IMMUTABLE AS $fn$ SELECT (t - 1) % 300 $fn$;
CREATE OR REPLACE FUNCTION aquaterra_prism_y(t int) RETURNS int LANGUAGE sql IMMUTABLE AS $fn$ SELECT (t - 1) / 300 $fn$;

-- Gives the resident the Prism Hills plot of one token. Returns the plot id.
CREATE OR REPLACE FUNCTION aquaterra_prism_grant(who text, t int, v_swap bigint) RETURNS int LANGUAGE plpgsql AS $fn$
DECLARE c aquaterra_prism_cells; v_plot int := 3000000 + t; k int := aquaterra_prism_size(t); x int; y int;
BEGIN
  SELECT * INTO c FROM aquaterra_prism_cells WHERE token_id = t FOR UPDATE;
  IF c.token_id IS NOT NULL THEN
    IF c.email = who THEN RETURN c.plot_id; END IF;
    RAISE EXCEPTION 'cell_taken';
  END IF;
  x := aquaterra_prism_x(t); y := aquaterra_prism_y(t);
  INSERT INTO aquaterra_plots (id, address, district, tiles, price)
  VALUES (v_plot, 'Parcel (' || x || ', ' || y || '), Prism Hills', aquaterra_hs('prism_district'), k, k * 200)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO aquaterra_wallets (account) VALUES (who) ON CONFLICT DO NOTHING;
  INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid) VALUES (v_plot, who, k * 200)
  ON CONFLICT (plot_id) DO UPDATE SET owner = EXCLUDED.owner, price_paid = EXCLUDED.price_paid, bought_at = now(), income_from = now();
  INSERT INTO aquaterra_prism_cells (token_id, x, y, tiles, plot_id, email, swap_id) VALUES (t, x, y, k, v_plot, who, v_swap);
  RETURN v_plot;
END $fn$;

-- When the Heritage Port completes a swap of a Polygon LAND token, the result is the Prism Hills plot.
CREATE OR REPLACE FUNCTION aquaterra_prism_on_swap() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE col aquaterra_nft_collections; t int;
BEGIN
  IF NOT (OLD.status = 'open' AND NEW.status = 'done') THEN RETURN NEW; END IF;
  SELECT * INTO col FROM aquaterra_nft_collections WHERE id = NEW.collection_id;
  IF col.chain <> 'polygon' OR col.contract <> aquaterra_hs('prism_contract') THEN RETURN NEW; END IF;
  IF NEW.token_id = '' OR length(NEW.token_id) > 6 OR NEW.token_id ~ '[^0-9]' THEN RAISE EXCEPTION 'token'; END IF;
  t := NEW.token_id::int;
  IF t < 1 OR t > 90000 THEN RAISE EXCEPTION 'token'; END IF;
  IF NEW.plot_id IS NOT NULL AND NEW.plot_id < 1000000 THEN
    UPDATE aquaterra_plot_owners SET owner = 'heritage:reserve', price_paid = 0
    WHERE plot_id = NEW.plot_id AND owner = NEW.email;
  END IF;
  NEW.plot_id := aquaterra_prism_grant(NEW.email, t, NEW.id);
  NEW.choice := 'plot';
  NEW.tide := 0;
  NEW.reason := 'Prism Hills';
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS aquaterra_prism_swap ON aquaterra_nft_swaps;
CREATE TRIGGER aquaterra_prism_swap BEFORE UPDATE OF status ON aquaterra_nft_swaps
  FOR EACH ROW EXECUTE FUNCTION aquaterra_prism_on_swap();

INSERT INTO aquaterra_districts (id, name, biome, land)
VALUES (1001, 'Prism Hills', 'hills', 'Prism Hills') ON CONFLICT (id) DO NOTHING;

-- The public API. req: {action, session?, token?}.
CREATE OR REPLACE FUNCTION aquaterra_prism(req jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  act text := req->>'action';
  me text; t int; c aquaterra_prism_cells; k int;
BEGIN
  IF coalesce(req->>'session', '') <> '' THEN
    SELECT s.email INTO me FROM aquaterra_sessions s
    WHERE s.token_hash = encode(sha256(convert_to(req->>'session', 'UTF8')), 'hex') AND s.expires_at > now();
  END IF;

  IF act = 'map' THEN
    RETURN jsonb_build_object('ok', true, 'status', 200, 'cols', 300, 'rows', 300, 'total', 90000, 'pricePerCell', 200,
      'claimed', coalesce((SELECT jsonb_agg(jsonb_build_array(c2.token_id, aquaterra_name(c2.email), coalesce(c2.email = me, false)) ORDER BY c2.token_id)
                  FROM aquaterra_prism_cells c2), '[]'::jsonb),
      'swapFee', (SELECT value FROM aquaterra_gov_params WHERE key = 'nft_swap_fee'));

  ELSIF act = 'cell' THEN
    IF coalesce(req->>'token', '') ~ '[^0-9]' OR coalesce(req->>'token', '') = '' OR length(req->>'token') > 6 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'token', 'status', 400);
    END IF;
    t := (req->>'token')::int;
    IF t < 1 OR t > 90000 THEN RETURN jsonb_build_object('ok', false, 'error', 'token', 'status', 400); END IF;
    SELECT * INTO c FROM aquaterra_prism_cells WHERE token_id = t;
    k := aquaterra_prism_size(t);
    RETURN jsonb_build_object('ok', true, 'status', 200, 'cell', jsonb_build_object(
      'token', t, 'x', aquaterra_prism_x(t), 'y', aquaterra_prism_y(t), 'tiles', k, 'price', k * 200,
      'claimed', c.token_id IS NOT NULL, 'owner', CASE WHEN c.token_id IS NOT NULL THEN aquaterra_name(c.email) END,
      'mine', c.token_id IS NOT NULL AND c.email = me, 'plotId', c.plot_id, 'since', c.claimed_at));

  ELSIF act = 'me' THEN
    IF me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401); END IF;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'cells',
      coalesce((SELECT jsonb_agg(jsonb_build_object('token', token_id, 'x', x, 'y', y, 'tiles', tiles, 'plotId', plot_id) ORDER BY token_id)
                FROM aquaterra_prism_cells WHERE email = me), '[]'::jsonb));
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'action', 'status', 400);
END $fn$;

SELECT (SELECT name || '|' || chain || '|' || swap_tide || '|' || enabled FROM aquaterra_nft_collections WHERE contract = '0x1e0b16b9a4c072fc81e015a3757f6685edb1ccda') AS col,
  (SELECT count(*) FROM aquaterra_prism_cells) AS claimed;
