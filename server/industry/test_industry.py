"""End-to-end test of industry on a scratch Postgres.

  PGHOST=/var/tmp/pg PGPORT=5433 python3 server/industry/test_industry.py

Loads everything farms need, then orbit and industry.sql (twice), sets up companies, collects,
builds with materials and demolishes for salvage.
"""
import hashlib, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GOV = os.path.join(ROOT, "server", "governance")
ECONOMY = os.environ.get("ECONOMY_SQL", "/mnt/project-files/aquaterra-economy/economy.sql")
DB = "aquaterra_industry_test"
BASE = ["psql", "-U", os.environ.get("PGUSER", "postgres"), "-v", "ON_ERROR_STOP=1", "-q", "-tA"]


def psql(sql, db=DB):
    r = subprocess.run(BASE + ["-d", db, "-c", sql], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"SQL failed: {sql[:300]}\n{r.stderr}")
    return r.stdout.strip()


def load(f):
    r = subprocess.run(BASE + ["-d", DB, "-f", f], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"{f}: {r.stderr}")


lit = lambda s: "'" + s.replace("'", "''") + "'"
J = lambda sql: json.loads(psql(sql))
passed = 0


def check(cond, msg):
    global passed
    if not cond:
        raise SystemExit("FAIL: " + msg)
    passed += 1


psql(f"DROP DATABASE IF EXISTS {DB}", db="postgres")
psql(f"CREATE DATABASE {DB}", db="postgres")
load(os.path.join(GOV, "base-tables.sql"))
load(ECONOMY)
for f in ["schema.sql", "functions.sql", "api.sql"]:
    load(os.path.join(GOV, f))
load(os.path.join(ROOT, "server", "travel", "travel.sql"))
for f in ["schema.sql", "bank.sql", "functions.sql", "api.sql"]:
    load(os.path.join(ROOT, "server", "arcade", f))
load(os.path.join(ROOT, "server", "treasury", "treasury.sql"))
load(os.path.join(ROOT, "server", "build", "build.sql"))
load(os.path.join(ROOT, "server", "farm", "farm.sql"))
load(os.path.join(ROOT, "server", "exchange", "exchange.sql"))
load(os.path.join(ROOT, "server", "heritage", "heritage.sql"))
load(os.path.join(ROOT, "server", "orbit", "orbit.sql"))
for _ in range(2):
    load(os.path.join(HERE, "industry.sql"))

S = {}


def player(email, name, welcome=1000, free=0):
    psql(f"INSERT INTO aquaterra_players (email, display_name) VALUES ({lit(email)}, {lit(name)})")
    tok = hashlib.sha256(email.encode()).hexdigest()
    psql(f"INSERT INTO aquaterra_sessions (token_hash, email, expires_at) VALUES (encode(sha256(convert_to({lit(tok)}, 'UTF8')), 'hex'), {lit(email)}, now() + interval '1 day')")
    psql(f"INSERT INTO aquaterra_wallets (account) VALUES ({lit(email)}) ON CONFLICT DO NOTHING")
    if welcome:
        psql(f"SELECT aquaterra_move('treasury', {lit(email)}, {welcome}, 'welcome', NULL, 'Welcome', NULL)")
    if free:
        psql(f"SELECT aquaterra_move('treasury', {lit(email)}, {free}, 'grant', NULL, 'Grant', NULL)")
    S[email.split('@')[0]] = tok


def bal(acct):
    return int(psql(f"SELECT COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = {lit(acct)}), 0)"))


def ind(who=None, **kw):
    return farm(who, **kw)


def build(who, **kw):
    req = {k: (str(v) if isinstance(v, (int, float)) else v) for k, v in kw.items()}
    req["session"] = S[who]
    return J(f"SELECT aquaterra_build({lit(json.dumps(req))}::jsonb)")


def store(who, k):
    return int(psql(f"SELECT COALESCE((SELECT units FROM aquaterra_farm_barn WHERE email = '{who}@x' AND crop = '{k}'), 0)"))


def farm(who=None, **kw):
    req = {k: (str(v) if isinstance(v, (int, float)) else v) for k, v in kw.items()}
    if who:
        req["session"] = S[who]
    return J(f"SELECT aquaterra_farm({lit(json.dumps(req))}::jsonb)")


def plot(pid, owner, tiles=10, buildable=True, starter="none", water=False, district="Greenhaven"):
    addr = f"Water Plot {pid}-1" if water else f"{pid} Field Road"
    psql(f"INSERT INTO aquaterra_plots (id, address, district, tiles, price) VALUES ({pid}, '{addr}', '{district}', {tiles}, {tiles * 60})")
    psql(f"INSERT INTO aquaterra_build_sites (plot_id, buildable, tower_ok, centre, starter) VALUES ({pid}, {buildable}, false, false, '{starter}')")
    if owner:
        psql(f"INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid) VALUES ({pid}, {lit(owner)}, {tiles * 60})")



for i, (n, b) in enumerate([("Greenhaven", "temperate"), ("Obsidian Ridge", "volcanic"), ("Amber Sands", "desert"), ("Forgeworks", "industrial")]):
    psql(f"INSERT INTO aquaterra_districts (id, name, biome, land) VALUES ({i + 1}, '{n}', '{b}', 'Continent') ON CONFLICT DO NOTHING")
player("ann@x", "Ann", free=5000)
player("bob@x", "Bob", free=0)
plot(1, "ann@x", 10)                                   # temperate land: timber, clay, stone
plot(2, "ann@x", 10, buildable=False, district="Obsidian Ridge")   # volcanic mountain
plot(3, "ann@x", 10, starter="cottage")
plot(4, "ann@x", 20, water=True, buildable=False)
plot(5, "ann@x", 10, district="Forgeworks")
plot(6, "ann@x", 10, district="Amber Sands")
plot(7, "bob@x", 10)

w = ind(action="works")
check(w["ok"] and len(w["types"]) == 14 and len(w["goods"]) == 13 and "plots" not in w, "public catalog")
check(ind(action="setup", plotId=1, works="timber")["error"] == "session", "setup needs a session")
me = ind("ann", action="works")
opts = {p["plotId"]: p["options"] for p in me["plots"]}
check("timber" in opts[1] and "oilwell" not in opts[1] and "oilrig" not in opts[1], f"temperate {opts[1]}")
check("quarry" in opts[2] and "timber" not in opts[2] and "brickworks" not in opts[2], f"mountain takes only rock {opts[2]}")
check(list(opts[4].keys()) == ["oilrig"], f"water takes a rig {opts[4]}")
check("oilwell" in opts[6] and opts[5]["brickworks"] == 1.25, "desert oil, Forgeworks faster")
check(0.8 * 1.5 * 1.3 - 0.01 <= opts[2]["ironmine"] <= 1.2 * 1.5 * 1.3 + 0.01, "volcanic mountain iron is rich")

check(ind("ann", action="setup", plotId=2, works="timber")["error"] == "place", "no forest on a volcano")
check(ind("ann", action="setup", plotId=7, works="timber")["error"] == "not_owner", "only the owner")
check(ind("bob", action="setup", plotId=7, works="timber")["error"] == "insufficient", "welcome Tide is for land")
before = bal("ann@x"); tre = bal("state:treasury")
s1 = ind("ann", action="setup", plotId=1, works="claypit")
check(s1["ok"] and s1["cost"] == 120 and s1["permit"] == 12 and bal("ann@x") == before - 132 and bal("state:treasury") == tre + 12, "setup pays cost and permit")
check(ind("ann", action="setup", plotId=1, works="timber")["error"] == "works", "one company a plot")
check(farm("ann", action="plant", plotId=1, crop="wheat")["error"] == "works", "no field on a company")
check(farm("ann", action="plant", plotId=1, crop="clay")["error"] == "crop", "clay is not planted")
check(build("ann", action="build", plotId=1, kind="cottage")["error"] == "works", "no house on a company")
check(ind("ann", action="produce")["error"] == "nothing", "nothing yet")

f1 = float(psql("SELECT factor FROM aquaterra_works WHERE plot_id = 1"))
psql("UPDATE aquaterra_works SET since = now() - interval '24 hours' WHERE plot_id = 1")
p = ind("ann", action="produce")
want = int(1.6 * 10 * f1 + 1e-9)
check(p["ok"] and store("ann", "clay") == want, f"a day of clay {store('ann', 'clay')} vs {want}")
psql("UPDATE aquaterra_works SET since = now() - interval '30 days' WHERE plot_id = 1")
ind("ann", action="produce")
check(store("ann", "clay") == want + int(1.6 * 10 * f1 * 2 + 1e-9), "output stops at 48 hours")

# Brickworks takes 2 clay a brick; short of clay it makes what it can and keeps the rest of its time.
ind("ann", action="setup", plotId=5, works="brickworks")
psql("UPDATE aquaterra_farm_barn SET units = 7 WHERE email = 'ann@x' AND crop = 'clay'")
psql("UPDATE aquaterra_works SET since = now() - interval '24 hours' WHERE plot_id = 5")
ind("ann", action="produce", plotId=5)
check(store("ann", "bricks") == 3 and store("ann", "clay") == 1, f"bricks {store('ann', 'bricks')} clay {store('ann', 'clay')}")
pend = next(x for x in ind("ann", action="works")["plots"] if x["plotId"] == 5)["works"]["pending"]
check(pend == 9, f"capacity waits for clay {pend}")

# Build a cottage: 400 TIDE, recipe wood 30, bricks 40, steel 5, glass 10, materials 20. Ann has 3 bricks.
psql("UPDATE aquaterra_farm_barn SET units = 40 WHERE email = 'ann@x' AND crop = 'bricks'")
psql("INSERT INTO aquaterra_farm_barn (email, crop, units) VALUES ('ann@x', 'wood', 100)")
before = bal("ann@x")
b = build("ann", action="build", plotId=6, kind="cottage")
saved = int(30 * 0.75 + 40 * 1.5)
check(b["ok"] and b["materialsSaved"] == saved and b["paid"] == 400 - saved, f"materials saved {b.get('materialsSaved')}")
check(bal("ann@x") == before - (400 - saved) - 40, "pays the rest and the permit")
check(store("ann", "wood") == 70 and store("ann", "bricks") == 0, "materials used")
mats = dict((r.split("|")[0], int(r.split("|")[1])) for r in psql("SELECT resource || '|' || qty FROM aquaterra_building_materials WHERE plot_id = 6").split("\n"))
check(mats == {"wood": 30, "bricks": 40, "steel": 5, "glass": 10, "materials": 20}, f"recipe in the building {mats}")
psql("UPDATE aquaterra_buildings SET ready_at = now() WHERE plot_id = 6")
d = build("ann", action="demolish", plotId=6)
check(d["ok"] and d["salvage"] == {"wood": 15, "bricks": 20, "steel": 2, "glass": 5, "materials": 10}, f"salvage {d.get('salvage')}")
check(store("ann", "steel") == 2 and int(psql("SELECT count(*) FROM aquaterra_building_materials WHERE plot_id = 6")) == 0, "half back")
d3 = build("ann", action="demolish", plotId=3)
check(d3["ok"] and d3["salvage"]["bricks"] == 10, f"starter house gives a quarter {d3.get('salvage')}")

# Sell to the Reserve and trade like crops.
r = farm("ann", action="reserve", crop="bricks", units=10)
check(r["ok"] and r["tide"] == 10, f"bricks to the Reserve {r.get('tide')}")
m = farm(action="market")
check(any(c["key"] == "steel" and c["source"] == "industry" for c in m["crops"]), "materials on the market")

# Orbit goods ship down.
psql("INSERT INTO aquaterra_orbit_holds (email, resource, units) VALUES ('ann@x', 'Platinum', 30)")
s = ind("ann", action="ship", resource="Platinum")
check(s["ok"] and s["good"] == "skyplatinum" and store("ann", "skyplatinum") == 30, "ship to the storehouse")
check(ind("ann", action="ship", resource="Platinum")["error"] == "nothing", "nothing left in the hold")
check(farm("ann", action="reserve", crop="skyplatinum")["tide"] == 15, "sky goods sell at the Orbit price")

dm = ind("ann", action="dismantle", plotId=1)
check(dm["ok"] and int(psql("SELECT count(*) FROM aquaterra_works WHERE plot_id = 1")) == 0, "dismantle")
check(farm("ann", action="me")["ok"], "farm page still works")
print(f"industry: {passed} checks passed")
