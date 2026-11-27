-- AquaTerra World: Heritage Port. Old NFTs (LAND, houses, cars, assets from the first
-- AquaTerra on Cronos, Polygon, Ethereum and Bitcoin) come home as new land or Tide.
-- One-off migration (run once, never per request). Safe to run again.
-- Needs the account, economy, governance and exchange migrations.
-- n8n runs this text: no double dollar quotes (use $fn$), no positional parameters,
-- no dollar+quote pair, no apostrophes in comments.
--
-- Rules (server-authoritative; the site only asks and shows):
--  * A resident links a wallet by signing a one-time message (personal_sign). n8n recovers
--    the address from the signature and passes it as req.verified; the browser cannot.
--    The same signed message can sign a resident in (wallet login) once a wallet is linked.
--  * Collections are listed by the founder in /admin, per chain. Only enabled collections swap.
--    Collections of kind tower (First Light Tower = Radiant Residences, Second Light Tower =
--    Radiant Residences Tower 2, both on Cronos) swap 1:1: token N becomes apartment N of that
--    tower in the game, with its floor, number, type, view and size from the NFT metadata
--    (loaded once by n8n into aquaterra_apartments). An apartment earns Tide every day.
--  * A swap: the resident names a token and chooses a plot in the Heritage district or Tide.
--    n8n asks the chain ownerOf(token); if it is one of the residents linked wallets the swap
--    opens and the swap fee (law nft_swap_fee) goes to the State Treasury. The resident then
--    sends the NFT to the vault address; when ownerOf says the vault holds it, the resident
--    gets the plot (from the Heritage Reserve, earning income like a bought plot) or Tide
--    (from the Reserve). A cancelled open swap gets its fee back.
--  * The fee is built so the welcome 1,000 TIDE pays for one swap but not two. Tide received
--    from swaps can buy land but cannot pay swap fees or be sent to anyone (aquaterra_locked).
--  * Each token swaps once. If the token changes hands while a swap is open, the new owner
--    proving ownership takes the token over and the old swap is cancelled with its fee back.
-- Public API: aquaterra_heritage(req). Internal API for n8n only: aquaterra_heritage_internal(req).

CREATE TABLE IF NOT EXISTS aquaterra_nft_chains (
  id text PRIMARY KEY,               -- cronos | polygon | ethereum | bitcoin
  name text NOT NULL,
  family text NOT NULL,              -- evm | btc
  chain_id int,
  rpc text,
  explorer text,
  enabled boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 0
);
INSERT INTO aquaterra_nft_chains (id, name, family, chain_id, rpc, explorer, enabled, sort) VALUES
  ('cronos', 'Cronos', 'evm', 25, 'https://evm.cronos.org', 'https://explorer.cronos.org', true, 1),
  ('polygon', 'Polygon', 'evm', 137, 'https://polygon-bor-rpc.publicnode.com', 'https://polygonscan.com', true, 2),
  ('ethereum', 'Ethereum', 'evm', 1, 'https://ethereum-rpc.publicnode.com', 'https://etherscan.io', true, 3),
  ('bitcoin', 'Bitcoin', 'btc', NULL, NULL, 'https://ordinals.com', false, 4)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS aquaterra_nft_collections (
  id serial PRIMARY KEY,
  chain text NOT NULL REFERENCES aquaterra_nft_chains (id),
  contract text NOT NULL,            -- lower case 0x address (EVM) or collection id (Bitcoin)
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'asset', -- land | house | car | asset | tower | planet
  standard text NOT NULL DEFAULT 'erc721',
  swap_tide bigint NOT NULL DEFAULT 0,  -- Tide paid instead of a plot
  allow_plot boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT false,
  note text,
  UNIQUE (chain, contract)
);
INSERT INTO aquaterra_nft_collections (chain, contract, name, kind, swap_tide, allow_plot, enabled, note) VALUES
  ('cronos', '0x3720cde69e4e997bbdeaec7b4e7b5f8c3c406869', 'First Light Tower (Radiant Residences)', 'tower', 0, false, true,
   'Kept on Cronos: 1,200 apartments on 108 floors. Not swapped.'),
  ('cronos', '0x3ff260ce7a8dfcadaf5e880137ee1750ceae9889', 'Cronos collection 0x3ff2 (to confirm)', 'land', 800, true, false,
   'Found in an old diagnostic; the founder confirms what it is before switching it on.'),
  ('cronos', '0xb4b898ee60185facc247aadb8d061661590f167f', 'Cronos collection 0xb4b8 (to confirm)', 'asset', 500, true, false,
   'Found in an old diagnostic; the founder confirms what it is before switching it on.')
ON CONFLICT (chain, contract) DO NOTHING;

CREATE TABLE IF NOT EXISTS aquaterra_heritage_settings (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
-- The vault: where residents send old NFTs. Starts as the project wallet used for crypto payments.
INSERT INTO aquaterra_heritage_settings (key, value)
SELECT 'vault_address', value FROM aquaterra_exchange_settings WHERE key = 'deposit_address'
ON CONFLICT (key) DO NOTHING;
INSERT INTO aquaterra_heritage_settings (key, value) VALUES ('heritage_district', 'Driftstone Isles') ON CONFLICT (key) DO NOTHING;

INSERT INTO aquaterra_gov_params (key, value, min_value, max_value, label) VALUES
  ('nft_swap_fee', 600, 0, 1000000, 'Heritage Port: fee to swap one old NFT, TIDE (to the State Treasury)'),
  ('nft_swap_enabled', 1, 0, 1, 'Heritage Port: swaps open (1) or closed (0)')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS aquaterra_wallet_links (
  chain_family text NOT NULL,        -- evm | btc
  address text NOT NULL,             -- lower case
  email text NOT NULL REFERENCES aquaterra_players (email),
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_family, address)
);
CREATE INDEX IF NOT EXISTS aquaterra_wallet_links_email ON aquaterra_wallet_links (email);

CREATE TABLE IF NOT EXISTS aquaterra_wallet_challenges (
  nonce text PRIMARY KEY,
  purpose text NOT NULL,             -- link | login
  email text,                        -- set for link
  address text NOT NULL,
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS aquaterra_nft_swaps (
  id bigserial PRIMARY KEY,
  email text NOT NULL REFERENCES aquaterra_players (email),
  collection_id int NOT NULL REFERENCES aquaterra_nft_collections (id),
  token_id text NOT NULL,            -- decimal
  choice text NOT NULL,              -- plot | tide | apartment | planet | item
  status text NOT NULL DEFAULT 'checking', -- checking | open | done | rejected | cancelled
  owner_address text,                -- the linked wallet that held it when the swap opened
  fee bigint NOT NULL DEFAULT 0,
  plot_id int,
  tide bigint NOT NULL DEFAULT 0,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  opened_at timestamptz,
  done_at timestamptz
);
CREATE INDEX IF NOT EXISTS aquaterra_nft_swaps_email ON aquaterra_nft_swaps (email);
CREATE UNIQUE INDEX IF NOT EXISTS aquaterra_nft_swaps_once ON aquaterra_nft_swaps (collection_id, token_id) WHERE status = 'done';

INSERT INTO aquaterra_wallets (account, welcomed_at) VALUES ('heritage:reserve', now()) ON CONFLICT DO NOTHING;

-- The two towers: every NFT of the tower collection is one apartment here.
CREATE TABLE IF NOT EXISTS aquaterra_towers (
  id text PRIMARY KEY,               -- first-light | second-light
  name text NOT NULL,
  collection_id int NOT NULL UNIQUE REFERENCES aquaterra_nft_collections (id),
  plot_id int,                       -- the plot it stands on (null: the tower plaza)
  sort int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS aquaterra_apartments (
  tower text NOT NULL REFERENCES aquaterra_towers (id),
  token_id int NOT NULL,
  floor int NOT NULL,
  number text NOT NULL,
  apt_type text NOT NULL,            -- Residential, Office, Store, Penthouse, Parking Lot ...
  view text,
  area int,                          -- square metres
  bedrooms int,
  rooms int,
  image text,
  owner text REFERENCES aquaterra_players (email),
  owned_at timestamptz,
  income_from timestamptz,
  PRIMARY KEY (tower, token_id)
);
CREATE INDEX IF NOT EXISTS aquaterra_apartments_owner ON aquaterra_apartments (owner) WHERE owner IS NOT NULL;
CREATE INDEX IF NOT EXISTS aquaterra_apartments_floor ON aquaterra_apartments (tower, floor);

UPDATE aquaterra_nft_collections SET name = 'First Light Tower (Radiant Residences)', kind = 'tower', swap_tide = 0, allow_plot = false,
  enabled = true, note = '1,200 apartments on 108 floors. Each NFT becomes the same apartment in the First Light Tower.'
WHERE chain = 'cronos' AND contract = '0x3720cde69e4e997bbdeaec7b4e7b5f8c3c406869';
UPDATE aquaterra_nft_collections SET name = 'Second Light Tower (Radiant Residences - Tower 2)', kind = 'tower', swap_tide = 0, allow_plot = false,
  enabled = true, note = '2,002 apartments. Each NFT becomes the same apartment in the Second Light Tower by the lake.'
WHERE chain = 'cronos' AND contract = '0xb4b898ee60185facc247aadb8d061661590f167f' AND kind <> 'tower';
INSERT INTO aquaterra_towers (id, name, collection_id, plot_id, sort)
SELECT 'first-light', 'First Light Tower', id, NULL, 1 FROM aquaterra_nft_collections
WHERE chain = 'cronos' AND contract = '0x3720cde69e4e997bbdeaec7b4e7b5f8c3c406869' ON CONFLICT (id) DO NOTHING;
INSERT INTO aquaterra_towers (id, name, collection_id, plot_id, sort)
SELECT 'second-light', 'Second Light Tower', id, 44, 2 FROM aquaterra_nft_collections
WHERE chain = 'cronos' AND contract = '0xb4b898ee60185facc247aadb8d061661590f167f' ON CONFLICT (id) DO NOTHING;
-- 13 Velvet Highway by the lake is the site of the Second Light Tower: not for sale.
INSERT INTO aquaterra_wallets (account, welcomed_at) VALUES ('state:towers', now()) ON CONFLICT DO NOTHING;
INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid)
SELECT 44, 'state:towers', 0 WHERE EXISTS (SELECT 1 FROM aquaterra_plots WHERE id = 44)
  AND NOT EXISTS (SELECT 1 FROM aquaterra_plot_owners WHERE plot_id = 44)
ON CONFLICT DO NOTHING;

INSERT INTO aquaterra_gov_params (key, value, min_value, max_value, label) VALUES
  ('apartment_income', 3, 0, 1000, 'Towers: Tide a day one apartment earns (stores and offices x2, penthouses x5, parking x0.5)')
ON CONFLICT (key) DO NOTHING;

DO $do$
DECLARE src text; anchor text := 'WHEN acct IS NULL THEN NULL';
BEGIN
  src := pg_get_functiondef('aquaterra_name(text)'::regprocedure);
  IF position('heritage:reserve' IN src) > 0 THEN RETURN; END IF;
  IF position(anchor IN src) = 0 THEN RAISE EXCEPTION 'name patch: anchor not found'; END IF;
  src := replace(src, anchor, anchor || E'\n    WHEN acct = ''heritage:reserve'' THEN ''Heritage Reserve''');
  EXECUTE src;
END $do$;

DO $do$
DECLARE src text; anchor text := 'WHEN acct IS NULL THEN NULL';
BEGIN
  src := pg_get_functiondef('aquaterra_name(text)'::regprocedure);
  IF position('state:towers' IN src) > 0 THEN RETURN; END IF;
  IF position(anchor IN src) = 0 THEN RAISE EXCEPTION 'name patch: anchor not found'; END IF;
  src := replace(src, anchor, anchor || E'\n    WHEN acct = ''state:towers'' THEN ''Second Light Tower''');
  EXECUTE src;
END $do$;

-- Tide from swaps that is still locked: spending on land uses welcome coins first (the part
-- not already spent on swap fees), then swap Tide.
CREATE OR REPLACE FUNCTION aquaterra_swap_locked(acct text) RETURNS bigint LANGUAGE sql STABLE AS $fn$
  WITH t AS (SELECT
    COALESCE(sum(amount) FILTER (WHERE kind = 'welcome' AND to_account = acct), 0) AS w,
    COALESCE(sum(amount) FILTER (WHERE kind = 'nft_swap_tide' AND to_account = acct), 0) AS c,
    COALESCE(sum(amount) FILTER (WHERE kind = 'plot_purchase' AND from_account = acct), 0) AS p,
    COALESCE(sum(amount) FILTER (WHERE kind = 'nft_swap_fee' AND from_account = acct), 0)
      - COALESCE(sum(amount) FILTER (WHERE kind = 'nft_swap_refund' AND to_account = acct), 0) AS f
    FROM aquaterra_ledger WHERE (to_account = acct OR from_account = acct)
      AND kind IN ('welcome', 'nft_swap_tide', 'plot_purchase', 'nft_swap_fee', 'nft_swap_refund'))
  SELECT greatest(0, c - greatest(0, p - greatest(0, w - f)))::bigint FROM t
$fn$;

-- Coins that cannot be sent on: welcome coins not yet spent on land or swap fees, plus swap Tide.
-- Replaces the economy version once (it must still have its original shape).
DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('aquaterra_locked(text)'::regprocedure);
  IF position('aquaterra_swap_locked' IN src) > 0 THEN RETURN; END IF;
  IF position('kind = ''plot_purchase'' AND from_account = acct' IN src) = 0 OR position('nft_swap' IN src) > 0 THEN
    RAISE EXCEPTION 'locked patch: aquaterra_locked has changed, review by hand';
  END IF;
  EXECUTE $q$
CREATE OR REPLACE FUNCTION aquaterra_locked(acct text) RETURNS bigint LANGUAGE sql STABLE AS $b$
  SELECT (greatest(0,
    COALESCE((SELECT sum(amount) FROM aquaterra_ledger WHERE kind = 'welcome' AND to_account = acct), 0)
    - COALESCE((SELECT sum(amount) FROM aquaterra_ledger WHERE kind = 'plot_purchase' AND from_account = acct), 0)
    - COALESCE((SELECT sum(amount) FROM aquaterra_ledger WHERE kind = 'nft_swap_fee' AND from_account = acct), 0)
    + COALESCE((SELECT sum(amount) FROM aquaterra_ledger WHERE kind = 'nft_swap_refund' AND to_account = acct), 0))
    + aquaterra_swap_locked(acct))::bigint
$b$ $q$;
END $do$;

CREATE OR REPLACE FUNCTION aquaterra_hs(k text) RETURNS text LANGUAGE sql STABLE AS
$fn$ SELECT value FROM aquaterra_heritage_settings WHERE key = k $fn$;
CREATE OR REPLACE FUNCTION aquaterra_hlaw(k text) RETURNS bigint LANGUAGE sql STABLE AS
$fn$ SELECT COALESCE((SELECT value FROM aquaterra_gov_params WHERE key = k), 0)::bigint $fn$;

CREATE OR REPLACE FUNCTION aquaterra_h_swap_json(s aquaterra_nft_swaps) RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('id', s.id, 'collectionId', s.collection_id, 'collection', c.name, 'chain', c.chain,
    'contract', c.contract, 'tokenId', s.token_id, 'choice', s.choice, 'status', s.status, 'fee', s.fee,
    'plotId', s.plot_id, 'plotAddress', p.address, 'tide', s.tide, 'reason', s.reason, 'owner', s.owner_address,
    'createdAt', s.created_at, 'doneAt', s.done_at,
    'apartment', CASE WHEN a.tower IS NOT NULL THEN jsonb_build_object('tower', a.tower, 'towerName', tw.name, 'floor', a.floor, 'number', a.number, 'type', a.apt_type) END)
  FROM aquaterra_nft_collections c LEFT JOIN aquaterra_plots p ON p.id = s.plot_id
  LEFT JOIN aquaterra_towers tw ON tw.collection_id = c.id
  LEFT JOIN aquaterra_apartments a ON a.tower = tw.id AND s.choice = 'apartment' AND a.token_id::text = s.token_id
  WHERE c.id = s.collection_id
$fn$;

-- Tide a day one apartment earns, by its type (law apartment_income).
CREATE OR REPLACE FUNCTION aquaterra_apt_rate(t text) RETURNS numeric LANGUAGE sql STABLE AS
$fn$ SELECT aquaterra_hlaw('apartment_income') * CASE WHEN t ILIKE '%penthouse%' THEN 5 WHEN t ILIKE '%parking%' THEN 0.5
  WHEN t ILIKE '%office%' OR t ILIKE '%store%' OR t ILIKE '%shop%' OR t ILIKE '%commercial%' THEN 2 ELSE 1 END $fn$;
CREATE OR REPLACE FUNCTION aquaterra_apt_pending(a aquaterra_apartments) RETURNS bigint LANGUAGE sql STABLE AS
$fn$ SELECT CASE WHEN a.owner IS NULL OR a.income_from IS NULL THEN 0 ELSE
  floor(aquaterra_apt_rate(a.apt_type) * least(extract(epoch FROM now() - a.income_from) / 86400.0, 30))::bigint END $fn$;
CREATE OR REPLACE FUNCTION aquaterra_apt_json(a aquaterra_apartments) RETURNS jsonb LANGUAGE sql STABLE AS
$fn$ SELECT jsonb_build_object('tower', a.tower, 'towerName', (SELECT name FROM aquaterra_towers WHERE id = a.tower), 'tokenId', a.token_id,
  'floor', a.floor, 'number', a.number, 'type', a.apt_type, 'view', a.view, 'area', a.area, 'bedrooms', a.bedrooms, 'rooms', a.rooms,
  'image', a.image, 'rate', aquaterra_apt_rate(a.apt_type), 'pending', aquaterra_apt_pending(a), 'ownedAt', a.owned_at) $fn$;

-- n8n only, once: load NFT metadata into apartments. rows: [{tower, tokenId, floor, number, type, view, area, bedrooms, rooms, image}].
-- Never touches the owner.
CREATE OR REPLACE FUNCTION aquaterra_apt_load(rows jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE n int;
BEGIN
  INSERT INTO aquaterra_apartments (tower, token_id, floor, number, apt_type, view, area, bedrooms, rooms, image)
  SELECT r->>'tower', (r->>'tokenId')::int, (r->>'floor')::int, left(r->>'number', 20), left(coalesce(nullif(r->>'type', ''), 'Residential'), 40),
    left(r->>'view', 40), nullif(r->>'area', '')::int, nullif(r->>'bedrooms', '')::int, nullif(r->>'rooms', '')::int, left(r->>'image', 200)
  FROM jsonb_array_elements(rows) r
  WHERE r->>'tower' IN (SELECT id FROM aquaterra_towers) AND (r->>'floor') ~ '^-?[0-9]' AND length(r->>'floor') <= 6 AND substr(r->>'floor', 2) !~ '[^0-9]'
    AND (r->>'tokenId') ~ '^[0-9]' AND length(r->>'tokenId') <= 9 AND (r->>'tokenId') !~ '[^0-9]'
  ON CONFLICT (tower, token_id) DO UPDATE SET floor = EXCLUDED.floor, number = EXCLUDED.number, apt_type = EXCLUDED.apt_type,
    view = EXCLUDED.view, area = EXCLUDED.area, bedrooms = EXCLUDED.bedrooms, rooms = EXCLUDED.rooms, image = EXCLUDED.image;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'loaded', n, 'total', (SELECT count(*) FROM aquaterra_apartments));
END $fn$;

-- Listed collections (Rainbowland on Ethereum, 2026-11-26): small collections, or single tokens on
-- a shared contract (OpenSea Shared Storefront, ERC-1155), where only the token ids listed here
-- swap, and each token becomes its own item: an island of its own in the Heritage Sea, an island
-- with a villa on it, or a Tide compensation. Island plots have ids 2000000 + seq and never move.
ALTER TABLE aquaterra_nft_collections ADD COLUMN IF NOT EXISTS standard text NOT NULL DEFAULT 'erc721';
ALTER TABLE aquaterra_nft_collections ADD COLUMN IF NOT EXISTS listed boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS aquaterra_heritage_items (
  collection_id int NOT NULL REFERENCES aquaterra_nft_collections (id),
  token_id text NOT NULL,            -- decimal
  seq int NOT NULL UNIQUE,           -- island plot id = 2000000 + seq
  title text NOT NULL,               -- the name in the token metadata
  gives text NOT NULL CHECK (gives IN ('island', 'house', 'tide')),
  tide bigint NOT NULL DEFAULT 0,    -- gives tide: the compensation
  tiles int NOT NULL DEFAULT 4,      -- gives island or house: plot size
  price bigint NOT NULL DEFAULT 1000, -- gives island or house: price_paid, so its daily income
  place text,                        -- gives island or house: the address
  email text,                        -- who swapped it in
  plot_id int,
  PRIMARY KEY (collection_id, token_id)
);
INSERT INTO aquaterra_heritage_settings (key, value) VALUES ('islands_district', 'Heritage Sea') ON CONFLICT (key) DO NOTHING;

INSERT INTO aquaterra_nft_collections (chain, contract, name, kind, swap_tide, allow_plot, enabled, note) VALUES
  ('ethereum', '0x495f947276749ce646f68ac8c248420045cb7b5e', 'Rainbowland on OpenSea (listed tokens)', 'asset', 0, false, true,
   'Shared OpenSea contract: only the Rainbowland tokens listed here swap, each to its own island, villa or Tide.'),
  ('ethereum', '0x8a125f154dffe9c5991d0a6a81b067be5e97325d', 'The Rainbowland Metaverse (TRM)', 'house', 0, false, true,
   'Villas and mansions become a villa on an island of its own; the city becomes an island; Bugatti and the pass are paid in Tide.'),
  ('ethereum', '0x3a11eed29d57b8f247ff181dd21a53c27b4134f1', 'Rainbowland LANDs (RWL)', 'land', 0, false, true,
   'Each LAND becomes an island of its own in the Heritage Sea, the size of the LAND.'),
  ('ethereum', '0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', 'Rainbowland Kingdom (RBL)', 'asset', 0, false, true,
   'Titles, certificates and collectibles of the Kingdom of Rainbowland: a compensation in Tide.'),
  ('ethereum', '0x4303d88988785ac933471e0eb3fbf6b19ff8ad92', 'Crypto Planets (Rainbowland)', 'asset', 0, false, true,
   'Planets of the Rainbowland creator: a compensation in Tide.')
ON CONFLICT (chain, contract) DO NOTHING;
UPDATE aquaterra_nft_collections SET listed = true, allow_plot = false,
  standard = CASE WHEN contract = '0x495f947276749ce646f68ac8c248420045cb7b5e' THEN 'erc1155' ELSE 'erc721' END
WHERE chain = 'ethereum' AND contract IN ('0x495f947276749ce646f68ac8c248420045cb7b5e', '0x8a125f154dffe9c5991d0a6a81b067be5e97325d',
  '0x3a11eed29d57b8f247ff181dd21a53c27b4134f1', '0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', '0x4303d88988785ac933471e0eb3fbf6b19ff8ad92') AND NOT listed;

INSERT INTO aquaterra_heritage_items (collection_id, token_id, seq, title, gives, tide, tiles, price, place)
SELECT c.id, v.token_id, v.seq, v.title, v.gives, v.tide, v.tiles, v.price, v.place
FROM (VALUES
  ('0x495f947276749ce646f68ac8c248420045cb7b5e', '37198557236742699499983501232576879831168205667897545918004480319462678986753', 1, 'Parcel 58,35', 'island', 0, 2, 600, 'Parcel 58,35 Isle, Heritage Sea'),
  ('0x495f947276749ce646f68ac8c248420045cb7b5e', '37198557236742699499983501232576879831168205667897545918004479333200748871681', 2, 'Rainbow Happy Town', 'island', 0, 8, 3000, 'Happy Town Isle, Heritage Sea'),
  ('0x495f947276749ce646f68ac8c248420045cb7b5e', '37198557236742699499983501232576879831168205667897545918004480931890655657985', 3, 'Luxury Villa with Golden Car', 'house', 0, 4, 2500, 'Golden Villa Isle, Heritage Sea'),
  ('0x495f947276749ce646f68ac8c248420045cb7b5e', '37198557236742699499983501232576879831168205667897545918004480909900423102465', 4, 'Into the Metaverse: Building', 'house', 0, 4, 1500, 'Metaverse Building Isle, Heritage Sea'),
  ('0x495f947276749ce646f68ac8c248420045cb7b5e', '37198557236742699499983501232576879831168205667897545918004480906601888219137', 5, 'Into the Metaverse: Villa', 'house', 0, 4, 1500, 'Metaverse Villa Isle, Heritage Sea'),
  ('0x495f947276749ce646f68ac8c248420045cb7b5e', '37198557236742699499983501232576879831168205667897545918004479425559725604865', 6, 'Snow Chalet', 'house', 0, 4, 1500, 'Snow Chalet Isle, Heritage Sea'),
  ('0x495f947276749ce646f68ac8c248420045cb7b5e', '37198557236742699499983501232576879831168205667897545918004480129247167381505', 7, 'Bugatti Veyron', 'tide', 2000, 0, 0, NULL),
  ('0x495f947276749ce646f68ac8c248420045cb7b5e', '37198557236742699499983501232576879831168205667897545918004479494828958154753', 8, 'Real Planets: Mercury #5', 'tide', 1000, 0, 0, NULL),
  ('0x495f947276749ce646f68ac8c248420045cb7b5e', '37198557236742699499983501232576879831168205667897545918004479354091469799425', 9, 'Doge', 'tide', 1000, 0, 0, NULL),
  ('0x495f947276749ce646f68ac8c248420045cb7b5e', '37198557236742699499983501232576879831168205667897545918004479328802702360577', 10, 'Punk', 'tide', 1000, 0, 0, NULL),
  ('0x8a125f154dffe9c5991d0a6a81b067be5e97325d', '37198557236742699499983501232576879831168205667897545918004478672394260578305', 11, 'Into the Metaverse: San Francisco', 'island', 0, 6, 2000, 'San Francisco Isle, Heritage Sea'),
  ('0x8a125f154dffe9c5991d0a6a81b067be5e97325d', '37198557236742699499983501232576879831168205667897545918004478672394260578306', 12, 'Into the Metaverse: Villa, Rainbow Hills', 'house', 0, 4, 1500, 'Rainbow Hills Villa Isle, Heritage Sea'),
  ('0x8a125f154dffe9c5991d0a6a81b067be5e97325d', '37198557236742699499983501232576879831168205667897545918004478672394260578307', 13, 'Into the Metaverse: Villa', 'house', 0, 4, 1500, 'Villa Isle 307, Heritage Sea'),
  ('0x8a125f154dffe9c5991d0a6a81b067be5e97325d', '37198557236742699499983501232576879831168205667897545918004478672394260578309', 14, 'Into the Metaverse: Bugatti', 'tide', 2000, 0, 0, NULL),
  ('0x8a125f154dffe9c5991d0a6a81b067be5e97325d', '37198557236742699499983501232576879831168205667897545918004478672394260578311', 15, 'Into the Metaverse: Villa (rarity 10)', 'house', 0, 4, 2500, 'Villa Isle 311, Heritage Sea'),
  ('0x8a125f154dffe9c5991d0a6a81b067be5e97325d', '37198557236742699499983501232576879831168205667897545918004478672394260578324', 16, 'Celebrity Mansion', 'house', 0, 6, 3000, 'Celebrity Mansion Isle, Heritage Sea'),
  ('0x8a125f154dffe9c5991d0a6a81b067be5e97325d', '37198557236742699499983501232576879831168205667897545918004478672394260578325', 17, 'Metaverse Pass (VIP)', 'tide', 1000, 0, 0, NULL),
  ('0x3a11eed29d57b8f247ff181dd21a53c27b4134f1', '37198557236742699499983501232576879831168205667897545918004478672394260578305', 18, 'LAND (91, 14)', 'island', 0, 4, 1600, 'LAND (91, 14) Isle, Heritage Sea'),
  ('0x3a11eed29d57b8f247ff181dd21a53c27b4134f1', '37198557236742699499983501232576879831168205667897545918004478672394260578311', 19, 'Residential Plot, 6 Lands', 'island', 0, 6, 1800, 'Six Lands Isle, Heritage Sea'),
  ('0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', '28', 20, 'Prince of Butay (power 14 of 15)', 'tide', 7000, 0, 0, NULL),
  ('0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', '21', 21, 'Lord of The Blockchain', 'tide', 5000, 0, 0, NULL),
  ('0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', '22', 22, 'Certificate of Citizenship #1', 'tide', 1000, 0, 0, NULL),
  ('0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', '23', 23, 'Certificate of Citizenship #2', 'tide', 1000, 0, 0, NULL),
  ('0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', '2', 24, 'Church of Saint Sophia', 'tide', 1500, 0, 0, NULL),
  ('0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', '3', 25, 'Old City Marmaris', 'tide', 1500, 0, 0, NULL),
  ('0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', '4', 26, 'Jessica, painting', 'tide', 1500, 0, 0, NULL),
  ('0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', '5', 27, 'Jellyfish, painting', 'tide', 1500, 0, 0, NULL),
  ('0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', '6', 28, 'Davide, drawing', 'tide', 1500, 0, 0, NULL),
  ('0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', '7', 29, 'Greek Soldier', 'tide', 1500, 0, 0, NULL),
  ('0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', '9', 30, 'Certificate: One Hundred Thousand Pride', 'tide', 1500, 0, 0, NULL),
  ('0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', '10', 31, 'Antique City Hierapolis', 'tide', 1500, 0, 0, NULL),
  ('0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', '13', 32, 'The Book: The Best Recipes from all Around The World', 'tide', 1500, 0, 0, NULL),
  ('0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', '14', 33, 'Certificate: Character in The Book', 'tide', 1500, 0, 0, NULL),
  ('0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', '16', 34, 'Real House in Bulgaria', 'tide', 1500, 0, 0, NULL),
  ('0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', '19', 35, 'Black Sea Coast, Burgas', 'tide', 1500, 0, 0, NULL),
  ('0xe9b1746e72883eca1b3bd6b03ffb454a2ff8eda0', '20', 36, 'Beautiful Istanbul', 'tide', 1500, 0, 0, NULL),
  ('0x495f947276749ce646f68ac8c248420045cb7b5e', '37198557236742699499983501232576879831168205667897545918004480138043260403713', 37, 'Museum Plot', 'island', 0, 4, 1500, 'Museum Isle, Heritage Sea'),
  ('0x495f947276749ce646f68ac8c248420045cb7b5e', '37198557236742699499983501232576879831168205667897545918004479674049353482241', 38, 'Bergelmir', 'tide', 1000, 0, 0, NULL),
  ('0x495f947276749ce646f68ac8c248420045cb7b5e', '37198557236742699499983501232576879831168205667897545918004479041830167511041', 39, 'The Best Cocktails in The World (book)', 'tide', 1500, 0, 0, NULL),
  ('0x4303d88988785ac933471e0eb3fbf6b19ff8ad92', '37198557236742699499983501232576879831168205667897545918004478672394260578307', 40, 'Mercury #2', 'tide', 1000, 0, 0, NULL),
  ('0x4303d88988785ac933471e0eb3fbf6b19ff8ad92', '37198557236742699499983501232576879831168205667897545918004478672394260578306', 41, 'Saturn LXV #01', 'tide', 1000, 0, 0, NULL)
) AS v (contract, token_id, seq, title, gives, tide, tiles, price, place)
JOIN aquaterra_nft_collections c ON c.chain = 'ethereum' AND c.contract = v.contract
ON CONFLICT DO NOTHING;

-- NICS AI Agents (Ethereum 0x55e9…, symbol NOVA, 2026-11-26): each agent becomes the AI companion of
-- the resident who swaps it in (name and picture in the profile, next to the avatar on the map),
-- plus 1,000 TIDE. Founder decision.
CREATE TABLE IF NOT EXISTS aquaterra_companions (
  collection_id int NOT NULL,
  token_id text NOT NULL,
  email text NOT NULL,
  name text NOT NULL,
  pantheon text,
  domain text,
  image text,                        -- ipfs CID of the picture
  since timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, token_id)
);
CREATE INDEX IF NOT EXISTS aquaterra_companions_email ON aquaterra_companions (email);
ALTER TABLE aquaterra_heritage_items ADD COLUMN IF NOT EXISTS meta jsonb;
ALTER TABLE aquaterra_heritage_items DROP CONSTRAINT IF EXISTS aquaterra_heritage_items_gives_check;
ALTER TABLE aquaterra_heritage_items ADD CONSTRAINT aquaterra_heritage_items_gives_check CHECK (gives IN ('island', 'house', 'tide', 'companion'));
INSERT INTO aquaterra_nft_collections (chain, contract, name, kind, swap_tide, allow_plot, enabled, note) VALUES
  ('ethereum', '0x55e9f906866c364fe330a3de88e2e06d075e1a83', 'NICS AI Agents (NOVA)', 'asset', 0, false, true,
   'Each agent becomes your AI companion in AquaTerra: name and picture in your profile and next to you on the map, plus 1,000 TIDE.')
ON CONFLICT (chain, contract) DO NOTHING;
UPDATE aquaterra_nft_collections SET listed = true, allow_plot = false, standard = 'erc721'
WHERE chain = 'ethereum' AND contract = '0x55e9f906866c364fe330a3de88e2e06d075e1a83' AND NOT listed;
INSERT INTO aquaterra_heritage_items (collection_id, token_id, seq, title, gives, tide, tiles, price, place, meta)
SELECT c.id, v.token_id, v.seq, v.title, 'companion', 1000, 0, 0, NULL,
  jsonb_build_object('pantheon', v.pantheon, 'domain', v.domain, 'image', v.image)
FROM (VALUES
  ('1', 42, 'Ra', 'Egyptian', 'Sun & Creation', 'bafybeiawyfmtcmlhgs6u7gmtak4poge46gl6nr4ks6tuqe7tkhqutqdagu'),
  ('2', 43, 'Odin', 'Norse', 'Wisdom & War', 'bafybeienzn7hwrtvie2ioeejxknqkfotxnbxlwe22fgouyn2cb6bavc66e'),
  ('3', 44, 'Shiva', 'Hindu', 'Destruction & Creation', 'bafybeigrzk2kqx2f6nu6vgizgm2vqmi6pioixqgyflc2dtqhompcwhdk4e'),
  ('4', 45, 'Amaterasu', 'Shinto', 'Sun & Light', 'bafybeidpvkk2lk527mlf5fqgr5xnmv2n4erbhjvyf7ozjhp7nb2kborqwy'),
  ('5', 46, 'Quetzalcoatl', 'Aztec', 'Wisdom & Wind', 'bafybeifirv7vs6qs4rogluqha4genwlvo3brxlmlh2teyg4sxdk3ktkpyq'),
  ('6', 47, 'Jupiter', 'Roman', 'Sky & Authority', 'bafybeieavf3bbcd27cvc7pt33elqv4b5me6ksrkmv5blrcaaqbobtg74zu'),
  ('7', 48, 'Athena', 'Greek', 'Wisdom & War', 'bafybeigbndc2mijaiyaimkszaldpo4ue6ll6ask6xrvdmqjawdyk7qftge'),
  ('8', 49, 'Apollo', 'Greek', 'Sun & Arts', 'bafybeid5gr4333c3whsxbimfrlaeajmyey5htc5ovzngem2xnprsomnd3u'),
  ('9', 50, 'Cupid', 'Roman', 'Love & Affection', 'bafybeiggos5xra2idmulwtu6pzvzh2fc7lj2orpi6guddym4nlaczrwzaq'),
  ('10', 51, 'Hermes', 'Greek', 'Travel, Communication & Commerce', 'bafybeiajexhqoqbf5zhj6vvryztajuju26lpu76xzha573otkt3nzgif7m'),
  ('11', 52, 'Guan Yu', 'Chinese', 'War & Loyalty', 'bafybeigpaexbjfaoopqiwqw5mh434ocx7abeuzyufnyrzvrjkcui62q5li'),
  ('12', 53, 'Anubis', 'Egyptian', 'Death & Afterlife', 'bafybeieofwkcpvur7pnmwyihizktxjjdzophfi5y3p5zaoqlm3ywuzz7ae'),
  ('13', 54, 'Bastet', 'Egyptian', 'Protection & Home', 'bafybeiarlhgpetxufrkzym2bc57cjx5hpkopgdkli2o2c25bh6nnlv3t4y'),
  ('14', 55, 'Frey', 'Norse', 'Fertility, Prosperity & Sun', 'bafybeie43k6lmcqytjspltgsposfdggzvjmibulqq2c56qyer2mpy6g3mq'),
  ('15', 56, 'Valkyrie', 'Norse', 'Courage & Guardianship', 'bafybeibsiyadmuucyplqugjg7dlhz4j4ovamiib6ws4mvq7e46c47ghiqm'),
  ('16', 57, 'Heru (Horus)', 'Egyptian', 'Sky, Protection & Kingship', 'bafybeicfgjgisxhdmgiv6ldurlt4j46ke5tkzo36dvsdkfiyedoj3h7lne'),
  ('17', 58, 'Johann Weissmann', '', 'Scientist & Inventor', 'bafybeibvxftmuclwejvprfpzb2k77r4ej4fgjmlvpifmc2fkdx2ew5od6u'),
  ('18', 59, 'Osiris', 'Egyptian', 'Afterlife, Resurrection & Fertility', 'bafybeicpoiwwg2rj3qoojaimcmzv4et4xo4owqzn2vd5cik7jdxsavx57e'),
  ('19', 60, 'Auset', 'Egyptian', 'Wisdom, Protection & Nurturing', 'bafybeiadf6cwylxw52ck7b74fqukwutwpo77ps24pod3y5e2vp5udundmu'),
  ('20', 61, 'Thoth', 'Egyptian', 'Wisdom, Writing & Knowledge', 'bafybeif33qsgoavevouofajyo62jywpze5baz3qyfkr7cimtxjljfftsfy'),
  ('21', 62, 'Set (Seth)', 'Egyptian', 'Chaos, Storms & Protection', 'bafybeibhuwdvsf2on5wau4hovvtii7nc46bs5kgxaefud5ihpaqmdmarvi'),
  ('22', 63, 'Tutankhamun', 'Historical Human', 'Leader & Protector', 'bafybeibvcndlfk2wpdahgrlht3fibyjpz7kyejubfrmbnmfdn6subfh2xy'),
  ('23', 64, 'Socrates', '', 'Philosopher', 'bafybeidmqxjy2n65krdspryrq2ybaq5kqowtocovhjor6fw56tzuqoavpq'),
  ('24', 65, 'Aeternus Scriptor', 'Medieval Humanist', 'Scholar, Writer, AI, Avatar', 'bafybeidf2ubisfjbu6yh2k47fegub3pkqgsy352u24jyubdrth63wvnr44'),
  ('25', 66, 'Alaric the Arcane', 'Medieval European', 'Mage, Spirit, AI, Avatar', 'bafybeibnxus6qlmmqb6miiamduds4nbkl25cyxqyb4na76we264hws63aq'),
  ('26', 67, 'Neptune', 'Roman', 'God, Spirit, AI, Avatar', 'bafybeibu44maxyklurwr5sqla6u73xbvenbhl333zmbum5yrfz7676d6zy'),
  ('27', 68, 'Thor', 'Norse (Aesir)', 'God, Spirit, AI, Avatar', 'bafybeifw5j4lqf5mzmnk2wfl5lelqfvskupimgpb766yrns6f6ykb6jtlq'),
  ('28', 69, 'Poseidon', 'Greek', 'God, Spirit, AI, Avatar', 'bafybeicuvgrubdiqu3mg5gwls4vvpphjcdsjzdvztjnxjeivepowkmhxxe'),
  ('29', 70, 'Baba Yaga', 'Slavic', 'Witch, Spirit, AI, Avatar', 'bafybeifcxtirkk4t6z3e4cu6tjvl5bmvvjj47a3znnmyoff4chocgcds5y'),
  ('30', 71, 'Odùduwà', 'Yoruba', 'Orisha, Divine King, AI, Avatar', 'bafybeicgjihajxhyomojm73rmy5vo5wt5kaflpuifocfucjzogsoshpxui'),
  ('31', 72, 'Olódùmarè', 'Yoruba', 'Deity, Spirit, AI, Avatar', 'bafybeifqrzy6eyjv6fpzm5qgcuawj277uzr3myjz4piq5wjtthbdxre2hu'),
  ('32', 73, 'Orunmila', 'Yoruba', 'Orisha, Spirit, AI, Avatar', 'bafybeibp2s2pesbb6xbti7uothcpbgjqbrztrsy6lp42k5np3bb3goaija'),
  ('33', 74, 'Eshu / Èṣù / Elegbara', 'Yoruba', 'Orisha, Trickster, Messenger, AI Avatar', 'bafybeiati2bwkywac7frx2wkhnewh463b6c7gaznfqfe5sx3a5qer3njce'),
  ('34', 75, 'Ogun', 'Yoruba', 'Orisha, Spirit, AI, Avatar', 'bafybeibjfuupces2czpt3etffypneh2opojvbqorhi6pjpmhlgpspwwzo4'),
  ('35', 76, 'Oya', 'Yoruba', 'Orisha, Spirit, AI, Avatar', 'bafybeicfj2ycj3fbtixxwomaqh2yn44tqivj7ssuyzek2abxnzfqaexkni'),
  ('36', 77, 'Shango', 'Yoruba', 'Orisha, Spirit, AI, Avatar', 'bafybeih5qxe53mrrnmq67377otrvcmhxgaoas44werkcfgk5dq5mucap6m'),
  ('37', 78, 'Oshun', 'Yoruba', 'Orisha, Spirit, AI, Avatar', 'bafybeigutxk6itlbl4cwpgcpbuzaakusz4pdkxbfwc45xdbvbktlps7rau'),
  ('38', 79, 'Obatala', 'Yoruba', 'Orisha, Spirit, AI, Avatar', 'bafybeia7hzw2feuky5ncrcdh7nmhmqtoqkkrfmcw53tmjty575zkvnd2by'),
  ('39', 80, 'Yemayá', 'Yoruba', 'Orisha, Spirit, AI, Avatar', 'bafybeiaknkkc3wdujwz7ias52qj4djjwblmoosud72qecwct2ymai354bm'),
  ('40', 81, 'Loki of Asgard', 'Norse / Aesir', 'God, Trickster, Shapeshifter, AI Avatar', 'bafybeiadkpo3gyizos6qfpy3zpkkkcznjp6coodn2d55mmagfzbuxv4fku'),
  ('41', 82, 'Pumpkin King', 'Halloween / Folklore', 'Spirit, Trickster, Shadow Guide, AI Avatar', 'bafybeicfcpr7ndsndq7nnkyw2rw7xgioucosncpfndbudexljbggxkchim'),
  ('42', 83, 'Living Skeleton', 'Halloween / Supernatural', 'Undead, Spirit, AI, Avatar', 'bafybeidrzztkggx2hz2dm5wxweoaihzrfxb66s4avw3muz3rq5s5nzc42a'),
  ('43', 84, 'Olokun', 'Yoruba', 'Orisha, Spirit, AI Avatar', 'bafybeicfjabqd5td3splnzraet7i7t5i2mely6o6vuoj7cmigxtrou6nwe'),
  ('44', 85, 'Oba', 'Yoruba', 'Orisha, Goddess, AI, Avatar', 'bafybeihg52azsm67bsd3waokris7nvgnuz7276pxb7ohkb3ytkum3uwkga'),
  ('45', 86, 'Leonardo da Vinci', 'Renaissance Masters', 'Human Genius, Polymath, AI Avatar', 'bafybeif324w2w3bpvisnip4yclimdtvrubkynyqklnzjji5pr55xp5xztq'),
  ('46', 87, 'Lucien Deverne', 'Culinary Legends', 'Chef, Alchemist, AI Avatar', 'bafybeihvduh7udsznryjxrifd7pphwqbzijmbrzthx63xcqyiupls2g57e'),
  ('47', 88, 'Gaius Julius Caesar', 'Roman', 'General, Statesman, AI Avatar', 'bafybeifltr5dete6dekl66b7ejzmibrcennlmq4ujjrdcowiydwo2dqxhi'),
  ('48', 89, 'Cleopatra', 'Egyptian', 'Pharaoh, AI, Avatar, Spirit', 'bafybeib7vimrvyezmtlaecifhbhd27xpwzzydxvcon77uzirsfo5ph7hiq'),
  ('49', 90, 'Aganju', 'Yoruba', 'Orisha, AI Avatar, Elemental Force', 'bafybeiczcqwzzfiulfx5hfs5okyl4d7xo4l72fulhjglej2svx7a2c4zdu'),
  ('50', 91, 'Ibeji', 'Yoruba', 'Orisha Twins, AI Avatars', 'bafybeigwub57nbtbowd4csxe5pedr4huizwsxyzvu3ze5sa3j7f65vbiuu'),
  ('51', 92, 'Erinle', 'Yoruba', 'Orisha, AI Avatar, Healer', 'bafybeibw72vecphl35hjlztat6kv4m75tgibgqdmxvptoand6j257n7nlm'),
  ('52', 93, 'Oko', 'Yoruba', 'Orisha, AI Avatar, Guardian of the Fields', 'bafybeigepjcz5draloxsvpwo74q4i6ysa5xyeachki4dsjljerxsrvp3ja'),
  ('53', 94, 'Ozain', 'Yoruba', 'Orisha, AI Avatar, Guardian of Forests', 'bafybeiezj67fbamb66niyppetyldye44fquyfvypzviy5fubr5z3lhf7uy'),
  ('54', 95, 'Maat', 'Egyptian', 'Goddess, AI Avatar, Judge', 'bafybeial2yccjdwc3leu63pf325yi2gf4saewmuqfoep7t7ej4a6lfru6e'),
  ('55', 96, 'Maat', 'Egyptian', 'Goddess, AI Avatar, Judge', 'bafybeial2yccjdwc3leu63pf325yi2gf4saewmuqfoep7t7ej4a6lfru6e'),
  ('56', 97, 'Ptah', 'Egyptian', 'God, AI Architect, Creator', 'bafybeiayjvltilewerjafy3nn5tfduau5tq4y6gy3yhtemairpnbbjsngq'),
  ('57', 98, 'Michael Myers', 'Modern Legends', 'Silent Figure, AI Avatar', 'bafybeibv7vxrsgs4ka32a322a63vymjompww7p32gkrthgikdr4fwnomia'),
  ('58', 99, 'Captain Planet', 'Elemental / Environmental', 'Elemental Spirit, AI Guardian, Protector', 'bafybeihy2iyuuk7ylgygj5anlblzrf5a76j7rictyvrlooknjsaoy7raw4'),
  ('59', 100, 'Solar Guardian', 'Cosmic Protectors', 'AI Avatar, Celestial Hero', 'bafybeigw6a7kdm6hm55mb3kgqnjrh4uddt2xlksmcrna3eyittgp22qdny'),
  ('60', 101, 'Scarlet Velocity', 'Cosmic Protectors', 'AI Avatar, Temporal Guardian', 'bafybeidxhtzg5x3nvzfmyj3jx6acojby6vdzj3pjz3bjqf63ws4bh6af6i'),
  ('61', 102, 'Emerald Guardian', 'Cosmic Protectors', 'AI Avatar, Universal Hero', 'bafybeiauxk3jp2wu5x4cjh56wik4dxrsuemtecj7ji2fsr6bd5yloeolu4'),
  ('62', 103, 'Isis', 'Egyptian', 'Goddess, AI Avatar, Healer', 'bafybeicke53aihhtlxzi4xoahq76pgi43joru5xay5d3kq4zfgeogvxwoe'),
  ('63', 104, 'The Werewolf', 'Night Beasts', 'AI Avatar, Mythic Creature', 'bafybeiclxgqegxmrcse6krtpiv3fi23qidgmewbcnsvvqdcrhf2y56lmpa')
) AS v (token_id, seq, title, pantheon, domain, image)
JOIN aquaterra_nft_collections c ON c.chain = 'ethereum' AND c.contract = '0x55e9f906866c364fe330a3de88e2e06d075e1a83'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION aquaterra_companions_json(who text) RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('token', token_id, 'name', name, 'pantheon', pantheon, 'domain', domain,
    'image', image, 'since', since) ORDER BY since, token_id), '[]'::jsonb)
  FROM aquaterra_companions WHERE email = who
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_h_items_json(cid int) RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('tokenId', token_id, 'title', title, 'gives', gives, 'tide', tide,
    'tiles', tiles, 'place', place, 'taken', email IS NOT NULL, 'image', meta->>'image', 'about', meta->>'domain') ORDER BY seq), '[]'::jsonb)
  FROM aquaterra_heritage_items WHERE collection_id = cid
$fn$;

-- The swap of a listed token is confirmed (the vault holds it): give its item, once.
CREATE OR REPLACE FUNCTION aquaterra_h_item_give(s aquaterra_nft_swaps) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE it aquaterra_heritage_items; v_plot int;
BEGIN
  SELECT * INTO it FROM aquaterra_heritage_items WHERE collection_id = s.collection_id AND token_id = s.token_id FOR UPDATE;
  IF it.seq IS NULL THEN RAISE EXCEPTION 'token'; END IF;
  IF it.email IS NOT NULL THEN RAISE EXCEPTION 'swapped'; END IF;
  IF it.gives IN ('tide', 'companion') THEN
    IF it.gives = 'companion' THEN
      INSERT INTO aquaterra_companions (collection_id, token_id, email, name, pantheon, domain, image)
      VALUES (it.collection_id, it.token_id, s.email, it.title, it.meta->>'pantheon', it.meta->>'domain', it.meta->>'image')
      ON CONFLICT (collection_id, token_id) DO NOTHING;
    END IF;
    UPDATE aquaterra_heritage_items SET email = s.email WHERE collection_id = it.collection_id AND token_id = it.token_id;
    UPDATE aquaterra_nft_swaps SET status = 'done', tide = it.tide, done_at = now() WHERE id = s.id;
    IF it.tide > 0 THEN
      PERFORM aquaterra_move('treasury', s.email, it.tide, 'nft_swap_tide', NULL, 'Heritage Port: ' || it.title, NULL);
    END IF;
    RETURN;
  END IF;
  v_plot := 2000000 + it.seq;
  INSERT INTO aquaterra_plots (id, address, district, tiles, price)
  VALUES (v_plot, coalesce(it.place, it.title || ' Isle, Heritage Sea'), aquaterra_hs('islands_district'), it.tiles, it.price)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO aquaterra_wallets (account) VALUES (s.email) ON CONFLICT DO NOTHING;
  INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid) VALUES (v_plot, s.email, it.price)
  ON CONFLICT (plot_id) DO UPDATE SET owner = EXCLUDED.owner, price_paid = EXCLUDED.price_paid, bought_at = now(), income_from = now();
  IF it.gives = 'house' AND to_regclass('aquaterra_buildings') IS NOT NULL THEN
    INSERT INTO aquaterra_buildings (plot_id, kind, level, built_by) VALUES (v_plot, 'cottage', 3, s.email) ON CONFLICT (plot_id) DO NOTHING;
  END IF;
  UPDATE aquaterra_heritage_items SET email = s.email, plot_id = v_plot WHERE collection_id = it.collection_id AND token_id = it.token_id;
  UPDATE aquaterra_nft_swaps SET status = 'done', plot_id = v_plot, done_at = now() WHERE id = s.id;
END $fn$;

-- What n8n should ask the chain for one swap.
CREATE OR REPLACE FUNCTION aquaterra_h_check(s aquaterra_nft_swaps, step text) RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('swapId', s.id, 'step', step, 'rpc', ch.rpc, 'contract', c.contract, 'tokenId', s.token_id,
    'standard', c.standard,
    -- ERC-1155 has no ownerOf: n8n asks balanceOf for these addresses and answers with the first that holds it.
    'holders', CASE WHEN c.standard = 'erc1155' THEN CASE WHEN step = 'open'
      THEN COALESCE((SELECT jsonb_agg(w.address ORDER BY w.linked_at) FROM aquaterra_wallet_links w WHERE w.email = s.email AND w.chain_family = 'evm'), '[]'::jsonb)
      ELSE jsonb_build_array(aquaterra_hs('vault_address')) END END)
  FROM aquaterra_nft_collections c JOIN aquaterra_nft_chains ch ON ch.id = c.chain WHERE c.id = s.collection_id
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_h_refund(s aquaterra_nft_swaps, why text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF s.status = 'open' AND s.fee > 0 THEN
    PERFORM aquaterra_move('state:treasury', s.email, s.fee, 'nft_swap_refund', NULL, 'Heritage Port: swap fee back', NULL);
  END IF;
  UPDATE aquaterra_nft_swaps SET status = 'cancelled', reason = why WHERE id = s.id;
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_h_challenge(purpose text, who text, addr text, display text) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE n text := replace(gen_random_uuid()::text, '-', ''); msg text;
BEGIN
  DELETE FROM aquaterra_wallet_challenges WHERE expires_at < now() - interval '1 day';
  msg := 'AquaTerra World' || E'\n' ||
    CASE purpose WHEN 'link' THEN 'Link this wallet to the account of ' || display ELSE 'Sign in with this wallet' END || E'\n' ||
    'Wallet: ' || addr || E'\n' || 'Code: ' || n || E'\n' ||
    'This signature costs nothing and moves no funds.';
  INSERT INTO aquaterra_wallet_challenges (nonce, purpose, email, address, message, expires_at)
  VALUES (n, purpose, who, addr, msg, now() + interval '10 minutes');
  RETURN jsonb_build_object('message', msg);
END $fn$;

-- The signed message must be one we issued, unused, unexpired, for this purpose and the address
-- n8n recovered from the signature.
CREATE OR REPLACE FUNCTION aquaterra_h_redeem(req jsonb, want text) RETURNS aquaterra_wallet_challenges LANGUAGE plpgsql AS $fn$
DECLARE c aquaterra_wallet_challenges;
BEGIN
  IF req->'verified' IS NULL OR coalesce(req->'verified'->>'address', '') = '' THEN RAISE EXCEPTION 'signature'; END IF;
  SELECT * INTO c FROM aquaterra_wallet_challenges
  WHERE message = req->'verified'->>'message' AND purpose = want FOR UPDATE;
  IF c.nonce IS NULL OR c.used_at IS NOT NULL OR c.expires_at < now() THEN RAISE EXCEPTION 'expired'; END IF;
  IF c.address <> lower(req->'verified'->>'address') THEN RAISE EXCEPTION 'signature'; END IF;
  UPDATE aquaterra_wallet_challenges SET used_at = now() WHERE nonce = c.nonce;
  RETURN c;
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_heritage(req jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  act text := req->>'action';
  me text; my_role text; my_name text;
  res jsonb := '{}'::jsonb;
  addr text; ch aquaterra_wallet_challenges; col aquaterra_nft_collections; s aquaterra_nft_swaps;
  v_tok text; v_choice text; v_fee bigint; tok text; v_n bigint; tw aquaterra_towers; ap aquaterra_apartments; v_tax bigint;
BEGIN
  IF coalesce(req->>'session', '') <> '' THEN
    SELECT p.email, p.role, p.display_name INTO me, my_role, my_name
    FROM aquaterra_sessions s2 JOIN aquaterra_players p ON p.email = s2.email
    WHERE s2.token_hash = encode(sha256(convert_to(req->>'session', 'UTF8')), 'hex') AND s2.expires_at > now();
  END IF;
  IF act NOT IN ('info', 'login_challenge', 'wallet_login', 'tower') AND me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401);
  END IF;

  BEGIN
    addr := lower(btrim(coalesce(req->>'address', '')));
    IF addr <> '' AND addr !~ '^0x[0-9a-f]{40}' OR length(addr) NOT IN (0, 42) THEN RAISE EXCEPTION 'address'; END IF;

    IF act IN ('info', 'me') THEN
      res := jsonb_build_object(
        'open', aquaterra_hlaw('nft_swap_enabled') = 1,
        'fee', aquaterra_hlaw('nft_swap_fee'),
        'vault', aquaterra_hs('vault_address'),
        'district', aquaterra_hs('heritage_district'),
        'reserve', (SELECT count(*) FROM aquaterra_plot_owners WHERE owner = 'heritage:reserve'),
        'swapped', (SELECT count(*) FROM aquaterra_nft_swaps WHERE status = 'done'),
        'chains', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'family', family, 'chainId', chain_id,
            'explorer', explorer, 'enabled', enabled) ORDER BY sort) FROM aquaterra_nft_chains), '[]'::jsonb),
        'collections', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'chain', chain, 'contract', contract, 'name', name,
            'kind', kind, 'swapTide', swap_tide, 'allowPlot', allow_plot, 'note', note, 'listed', listed,
            'items', CASE WHEN listed THEN aquaterra_h_items_json(id) END) ORDER BY chain, id)
          FROM aquaterra_nft_collections WHERE enabled), '[]'::jsonb));
      IF act = 'me' THEN
        res := res || jsonb_build_object(
          'wallets', COALESCE((SELECT jsonb_agg(jsonb_build_object('family', chain_family, 'address', address, 'linkedAt', linked_at) ORDER BY linked_at)
            FROM aquaterra_wallet_links WHERE email = me), '[]'::jsonb),
          'swaps', COALESCE((SELECT jsonb_agg(aquaterra_h_swap_json(x) ORDER BY x.id DESC) FROM aquaterra_nft_swaps x
            WHERE x.email = me AND x.status <> 'checking'), '[]'::jsonb),
          'apartments', COALESCE((SELECT jsonb_agg(aquaterra_apt_json(a) ORDER BY a.tower, a.floor, a.number) FROM aquaterra_apartments a WHERE a.owner = me), '[]'::jsonb),
          'companions', aquaterra_companions_json(me),
          'balance', aquaterra_balance(me),
          'feeFree', greatest(0, aquaterra_balance(me) - aquaterra_swap_locked(me)));
      END IF;

    ELSIF act IN ('link_challenge', 'login_challenge') THEN
      IF addr = '' THEN RAISE EXCEPTION 'address'; END IF;
      IF act = 'login_challenge' AND NOT EXISTS (SELECT 1 FROM aquaterra_wallet_links WHERE chain_family = 'evm' AND address = addr) THEN
        RAISE EXCEPTION 'not_linked';
      END IF;
      IF act = 'link_challenge' AND EXISTS (SELECT 1 FROM aquaterra_wallet_links WHERE chain_family = 'evm' AND address = addr) THEN
        IF (SELECT email FROM aquaterra_wallet_links WHERE chain_family = 'evm' AND address = addr) = me THEN RAISE EXCEPTION 'already_mine'; END IF;
        RAISE EXCEPTION 'linked_elsewhere';
      END IF;
      IF (SELECT count(*) FROM aquaterra_wallet_challenges WHERE address = addr AND expires_at > now() - interval '1 hour') > 20 THEN
        RAISE EXCEPTION 'too_many';
      END IF;
      res := aquaterra_h_challenge(CASE act WHEN 'link_challenge' THEN 'link' ELSE 'login' END, me, addr, my_name);

    ELSIF act = 'link' THEN
      ch := aquaterra_h_redeem(req, 'link');
      IF ch.email <> me THEN RAISE EXCEPTION 'signature'; END IF;
      IF (SELECT count(*) FROM aquaterra_wallet_links WHERE email = me) >= 10 THEN RAISE EXCEPTION 'wallet_limit'; END IF;
      INSERT INTO aquaterra_wallet_links (chain_family, address, email) VALUES ('evm', ch.address, me) ON CONFLICT DO NOTHING;
      IF NOT FOUND THEN RAISE EXCEPTION 'linked_elsewhere'; END IF;
      res := jsonb_build_object('address', ch.address);

    ELSIF act = 'unlink' THEN
      IF addr = '' THEN RAISE EXCEPTION 'address'; END IF;
      IF EXISTS (SELECT 1 FROM aquaterra_nft_swaps WHERE email = me AND owner_address = addr AND status = 'open') THEN RAISE EXCEPTION 'swap_open'; END IF;
      DELETE FROM aquaterra_wallet_links WHERE email = me AND address = addr;
      res := jsonb_build_object('address', addr);

    ELSIF act = 'wallet_login' THEN
      ch := aquaterra_h_redeem(req, 'login');
      SELECT email INTO me FROM aquaterra_wallet_links WHERE chain_family = 'evm' AND address = ch.address;
      IF me IS NULL THEN RAISE EXCEPTION 'not_linked'; END IF;
      tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      INSERT INTO aquaterra_sessions (token_hash, email, expires_at)
      VALUES (encode(sha256(convert_to(tok, 'UTF8')), 'hex'), me, now() + interval '180 days');
      res := jsonb_build_object('session', tok);

    ELSIF act = 'swap' THEN
      IF aquaterra_hlaw('nft_swap_enabled') <> 1 THEN RAISE EXCEPTION 'closed'; END IF;
      IF coalesce(aquaterra_hs('vault_address'), '') = '' THEN RAISE EXCEPTION 'closed'; END IF;
      SELECT * INTO col FROM aquaterra_nft_collections WHERE id = (req->>'collectionId')::int AND enabled;
      IF col.id IS NULL THEN RAISE EXCEPTION 'collection'; END IF;
      IF (SELECT family FROM aquaterra_nft_chains WHERE id = col.chain) <> 'evm' OR NOT (SELECT enabled FROM aquaterra_nft_chains WHERE id = col.chain) THEN
        RAISE EXCEPTION 'chain_soon';
      END IF;
      v_tok := btrim(coalesce(req->>'tokenId', ''));
      IF v_tok !~ '^[0-9]{1,78}' OR length(v_tok) > 78 OR v_tok ~ '[^0-9]' THEN RAISE EXCEPTION 'token'; END IF;
      v_tok := ltrim(v_tok, '0'); IF v_tok = '' THEN v_tok := '0'; END IF;
      v_choice := CASE WHEN col.listed THEN 'item' WHEN col.kind = 'tower' THEN 'apartment' WHEN col.kind = 'planet' THEN 'planet' WHEN req->>'choice' = 'plot' AND col.allow_plot THEN 'plot' ELSE 'tide' END;
      IF v_choice = 'tide' AND col.swap_tide <= 0 THEN RAISE EXCEPTION 'choice'; END IF;
      IF v_choice = 'apartment' THEN
        IF length(v_tok) > 9 THEN RAISE EXCEPTION 'token'; END IF;
        SELECT a.* INTO ap FROM aquaterra_apartments a JOIN aquaterra_towers t2 ON t2.id = a.tower
        WHERE t2.collection_id = col.id AND a.token_id = v_tok::int;
        IF ap.tower IS NULL THEN RAISE EXCEPTION 'token'; END IF;
        IF ap.owner IS NOT NULL THEN RAISE EXCEPTION 'swapped'; END IF;
      END IF;
      IF v_choice = 'item' THEN
        -- Listed collections: only the token ids in aquaterra_heritage_items swap, each to its own item.
        IF NOT EXISTS (SELECT 1 FROM aquaterra_heritage_items WHERE collection_id = col.id AND token_id = v_tok) THEN RAISE EXCEPTION 'token'; END IF;
        IF EXISTS (SELECT 1 FROM aquaterra_heritage_items WHERE collection_id = col.id AND token_id = v_tok AND email IS NOT NULL) THEN RAISE EXCEPTION 'swapped'; END IF;
      END IF;
      IF v_choice = 'planet' THEN
        -- Milky Way Marvels: token N becomes Orbit claim N (server/orbit/orbit.sql).
        IF length(v_tok) > 6 OR NOT EXISTS (SELECT 1 FROM aquaterra_planets WHERE token_id = v_tok::int) THEN RAISE EXCEPTION 'token'; END IF;
        IF EXISTS (SELECT 1 FROM aquaterra_planets WHERE token_id = v_tok::int AND owner IS NOT NULL) THEN RAISE EXCEPTION 'swapped'; END IF;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM aquaterra_wallet_links WHERE email = me AND chain_family = 'evm') THEN RAISE EXCEPTION 'no_wallet'; END IF;
      IF EXISTS (SELECT 1 FROM aquaterra_nft_swaps WHERE collection_id = col.id AND token_id = v_tok AND status = 'done') THEN RAISE EXCEPTION 'swapped'; END IF;
      IF EXISTS (SELECT 1 FROM aquaterra_nft_swaps WHERE collection_id = col.id AND token_id = v_tok AND status = 'open' AND email = me) THEN RAISE EXCEPTION 'swap_open'; END IF;
      IF v_choice = 'plot' THEN
        IF NOT EXISTS (SELECT 1 FROM aquaterra_plot_owners WHERE owner = 'heritage:reserve') THEN RAISE EXCEPTION 'reserve_empty'; END IF;
        IF (SELECT count(*) FROM aquaterra_plot_owners WHERE owner = me)
           + (SELECT count(*) FROM aquaterra_nft_swaps WHERE email = me AND status = 'open' AND choice = 'plot') >= aquaterra_limit_for(me, 'max_plots_per_citizen', aquaterra_param('max_plots_per_citizen')) THEN
          RAISE EXCEPTION 'plot_limit';
        END IF;
      END IF;
      v_fee := aquaterra_hlaw('nft_swap_fee');
      IF aquaterra_balance(me) - aquaterra_swap_locked(me) < v_fee THEN RAISE EXCEPTION 'insufficient'; END IF;
      DELETE FROM aquaterra_nft_swaps WHERE email = me AND status = 'checking' AND created_at < now() - interval '5 minutes';
      IF (SELECT count(*) FROM aquaterra_nft_swaps WHERE email = me AND created_at > now() - interval '1 hour') > 30 THEN RAISE EXCEPTION 'too_many'; END IF;
      INSERT INTO aquaterra_nft_swaps (email, collection_id, token_id, choice) VALUES (me, col.id, v_tok, v_choice) RETURNING * INTO s;
      res := jsonb_build_object('check', aquaterra_h_check(s, 'open'));

    ELSIF act = 'confirm' THEN
      SELECT * INTO s FROM aquaterra_nft_swaps WHERE id = (req->>'swapId')::bigint AND email = me;
      IF s.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      IF s.status <> 'open' THEN RAISE EXCEPTION 'not_open'; END IF;
      res := jsonb_build_object('check', aquaterra_h_check(s, 'confirm'));

    ELSIF act = 'tower' THEN
      -- One tower, apartments as compact rows: [token, floor, number, type, view, area, bedrooms, owner name or null, mine].
      SELECT * INTO tw FROM aquaterra_towers WHERE id = coalesce(req->>'tower', 'first-light');
      IF tw.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      res := jsonb_build_object('tower', jsonb_build_object('id', tw.id, 'name', tw.name, 'plotId', tw.plot_id,
          'contract', (SELECT contract FROM aquaterra_nft_collections WHERE id = tw.collection_id), 'collectionId', tw.collection_id,
          'floors', (SELECT max(floor) FROM aquaterra_apartments WHERE tower = tw.id),
          'lowest', (SELECT min(floor) FROM aquaterra_apartments WHERE tower = tw.id),
          'owned', (SELECT count(*) FROM aquaterra_apartments WHERE tower = tw.id AND owner IS NOT NULL),
          'income', aquaterra_hlaw('apartment_income')),
        'apartments', COALESCE((SELECT jsonb_agg(jsonb_build_array(a.token_id, a.floor, a.number, a.apt_type, a.view, a.area, a.bedrooms,
            CASE WHEN a.owner IS NOT NULL THEN aquaterra_name(a.owner) END, me IS NOT NULL AND a.owner = me) ORDER BY a.floor, a.number)
          FROM aquaterra_apartments a WHERE a.tower = tw.id), '[]'::jsonb));

    ELSIF act = 'apt_collect' THEN
      -- Collect what all my apartments earned, minus income tax to the State Treasury.
      v_n := 0; v_tax := 0;
      FOR ap IN SELECT * FROM aquaterra_apartments WHERE owner = me FOR UPDATE LOOP
        v_fee := aquaterra_apt_pending(ap);
        IF v_fee >= 1 THEN
          v_n := v_n + v_fee;
          UPDATE aquaterra_apartments SET income_from = now() WHERE tower = ap.tower AND token_id = ap.token_id;
        END IF;
      END LOOP;
      IF v_n < 1 THEN RAISE EXCEPTION 'nothing'; END IF;
      v_tax := round(v_n * greatest(0, least(50, aquaterra_hlaw('income_tax_pct'))) / 100.0);
      PERFORM aquaterra_move('treasury', me, v_n - v_tax, 'apartment_income', NULL, 'Apartment income', me);
      IF v_tax > 0 THEN PERFORM aquaterra_move('treasury', 'state:treasury', v_tax, 'tax', NULL, 'Income tax, apartments', me); END IF;
      res := jsonb_build_object('gross', v_n, 'tax', v_tax, 'net', v_n - v_tax, 'balance', aquaterra_balance(me));

    ELSIF act = 'cancel' THEN
      SELECT * INTO s FROM aquaterra_nft_swaps WHERE id = (req->>'swapId')::bigint AND email = me FOR UPDATE;
      IF s.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      IF s.status <> 'open' THEN RAISE EXCEPTION 'not_open'; END IF;
      PERFORM aquaterra_h_refund(s, 'cancelled by the resident');
      SELECT * INTO s FROM aquaterra_nft_swaps WHERE id = s.id;
      res := jsonb_build_object('swap', aquaterra_h_swap_json(s));

    ELSIF act LIKE 'admin%' THEN
      IF my_role NOT IN ('founder', 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
      IF act <> 'admin' AND my_role <> 'founder' THEN RAISE EXCEPTION 'forbidden'; END IF;
      IF act = 'admin_collection' THEN
        IF req->>'chain' NOT IN (SELECT id FROM aquaterra_nft_chains) THEN RAISE EXCEPTION 'chain'; END IF;
        v_tok := lower(btrim(coalesce(req->>'contract', '')));
        IF (SELECT family FROM aquaterra_nft_chains WHERE id = req->>'chain') = 'evm' AND (v_tok !~ '^0x[0-9a-f]{40}' OR length(v_tok) <> 42) THEN RAISE EXCEPTION 'address'; END IF;
        IF v_tok = '' OR length(v_tok) > 120 THEN RAISE EXCEPTION 'address'; END IF;
        IF coalesce(req->>'kind', 'asset') NOT IN ('land', 'house', 'car', 'asset') THEN RAISE EXCEPTION 'kind'; END IF;
        INSERT INTO aquaterra_nft_collections (chain, contract, name, kind, swap_tide, allow_plot, enabled, note)
        VALUES (req->>'chain', v_tok, left(coalesce(nullif(btrim(req->>'name'), ''), v_tok), 80), coalesce(req->>'kind', 'asset'),
          greatest(0, least(1000000, coalesce((req->>'swapTide')::bigint, 0))), coalesce((req->>'allowPlot')::boolean, true),
          coalesce((req->>'enabled')::boolean, false), left(req->>'note', 200))
        ON CONFLICT (chain, contract) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, swap_tide = EXCLUDED.swap_tide,
          allow_plot = EXCLUDED.allow_plot, enabled = EXCLUDED.enabled, note = COALESCE(EXCLUDED.note, aquaterra_nft_collections.note);
      ELSIF act = 'admin_setting' THEN
        IF req->>'key' = 'vault_address' THEN
          IF addr = '' THEN RAISE EXCEPTION 'address'; END IF;
          INSERT INTO aquaterra_heritage_settings (key, value) VALUES ('vault_address', addr)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
        ELSIF req->>'key' = 'heritage_district' THEN
          IF NOT EXISTS (SELECT 1 FROM aquaterra_plots WHERE district = req->>'value') THEN RAISE EXCEPTION 'district'; END IF;
          INSERT INTO aquaterra_heritage_settings (key, value) VALUES ('heritage_district', req->>'value')
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
        ELSE RAISE EXCEPTION 'key'; END IF;
      ELSIF act = 'admin_reserve' THEN
        -- Keeps every free plot of the Heritage district for swaps.
        INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid)
        SELECT p.id, 'heritage:reserve', 0 FROM aquaterra_plots p
        WHERE p.district = aquaterra_hs('heritage_district') AND p.address NOT ILIKE '%water%'
          AND NOT EXISTS (SELECT 1 FROM aquaterra_plot_owners o WHERE o.plot_id = p.id)
        ON CONFLICT DO NOTHING;
      ELSIF act <> 'admin' THEN RAISE EXCEPTION 'action'; END IF;
      res := jsonb_build_object(
        'vault', aquaterra_hs('vault_address'), 'district', aquaterra_hs('heritage_district'),
        'fee', aquaterra_hlaw('nft_swap_fee'), 'open', aquaterra_hlaw('nft_swap_enabled') = 1,
        'reserve', (SELECT count(*) FROM aquaterra_plot_owners WHERE owner = 'heritage:reserve'),
        'wallets', (SELECT count(*) FROM aquaterra_wallet_links),
        'chains', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'family', family, 'enabled', enabled) ORDER BY sort) FROM aquaterra_nft_chains), '[]'::jsonb),
        'collections', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'chain', chain, 'contract', contract, 'name', name, 'kind', kind,
            'swapTide', swap_tide, 'allowPlot', allow_plot, 'enabled', enabled, 'note', note,
            'swapped', (SELECT count(*) FROM aquaterra_nft_swaps x WHERE x.collection_id = c.id AND x.status = 'done')) ORDER BY chain, id)
          FROM aquaterra_nft_collections c), '[]'::jsonb),
        'swaps', COALESCE((SELECT jsonb_agg(aquaterra_h_swap_json(x) || jsonb_build_object('resident', aquaterra_name(x.email)) ORDER BY x.id DESC)
          FROM (SELECT * FROM aquaterra_nft_swaps WHERE status <> 'checking' ORDER BY id DESC LIMIT 50) x), '[]'::jsonb));
    ELSE
      RAISE EXCEPTION 'action';
    END IF;
    RETURN jsonb_build_object('ok', true) || res;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('ok', false, 'error', 'amount', 'status', 400);
    WHEN raise_exception THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM,
        'status', CASE SQLERRM WHEN 'not_found' THEN 404 WHEN 'forbidden' THEN 403 ELSE 400 END);
  END;
END $fn$;

-- n8n only: the answer of ownerOf(token) for one swap. req: {action: owner, swapId, step, owner}
-- (owner is the lower case address, or null when the chain did not answer).
CREATE OR REPLACE FUNCTION aquaterra_heritage_internal(req jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  s aquaterra_nft_swaps; o aquaterra_nft_swaps; col aquaterra_nft_collections;
  own text := lower(coalesce(req->>'owner', '')); v_plot int; v_price bigint; v_ref text;
BEGIN
  IF req->>'action' <> 'owner' THEN RETURN jsonb_build_object('ok', false, 'error', 'action', 'status', 400); END IF;
  SELECT * INTO s FROM aquaterra_nft_swaps WHERE id = (req->>'swapId')::bigint FOR UPDATE;
  IF s.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found', 'status', 404); END IF;
  SELECT * INTO col FROM aquaterra_nft_collections WHERE id = s.collection_id;
  BEGIN
    IF req->>'step' = 'open' AND s.status = 'checking' THEN
      IF own = '' THEN
        DELETE FROM aquaterra_nft_swaps WHERE id = s.id;
        RETURN jsonb_build_object('ok', false, 'error', 'chain', 'status', 400);
      END IF;
      SELECT address INTO s.owner_address FROM aquaterra_wallet_links WHERE email = s.email AND chain_family = 'evm' AND address = own;
      IF s.owner_address IS NULL THEN
        UPDATE aquaterra_nft_swaps SET status = 'rejected', reason = 'not in a linked wallet' WHERE id = s.id;
        RETURN jsonb_build_object('ok', false, 'error', 'not_owner', 'status', 400);
      END IF;
      -- The token changed hands: older open swaps of it by others are cancelled, fee back.
      FOR o IN SELECT * FROM aquaterra_nft_swaps WHERE collection_id = s.collection_id AND token_id = s.token_id
               AND status = 'open' AND email <> s.email FOR UPDATE LOOP
        PERFORM aquaterra_h_refund(o, 'the token moved to another resident');
      END LOOP;
      s.fee := aquaterra_hlaw('nft_swap_fee');
      IF aquaterra_balance(s.email) - aquaterra_swap_locked(s.email) < s.fee THEN
        DELETE FROM aquaterra_nft_swaps WHERE id = s.id;
        RETURN jsonb_build_object('ok', false, 'error', 'insufficient', 'status', 400);
      END IF;
      IF s.fee > 0 THEN
        PERFORM aquaterra_move(s.email, 'state:treasury', s.fee, 'nft_swap_fee', NULL, 'Heritage Port: ' || col.name || ' #' || s.token_id, s.email);
      END IF;
      UPDATE aquaterra_nft_swaps SET status = 'open', owner_address = s.owner_address, fee = s.fee, opened_at = now() WHERE id = s.id;

    ELSIF req->>'step' = 'confirm' AND s.status = 'open' THEN
      IF own = '' THEN RAISE EXCEPTION 'chain'; END IF;
      IF own <> coalesce(aquaterra_hs('vault_address'), '-') THEN RAISE EXCEPTION 'not_received'; END IF;
      IF s.choice = 'planet' THEN
        IF NOT aquaterra_orbit_give(s.token_id, s.email) THEN RAISE EXCEPTION 'swapped'; END IF;
        UPDATE aquaterra_nft_swaps SET status = 'done', done_at = now() WHERE id = s.id;
        SELECT * INTO s FROM aquaterra_nft_swaps WHERE id = s.id;
        RETURN jsonb_build_object('ok', true, 'swap', aquaterra_h_swap_json(s));
      END IF;
      IF s.choice = 'item' THEN
        PERFORM aquaterra_h_item_give(s);
        SELECT * INTO s FROM aquaterra_nft_swaps WHERE id = s.id;
        RETURN jsonb_build_object('ok', true, 'swap', aquaterra_h_swap_json(s));
      END IF;
      IF s.choice = 'apartment' THEN
        UPDATE aquaterra_apartments a SET owner = s.email, owned_at = now(), income_from = now()
        FROM aquaterra_towers t2 WHERE t2.id = a.tower AND t2.collection_id = s.collection_id AND a.token_id::text = s.token_id AND a.owner IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'swapped'; END IF;
        UPDATE aquaterra_nft_swaps SET status = 'done', done_at = now() WHERE id = s.id;
        SELECT * INTO s FROM aquaterra_nft_swaps WHERE id = s.id;
        RETURN jsonb_build_object('ok', true, 'swap', aquaterra_h_swap_json(s));
      END IF;
      IF s.choice = 'plot' THEN
        SELECT o2.plot_id, p.price INTO v_plot, v_price FROM aquaterra_plot_owners o2 JOIN aquaterra_plots p ON p.id = o2.plot_id
        WHERE o2.owner = 'heritage:reserve' ORDER BY p.price DESC, o2.plot_id LIMIT 1 FOR UPDATE OF o2;
      END IF;
      IF v_plot IS NOT NULL THEN
        UPDATE aquaterra_plot_owners SET owner = s.email, price_paid = v_price, bought_at = now(), income_from = now() WHERE plot_id = v_plot;
        UPDATE aquaterra_nft_swaps SET status = 'done', plot_id = v_plot, done_at = now() WHERE id = s.id;
      ELSE
        -- Plot chosen but the reserve ran out: Tide instead.
        UPDATE aquaterra_nft_swaps SET status = 'done', choice = 'tide', tide = col.swap_tide, done_at = now(),
          reason = CASE WHEN s.choice = 'plot' THEN 'the Heritage Reserve had no plot left' END WHERE id = s.id;
        IF col.swap_tide > 0 THEN
          PERFORM aquaterra_move('treasury', s.email, col.swap_tide, 'nft_swap_tide', NULL, 'Heritage Port: ' || col.name || ' #' || s.token_id, NULL);
        END IF;
      END IF;
    END IF;
    SELECT * INTO s FROM aquaterra_nft_swaps WHERE id = s.id;
    RETURN jsonb_build_object('ok', true, 'swap', aquaterra_h_swap_json(s));
  EXCEPTION
    WHEN raise_exception THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'status', 400);
  END;
END $fn$;

-- Keep the Heritage district for swaps from the start.
INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid)
SELECT p.id, 'heritage:reserve', 0 FROM aquaterra_plots p
WHERE p.district = aquaterra_hs('heritage_district') AND p.address NOT ILIKE '%water%'
  AND NOT EXISTS (SELECT 1 FROM aquaterra_plot_owners o WHERE o.plot_id = p.id)
ON CONFLICT DO NOTHING;
