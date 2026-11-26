"""Tests for server/rainbowland/rainbowland.sql on a throwaway Postgres.
Run: PGHOST=/var/tmp/pgr PGPORT=5434 python3 server/rainbowland/test_rainbowland.py
Builds minimal stand-ins of the account, economy and heritage tables, then the migration (twice)."""
import hashlib, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DB = "rainbow_test"

def psql(sql, db=DB):
    out = subprocess.run(["psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-qAt", "-c", sql], capture_output=True, text=True)
    if out.returncode: raise RuntimeError(out.stderr)
    return out.stdout.strip()

def api(req):
    return json.loads(psql("SELECT aquaterra_rainbow('%s'::jsonb)" % json.dumps(req).replace("'", "''")))

psql(f"DROP DATABASE IF EXISTS {DB}", "postgres"); psql(f"CREATE DATABASE {DB}", "postgres")
psql("""
CREATE TABLE aquaterra_players (email text PRIMARY KEY, display_name text);
CREATE TABLE aquaterra_sessions (token_hash text PRIMARY KEY, email text, expires_at timestamptz);
CREATE TABLE aquaterra_wallets (account text PRIMARY KEY, balance bigint DEFAULT 0, welcomed_at timestamptz);
CREATE TABLE aquaterra_plots (id int PRIMARY KEY, address text NOT NULL, district text NOT NULL, tiles int NOT NULL, price bigint NOT NULL CHECK (price > 0), synced_at timestamptz DEFAULT now());
CREATE TABLE aquaterra_plot_owners (plot_id int PRIMARY KEY REFERENCES aquaterra_plots(id), owner text NOT NULL REFERENCES aquaterra_wallets(account), price_paid bigint NOT NULL, bought_at timestamptz DEFAULT now(), income_from timestamptz DEFAULT now());
CREATE TABLE aquaterra_districts (id int PRIMARY KEY, name text, biome text, land text, capital boolean DEFAULT false);
CREATE TABLE aquaterra_gov_params (key text PRIMARY KEY, value bigint);
INSERT INTO aquaterra_gov_params VALUES ('nft_swap_fee', 600);
CREATE TABLE aquaterra_heritage_settings (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz DEFAULT now());
CREATE TABLE aquaterra_nft_collections (id serial PRIMARY KEY, chain text, contract text, name text, kind text, standard text DEFAULT 'erc721', swap_tide bigint DEFAULT 0, allow_plot boolean DEFAULT true, enabled boolean DEFAULT false, note text, UNIQUE (chain, contract));
INSERT INTO aquaterra_nft_collections (chain, contract, name, kind, swap_tide, enabled) VALUES
  ('cronos', '0x3ff260ce7a8dfcadaf5e880137ee1750ceae9889', 'Cronos collection 0x3ff2 (to confirm)', 'land', 800, false),
  ('cronos', '0xb4b898ee60185facc247aadb8d061661590f167f', 'Tower 2', 'asset', 500, true);
CREATE TABLE aquaterra_nft_swaps (id bigserial PRIMARY KEY, email text, collection_id int, token_id text, choice text, status text DEFAULT 'checking', owner_address text, fee bigint DEFAULT 0, plot_id int, tide bigint DEFAULT 0, reason text, created_at timestamptz DEFAULT now(), opened_at timestamptz, done_at timestamptz);
CREATE FUNCTION aquaterra_hs(k text) RETURNS text LANGUAGE sql STABLE AS 'SELECT value FROM aquaterra_heritage_settings WHERE key = k';
CREATE FUNCTION aquaterra_name(acct text) RETURNS text LANGUAGE sql STABLE AS 'SELECT coalesce((SELECT display_name FROM aquaterra_players WHERE email = acct), acct)';
INSERT INTO aquaterra_wallets (account) VALUES ('heritage:reserve');
INSERT INTO aquaterra_plots VALUES (5, 'Lot 1, Driftstone Isles', 'Driftstone Isles', 3, 900);
INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid) VALUES (5, 'heritage:reserve', 0);
CREATE TABLE aquaterra_rainbow_meta (token_id int PRIMARY KEY, rarity text, district text, name text);
""")
# metadata: 1000 tokens, mostly Zinc; a few rare names
rows = []
for t in range(1000):
    r = "Zinc" if t % 10 else ("Copper" if t % 20 else "Cesium")
    rows.append(f"({t}, '{r}', 'Terra Incognita', 'LAND ({t % 640 - 128}, {t // 640 - 128})')")
rows[7] = "(7, 'Cyber', 'Terra Incognita', 'LAND (-121, -128)')"
rows[900] = "(900, 'Topaz', 'Terra Incognita', 'x')"
psql("INSERT INTO aquaterra_rainbow_meta VALUES " + ",".join(rows))

sql = open(os.path.join(HERE, "rainbowland.sql")).read()
for _ in range(2): psql(sql)

def check(cond, msg):
    assert cond, msg
    print("ok -", msg)

col = psql("SELECT name || '|' || swap_tide || '|' || enabled FROM aquaterra_nft_collections WHERE id = 1")
check(col == "Rainbowland LAND|0|true", "LAND collection switched on, no Tide")
check(psql("SELECT tier FROM aquaterra_rainbow_rarity WHERE rarity = 'Zinc'") == "common", "Zinc is common")
check(psql("SELECT tier FROM aquaterra_rainbow_rarity WHERE rarity = 'Cesium'") == "rare", "Cesium is rare")
check(psql("SELECT aquaterra_rainbow_name_tier('Tennessine') || aquaterra_rainbow_name_tier('Plutonium')") == "legendaryrare", "Tennessine legendary, actinide rare")
check(psql("SELECT tier FROM aquaterra_rainbow_rarity WHERE rarity = 'Cyber'") == "cyber", "Cyber is cyber")
check(psql("SELECT tier FROM aquaterra_rainbow_rarity WHERE rarity = 'Topaz'") == "rare", "Topaz is rare")
check(psql("SELECT aquaterra_rainbow_x(5601) || ',' || aquaterra_rainbow_y(5601)") == "353,-120", "token 5601 is LAND (353, -120)")

m = api({"action": "map"})
check(m["ok"] and len(m["tiles"]) == 55524 and m["tiles"][7] == "x" and m["tiles"][1] == "c" and m["tiles"][5000] == "?", "map string: one letter per token")
check(m["claimed"] == [], "nothing claimed yet")

psql("INSERT INTO aquaterra_players VALUES ('a@x.io', 'Alpha'); INSERT INTO aquaterra_wallets (account) VALUES ('a@x.io')")
tok = "a" * 64
psql(f"INSERT INTO aquaterra_sessions VALUES ('{hashlib.sha256(tok.encode()).hexdigest()}', 'a@x.io', now() + interval '1 day')")

# The heritage confirm path: a reserve plot was picked first, then the swap is marked done.
psql("INSERT INTO aquaterra_nft_swaps (email, collection_id, token_id, choice, status) VALUES ('a@x.io', 1, '7', 'plot', 'open')")
psql("UPDATE aquaterra_plot_owners SET owner = 'a@x.io', price_paid = 900 WHERE plot_id = 5")
psql("UPDATE aquaterra_nft_swaps SET status = 'done', plot_id = 5, done_at = now() WHERE id = 1")
s = psql("SELECT plot_id || '|' || choice || '|' || tide FROM aquaterra_nft_swaps WHERE id = 1")
check(s == "1000007|plot|0", "swap result is the Rainbowland plot")
check(psql("SELECT owner FROM aquaterra_plot_owners WHERE plot_id = 5") == "heritage:reserve", "reserve plot went back")
p = psql("SELECT address || '|' || district || '|' || tiles || '|' || price FROM aquaterra_plots WHERE id = 1000007")
check(p == "LAND (-121, -128), Rainbowland|Rainbowland|6|2500", "plot at the same coordinates, cyber size and price")
check(psql("SELECT owner || '|' || price_paid FROM aquaterra_plot_owners WHERE plot_id = 1000007") == "a@x.io|2500", "owned, earns on 2500")

# A Tide choice on the LAND collection also ends as the plot.
psql("INSERT INTO aquaterra_nft_swaps (email, collection_id, token_id, choice, status) VALUES ('a@x.io', 1, '12', 'tide', 'open')")
psql("UPDATE aquaterra_nft_swaps SET status = 'done', choice = 'tide', tide = 0 WHERE id = 2")
check(psql("SELECT plot_id || '|' || choice FROM aquaterra_nft_swaps WHERE id = 2") == "1000012|plot", "tide choice also gives the plot")

# Other collections are untouched.
psql("INSERT INTO aquaterra_nft_swaps (email, collection_id, token_id, choice, status) VALUES ('a@x.io', 2, '3', 'tide', 'open')")
psql("UPDATE aquaterra_nft_swaps SET status = 'done', tide = 500 WHERE id = 3")
check(psql("SELECT coalesce(plot_id::text, '-') || '|' || tide FROM aquaterra_nft_swaps WHERE id = 3") == "-|500", "other collections unchanged")

# A token comes home once.
psql("INSERT INTO aquaterra_players VALUES ('b@x.io', 'Bravo'); INSERT INTO aquaterra_wallets (account) VALUES ('b@x.io')")
psql("INSERT INTO aquaterra_nft_swaps (email, collection_id, token_id, choice, status) VALUES ('b@x.io', 1, '7', 'plot', 'open')")
try:
    psql("UPDATE aquaterra_nft_swaps SET status = 'done' WHERE id = 4"); raise SystemExit("second claim allowed")
except RuntimeError as e:
    check("cell_taken" in str(e), "a cell cannot be claimed twice")

m = api({"action": "map", "session": tok})
check(m["claimed"] == [[7, "Alpha", True], [12, "Alpha", True]], "map lists claimed cells with owner names")
c = api({"action": "cell", "token": "7"})["cell"]
check(c["claimed"] and c["owner"] == "Alpha" and c["rarity"] == "Cyber" and c["x"] == -121, "cell details")
check(api({"action": "cell", "token": "55524"})["error"] == "token", "out of range token refused")
check(api({"action": "cell", "token": "1x"})["error"] == "token", "bad token refused")
check(len(api({"action": "me", "session": tok})["cells"]) == 2, "my cells")
check(api({"action": "me"})["error"] == "session", "me needs a session")

# Prism Hills: the Polygon LAND, a grid of its own.
prism = open(os.path.join(HERE, "prism.sql")).read()
for _ in range(2): psql(prism)
check(psql("SELECT name || '|' || swap_tide || '|' || enabled FROM aquaterra_nft_collections WHERE chain = 'polygon'") == "Prism Hills LAND|0|true", "Polygon LAND collection listed, no Tide")
sizes = psql("SELECT string_agg(aquaterra_prism_size(t)::text, '' ORDER BY t) FROM generate_series(1, 20) t")
check(sizes == "21211211213212112112", "plot sizes 1..3 by token")
check(psql("SELECT aquaterra_prism_x(1) || ',' || aquaterra_prism_y(1) || ' ' || aquaterra_prism_x(90000) || ',' || aquaterra_prism_y(90000)") == "0,0 299,299", "grid corners")
pc = psql("SELECT id FROM aquaterra_nft_collections WHERE chain = 'polygon'")
psql(f"INSERT INTO aquaterra_nft_swaps (email, collection_id, token_id, choice, status) VALUES ('a@x.io', {pc}, '302', 'tide', 'open')")
psql("UPDATE aquaterra_plot_owners SET owner = 'a@x.io', price_paid = 900 WHERE plot_id = 5")
psql("UPDATE aquaterra_nft_swaps SET status = 'done', plot_id = 5, tide = 0 WHERE token_id = '302'")
check(psql("SELECT plot_id || '|' || choice FROM aquaterra_nft_swaps WHERE token_id = '302'") == "3000302|plot", "Polygon swap gives the Prism Hills plot")
check(psql("SELECT owner FROM aquaterra_plot_owners WHERE plot_id = 5") == "heritage:reserve", "reserve plot went back again")
k = int(psql("SELECT aquaterra_prism_size(302)"))
check(psql("SELECT address || '|' || tiles || '|' || price FROM aquaterra_plots WHERE id = 3000302") == f"Parcel (1, 1), Prism Hills|{k}|{k*200}", "parcel address, size and price")
check(not psql("SELECT 1 FROM aquaterra_rainbow_cells WHERE token_id = 302"), "Rainbowland untouched by a Polygon swap")
pm = json.loads(psql("SELECT aquaterra_prism('{\"action\":\"map\"}'::jsonb)"))
check(pm["claimed"] == [[302, "Alpha", False]] and pm["total"] == 90000, "prism map")
pcell = json.loads(psql("SELECT aquaterra_prism('{\"action\":\"cell\",\"token\":\"90001\"}'::jsonb)"))
check(pcell["error"] == "token", "prism token out of range refused")
print("all rainbowland tests passed")
